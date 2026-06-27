import asyncio
import websockets
import json
import os
import base64
import logging
import shutil
from pathlib import Path

# 配置
CONFIG_PATH = Path(__file__).parent / "config.json"
config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

# 日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(config["logFile"], encoding="utf-8"),
              logging.StreamHandler()]
)
log = logging.getLogger("storage-node")

# 确保存储根目录存在
ROOT = Path(config["storagePath"])
ROOT.mkdir(parents=True, exist_ok=True)

# 分块写入缓冲区 — keyed by command id
CHUNK_WRITE_BUFFERS: dict[str, dict] = {}

# 分块大小（base64 字符数，~32KB raw data）
CHUNK_SIZE = 65536


# === 文件操作函数 ===

def handle_write_file(path: str, total_size: int, total_chunks: int) -> dict:
    """开始分块写入，初始化缓冲区"""
    log.info(f"Start chunked write: {path} ({total_size} bytes, {total_chunks} chunks)")
    CHUNK_WRITE_BUFFERS[path] = {
        "chunks": {},
        "total_chunks": total_chunks,
        "total_size": total_size,
    }
    return {"success": True}


def handle_write_file_data(path: str, data_b64: str, chunk_index: int,
                           total_chunks: int, is_last: bool) -> dict:
    """接收一个分块数据"""
    buf = CHUNK_WRITE_BUFFERS.get(path)
    if not buf:
        return {"success": False, "error": "未找到写入缓冲区，请从 write_file 开始"}

    buf["chunks"][chunk_index] = data_b64

    if is_last or len(buf["chunks"]) >= total_chunks:
        # 所有分块收齐，拼接并写入磁盘
        full_b64 = ""
        for i in range(total_chunks):
            full_b64 += buf["chunks"].get(i, "")

        data = base64.b64decode(full_b64)
        abs_path = ROOT / path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(data)

        del CHUNK_WRITE_BUFFERS[path]
        log.info(f"Wrote {len(data)} bytes to {path}")
        return {"success": True, "data": {"size": len(data)}}

    return {"success": True}


def handle_read_file(path: str) -> dict:
    """
    读取文件并分块返回。
    第一块（chunkIndex=0）由 read_file 命令的响应直接携带。
    后续块通过 read_file_data 消息发送。
    注意：此函数在同步上下文中运行，但 websocket.send 需要异步。
    因此我们将分块逻辑放到 handle_command 中异步处理。
    """
    abs_path = ROOT / path
    if not abs_path.exists():
        return {"success": False, "error": "文件不存在"}

    data = abs_path.read_bytes()
    b64 = base64.b64encode(data).decode()
    log.info(f"Read {len(data)} bytes from {path}")

    # 计算分块
    total_chunks = max(1, (len(b64) + CHUNK_SIZE - 1) // CHUNK_SIZE)

    return {
        "success": True,
        "data": b64,
        "total_size": len(data),
        "total_chunks": total_chunks,
        "chunk_data": b64,  # 由 handle_command 拆分成块发送
    }


def handle_delete_file(path: str) -> dict:
    abs_path = ROOT / path
    if abs_path.is_dir():
        shutil.rmtree(abs_path)
    else:
        abs_path.unlink(missing_ok=True)
    log.info(f"Deleted {path}")
    return {"success": True}


def handle_mkdir(path: str) -> dict:
    abs_path = ROOT / path
    abs_path.mkdir(parents=True, exist_ok=True)
    return {"success": True}


def handle_move(path: str, new_path: str) -> dict:
    src = ROOT / path
    dst = ROOT / new_path
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return {"success": True}


def handle_rename(path: str, new_name: str) -> dict:
    src = ROOT / path
    dst = src.parent / new_name
    src.rename(dst)
    return {"success": True}


def handle_stat(path: str) -> dict:
    abs_path = ROOT / path
    if not abs_path.exists():
        return {"success": False, "error": "不存在"}
    st = abs_path.stat()
    return {"success": True, "data": {
        "name": abs_path.name,
        "isFolder": abs_path.is_dir(),
        "size": st.st_size,
        "mtime": st.st_mtime
    }}


def handle_list_dir(path: str) -> dict:
    abs_path = ROOT / path
    if not abs_path.is_dir():
        return {"success": False, "error": "不是目录"}
    items = []
    for child in sorted(abs_path.iterdir(), key=lambda x: (not x.is_dir(), x.name)):
        st = child.stat()
        items.append({
            "name": child.name,
            "isFolder": child.is_dir(),
            "size": st.st_size,
            "mtime": st.st_mtime
        })
    return {"success": True, "data": items}


# === 命令分发 ===

HANDLERS = {
    "write_file":      handle_write_file,
    "write_file_data": handle_write_file_data,
    "read_file":       handle_read_file,
    "delete_file":     handle_delete_file,
    "mkdir":           handle_mkdir,
    "move":            handle_move,
    "rename":          handle_rename,
    "stat":            handle_stat,
    "list_dir":        handle_list_dir,
}


async def handle_command(cmd: dict, ws) -> dict | None:
    """
    处理一条命令。返回 dict 表示同步响应（写回 ws），
    返回 None 表示异步处理已完成。
    """
    cmd_type = cmd.get("type")
    cmd_id = cmd.get("id")
    handler = HANDLERS.get(cmd_type)
    if not handler:
        return {"id": cmd_id, "success": False, "error": f"未知命令: {cmd_type}"}

    # 安全校验：防止路径遍历
    raw_path = cmd.get("path", "")
    path = Path(raw_path).as_posix()
    if ".." in path.split("/") or path.startswith("/"):
        return {"id": cmd_id, "success": False, "error": "非法路径"}

    try:
        if cmd_type == "write_file":
            result = handler(path, cmd.get("totalSize", 0), cmd.get("totalChunks", 0))
        elif cmd_type == "write_file_data":
            result = handler(
                path,
                cmd.get("data", ""),
                cmd.get("chunkIndex", 0),
                cmd.get("totalChunks", 0),
                cmd.get("isLast", False)
            )
        elif cmd_type == "read_file":
            result = handler(path)
            # 如果是分块读取，异步发送后续块
            if result.get("success") and result.get("total_chunks", 1) > 1:
                b64_data = result.get("chunk_data", "")
                total_chunks = result["total_chunks"]
                chunk_size = CHUNK_SIZE

                # 先发第一块的响应（携带 chunkIndex=0 的数据）
                first_chunk = b64_data[:chunk_size]
                # 从第二块开始异步发送
                asyncio.create_task(send_remaining_chunks(
                    ws, cmd_id, b64_data, total_chunks, chunk_size
                ))
                return {
                    "id": cmd_id,
                    "success": True,
                    "type": "read_file_data",
                    "data": first_chunk,
                    "chunkIndex": 0,
                    "totalChunks": total_chunks,
                    "totalSize": result.get("total_size", 0),
                }
            else:
                # 小文件，单块返回
                if result.get("success") and result.get("data"):
                    total_chunks = 1
                    return {
                        "id": cmd_id,
                        "type": "read_file_data",
                        "success": True,
                        "data": result.get("data", ""),
                        "chunkIndex": 0,
                        "totalChunks": 1,
                    }
                return {"id": cmd_id, **result}
        elif cmd_type == "move":
            new_path = Path(cmd.get("newPath", "")).as_posix()
            result = handler(path, new_path)
        elif cmd_type == "rename":
            result = handler(path, cmd.get("newName", ""))
        else:
            result = handler(path)

        return {"id": cmd_id, **result}
    except Exception as e:
        log.error(f"命令 {cmd_type} 失败: {e}")
        return {"id": cmd_id, "success": False, "error": str(e)}


async def send_remaining_chunks(ws, cmd_id: str, b64_data: str,
                                 total_chunks: int, chunk_size: int):
    """异步发送第 1 块之后的所有分块"""
    try:
        for i in range(1, total_chunks):
            start = i * chunk_size
            end = start + chunk_size
            chunk = b64_data[start:end]
            msg = json.dumps({
                "id": cmd_id,
                "type": "read_file_data",
                "success": True,
                "data": chunk,
                "chunkIndex": i,
                "totalChunks": total_chunks,
            })
            await ws.send(msg)
            # 小块间加微小延迟避免背压
            if i % 10 == 0:
                await asyncio.sleep(0.001)
    except Exception as e:
        log.error(f"发送分块失败: {e}")


async def connect():
    delay = 1
    while True:
        try:
            async with websockets.connect(
                config["serverUrl"],
                ping_interval=30,
                ping_timeout=10,
                max_size=2**30,  # 1GB max message
            ) as ws:
                log.info("已连接到服务器")
                delay = 1  # 重置重连延迟

                # 认证
                await ws.send(json.dumps({"type": "auth", "token": config["token"]}))
                auth_resp = json.loads(await ws.recv())
                if auth_resp.get("type") != "auth_ok":
                    log.error(f"认证失败: {auth_resp}")
                    return
                log.info("认证成功")

                # 主循环 — 接收并执行指令
                async for message in ws:
                    cmd = json.loads(message)
                    response = await handle_command(cmd, ws)
                    if response is not None:
                        await ws.send(json.dumps(response))

        except websockets.ConnectionClosed:
            log.warning("连接断开，准备重连...")
        except Exception as e:
            log.error(f"连接错误: {e}")

        # 指数退避重连
        log.info(f"{delay} 秒后重连...")
        await asyncio.sleep(delay)
        delay = min(delay * 2, config.get("maxReconnectDelay", 60))


def main():
    log.info(f"存储节点启动 — 根目录: {ROOT}, 服务器: {config['serverUrl']}")
    try:
        asyncio.run(connect())
    except KeyboardInterrupt:
        log.info("用户终止")


if __name__ == "__main__":
    main()

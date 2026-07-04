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

# 分块写入缓冲区 — keyed by command id (batchId)
CHUNK_WRITE_BUFFERS: dict[str, dict] = {}


# === 文件操作函数 ===

def handle_write_file(cmd: dict) -> dict:
    """开始分块写入，初始化缓冲区。单块文件直接写盘。"""
    path = cmd.get("path", "")
    total_chunks = cmd.get("totalChunks", 0)
    total_size = cmd.get("totalSize", 0)
    cmd_id = cmd.get("id", "")

    # 单块文件 —— 直接写，不进缓冲区
    data_b64 = cmd.get("data", "")
    if data_b64 and total_chunks == 1:
        data = base64.b64decode(data_b64)
        abs_path = ROOT / path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(data)
        log.info(f"Wrote {len(data)} bytes to {path} (single chunk)")
        return {"success": True, "data": {"size": len(data)}}

    # 多块文件 —— 初始化缓冲区
    log.info(f"Start chunked write: {path} ({total_size} bytes, {total_chunks} chunks)")
    # 如果缓冲区已有同名 path 的数据（上次残留），清理
    for k in list(CHUNK_WRITE_BUFFERS.keys()):
        if CHUNK_WRITE_BUFFERS[k].get("path") == path:
            del CHUNK_WRITE_BUFFERS[k]

    CHUNK_WRITE_BUFFERS[cmd_id] = {
        "path": path,
        "chunks": {},
        "total_chunks": total_chunks,
        "total_size": total_size,
    }
    return {"success": True}


def handle_write_file_data(cmd: dict) -> dict:
    """接收一个分块数据并写入缓冲区。最后一块时写盘。"""
    cmd_id = cmd.get("id", "")
    path = cmd.get("path", "")
    data_b64 = cmd.get("data", "")
    chunk_index = cmd.get("chunkIndex", 0)
    total_chunks = cmd.get("totalChunks", 0)
    is_last = cmd.get("isLast", False)

    # 用 cmd_id 查找缓冲区
    buf = CHUNK_WRITE_BUFFERS.get(cmd_id)
    if not buf:
        # 尝试用 path 查找（兼容旧版/乱序到达）
        for k, v in CHUNK_WRITE_BUFFERS.items():
            if v.get("path") == path:
                buf = v
                break
    if not buf:
        log.warning(f"write_file_data: 未找到缓冲区 (cmd_id={cmd_id}, path={path}, idx={chunk_index})")
        # 可能 start 消息丢失，尝试直接写入（单块容错）
        if is_last:
            data = base64.b64decode(data_b64)
            abs_path = ROOT / path
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_bytes(data)
            log.info(f"Wrote {len(data)} bytes to {path} (fallback)")
            return {"success": True, "data": {"size": len(data)}}
        return {"success": False, "error": "未找到写入缓冲区"}

    # 如果 total_chunks 比声明的大，更新（边缘情况）
    if total_chunks > buf.get("total_chunks", 0):
        buf["total_chunks"] = total_chunks

    buf["chunks"][chunk_index] = data_b64

    # 判断是否收齐
    if buf["chunks"].get(buf["total_chunks"] - 1) is not None or len(buf["chunks"]) >= buf["total_chunks"]:
        # 所有分块收齐，拼接并写入磁盘
        full_b64 = ""
        for i in range(buf["total_chunks"]):
            c = buf["chunks"].get(i)
            if c is None:
                log.error(f"写入 {path}: 缺少分块 {i}/{buf['total_chunks']}")
                return {"success": False, "error": f"缺少分块 {i}"}
            full_b64 += c

        data = base64.b64decode(full_b64)
        abs_path = ROOT / path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(data)

        del CHUNK_WRITE_BUFFERS[cmd_id]
        log.info(f"Wrote {len(data)} bytes to {path} ({buf['total_chunks']} chunks)")
        return {"success": True, "data": {"size": len(data)}}

    return {"success": True}


def handle_read_file(cmd: dict) -> dict:
    """按 offset + length 读取文件的一个分块。"""
    path = cmd.get("path", "")
    offset = cmd.get("offset", 0)
    length = cmd.get("length", 0)

    abs_path = ROOT / path
    if not abs_path.exists():
        return {"success": False, "error": "文件不存在"}

    fd = os.open(str(abs_path), os.O_RDONLY)
    try:
        raw = os.pread(fd, length, offset)
    finally:
        os.close(fd)

    b64 = base64.b64encode(raw).decode()
    bytes_read = len(raw)
    is_eof = bytes_read < length

    return {
        "success": True,
        "data": b64,
        "bytesRead": bytes_read,
        "isEOF": is_eof,
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
            result = handler(cmd)
        elif cmd_type == "write_file_data":
            result = handler(cmd)
        elif cmd_type == "read_file":
            result = handle_read_file(cmd)
            if result.get("success"):
                return {
                    "id": cmd_id,
                    "type": "read_file_data",
                    "success": True,
                    "data": result.get("data", ""),
                    "bytesRead": result.get("bytesRead", 0),
                    "isEOF": result.get("isEOF", True),
                }
            return {"id": cmd_id, "success": False, "error": result.get("error", "读取失败")}
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

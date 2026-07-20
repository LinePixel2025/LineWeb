import asyncio
import websockets
import json
import os
import base64
import logging
import shutil
import struct
import hashlib
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

# 当前活跃的写入临时文件（单线程缓存，同一时间只处理一个上传）
_active_write_file: dict = {}  # { "path": ..., "fd": ..., "tmp_path": ... }

active_streams: dict = {}  # { stream_id: { "type": "write", "file": f, "sha256": h, "bytes_written": int } }

# === 文件操作函数 ===

def handle_write_file(cmd: dict) -> dict:
    """初始化分块写入 — 单块直接写入，或多块打开 .tmp 准备接收数据。"""
    global _active_write_file
    path = cmd.get("path", "")
    total_size = cmd.get("totalSize", 0)
    data_b64 = cmd.get("data", "")
    is_last = cmd.get("isLast", False)

    # 单块模式：data + isLast → 直接写入最终文件（兼容新旧 Express 代码）
    # P16: Single-chunk base64 overhead acceptable for files <64KB; larger files use chunked mode
    if data_b64 and is_last:
        data = base64.b64decode(data_b64)
        abs_path = ROOT / path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(data)
        log.info(f"Wrote {len(data)} bytes to {path} (inline single chunk)")
        return {"success": True, "data": {"size": len(data)}}

    # 多块模式 — 打开 .tmp 文件准备接收分块数据
    tmp_path = ROOT / (path + ".tmp")
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_BINARY)

    # 关闭之前的活跃句柄（异常情况保护）
    if _active_write_file.get("fd") is not None:
        try:
            os.close(_active_write_file["fd"])
        except OSError:
            pass

    _active_write_file = {
        "path": path,
        "fd": fd,
        "tmp_path": tmp_path,
    }

    log.info(f"Start chunked write: {path} ({total_size} bytes)")
    return {"success": True}


def handle_write_file_data(cmd: dict) -> dict:
    """每个分块到达时立即追加写入 .tmp 文件。"""
    global _active_write_file
    path = cmd.get("path", "")
    data_b64 = cmd.get("data", "")
    is_last = cmd.get("isLast", False)

    # 检查活跃文件是否匹配
    if _active_write_file.get("path") != path or _active_write_file.get("fd") is None:
        log.warning(f"write_file_data: 未找到活跃写入文件 (path={path})")
        return {"success": False, "error": "未找到活跃写入文件"}

    fd = _active_write_file["fd"]
    try:
        data = base64.b64decode(data_b64)
        os.write(fd, data)

        if is_last:
            os.fsync(fd)  # P15: 仅最后一块强制落盘，确保文件完整性
            os.close(fd)
            final_path = ROOT / path
            os.rename(str(_active_write_file["tmp_path"]), str(final_path))
            _active_write_file = {}
            log.info(f"Wrote {len(data)} bytes final chunk to {path}, file complete")
        else:
            log.info(f"Wrote {len(data)} bytes chunk to {path}.tmp")

        return {"success": True}
    except Exception as e:
        log.error(f"写入分块失败: {e}")
        # 异常时尝试关闭句柄
        try:
            os.close(fd)
        except OSError:
            pass
        _active_write_file = {}
        return {"success": False, "error": str(e)}


def handle_read_file(cmd: dict) -> dict:
    """按 offset + length 读取文件的一个分块。"""
    path = cmd.get("path", "")
    offset = cmd.get("offset", 0)
    length = cmd.get("length", 0)

    abs_path = ROOT / path
    if not abs_path.exists():
        return {"success": False, "error": "文件不存在"}

    with open(str(abs_path), 'rb') as f:
        f.seek(offset)
        raw = f.read(length)

    b64 = base64.b64encode(raw).decode()
    bytes_read = len(raw)
    is_eof = bytes_read < length

    return {
        "success": True,
        "data": b64,
        "bytesRead": bytes_read,
        "isEOF": is_eof,
    }


async def handle_binary_frame(ws, data: bytes):
    """处理二进制帧 — 按 streamId 路由到写入流。"""
    if len(data) < 4:
        return
    stream_id = struct.unpack(">I", data[:4])[0]
    payload = data[4:]

    stream = active_streams.get(stream_id)
    if not stream or stream.get("type") != "write":
        log.warning(f"收到未知流 streamId={stream_id} 的二进制帧")
        return

    try:
        f = stream["file"]
        f.write(payload)
        stream["sha256"].update(payload)
        stream["bytes_written"] += len(payload)
    except Exception as e:
        log.error(f"写入流 streamId={stream_id} 失败: {e}")
        try:
            stream["file"].close()
        except:
            pass
        active_streams.pop(stream_id, None)


async def handle_read_file_stream(ws, cmd):
    """二进制流式读取 — 发送一次命令，持续推送二进制帧直到读完或 length 耗尽。"""
    stream_id = cmd.get("streamId", 0)
    cmd_id = cmd.get("id", "")
    path = cmd.get("path", "")
    offset = cmd.get("offset", 0)
    length = cmd.get("length")  # None = 读到文件末尾

    abs_path = ROOT / path
    if not abs_path.exists():
        await ws.send(json.dumps({
            "id": cmd_id,
            "type": "stream_end",
            "streamId": stream_id,
            "success": False,
            "error": "文件不存在",
        }))
        return

    # 发送 ack 让服务端 sendCommand() 立即返回，不阻塞后续流
    await ws.send(json.dumps({"id": cmd_id, "success": True}))

    h = hashlib.sha256()
    bytes_read = 0
    CHUNK = 2 * 1024 * 1024  # 2MB

    try:
        with open(str(abs_path), "rb") as f:
            f.seek(offset)
            remaining = length
            while True:
                read_size = CHUNK if remaining is None else min(CHUNK, remaining)
                chunk = f.read(read_size)
                if not chunk:
                    break
                h.update(chunk)
                bytes_read += len(chunk)
                frame = struct.pack(">I", stream_id) + chunk
                await ws.send(frame)  # websockets library: bytes -> binary frame
                if remaining is not None:
                    remaining -= len(chunk)
                    if remaining <= 0:
                        break

        await ws.send(json.dumps({
            "type": "stream_end",
            "streamId": stream_id,
            "sha256": h.hexdigest(),
            "bytesRead": bytes_read,
            "success": True,
        }))
    except Exception as e:
        log.error(f"read_file_stream 失败 ({path}): {e}")
        await ws.send(json.dumps({
            "type": "stream_end",
            "streamId": stream_id,
            "success": False,
            "error": str(e),
        }))


def handle_write_file_stream(cmd):
    """初始化二进制流写入 — 打开 .tmp 文件准备接收数据。"""
    stream_id = cmd.get("streamId", 0)
    path = cmd.get("path", "")
    total_size = cmd.get("totalSize", 0)

    tmp_path = ROOT / (path + ".tmp")
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    f = open(str(tmp_path), "wb")

    active_streams[stream_id] = {
        "type": "write",
        "path": path,
        "tmp_path": str(tmp_path),
        "file": f,
        "sha256": hashlib.sha256(),
        "bytes_written": 0,
        "total_size": total_size,
    }

    log.info(f"Start binary stream write: {path} (stream {stream_id})")
    return {"success": True}


async def handle_stream_eof(ws, cmd):
    """流结束 — fsync + close + rename + SHA-256 校验。"""
    stream_id = cmd.get("streamId", 0)
    cmd_id = cmd.get("id", "")
    expected_sha256 = cmd.get("sha256", "")

    stream = active_streams.pop(stream_id, None)
    if not stream:
        await ws.send(json.dumps({
            "id": cmd_id,
            "type": "stream_end",
            "streamId": stream_id,
            "success": False,
            "error": "无效的 streamId",
        }))
        return

    try:
        f = stream["file"]
        f.flush()
        os.fsync(f.fileno())
        f.close()

        actual_sha256 = stream["sha256"].hexdigest()
        match = actual_sha256 == expected_sha256

        if match:
            final_path = str(ROOT / stream["path"])
            os.rename(stream["tmp_path"], final_path)
            log.info(f"Binary stream write complete: {stream['path']} ({stream['bytes_written']} bytes)")
        else:
            os.unlink(stream["tmp_path"])
            log.error(f"Binary stream SHA-256 mismatch: {stream['path']} (expected={expected_sha256[:8]}..., actual={actual_sha256[:8]}...)")

        await ws.send(json.dumps({
            "id": cmd_id,
            "type": "stream_end",
            "streamId": stream_id,
            "sha256": actual_sha256,
            "bytesWritten": stream["bytes_written"],
            "success": match,
            "checksumMatch": match,
            "error": None if match else "SHA-256 校验不匹配",
        }))
    except Exception as e:
        log.error(f"stream_eof 失败 (stream {stream_id}): {e}")
        try:
            stream["file"].close()
        except:
            pass
        await ws.send(json.dumps({
            "id": cmd_id,
            "type": "stream_end",
            "streamId": stream_id,
            "success": False,
            "error": str(e),
        }))


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

    # 处理新的流式命令（不在 HANDLERS 字典中，需优先路由）
    if cmd_type == "read_file_stream":
        await handle_read_file_stream(ws, cmd)
        return None  # 异步处理，不返回同步响应
    if cmd_type == "write_file_stream":
        result = handle_write_file_stream(cmd)
        return {"id": cmd_id, **result}
    if cmd_type == "stream_eof":
        await handle_stream_eof(ws, cmd)
        return None

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
                    if isinstance(message, bytes):
                        # 二进制帧：处理写入流数据（Task 8 实现）
                        await handle_binary_frame(ws, message)
                    else:
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

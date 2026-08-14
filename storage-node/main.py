import asyncio
import websockets
import json
import os
import base64
import logging
import shutil
import struct
import hashlib
import ctypes
import platform
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

# 配置
CONFIG_PATH = Path(__file__).parent / "config.json"
config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
config["serverUrl"] = os.environ.get("LINEWEB_STORAGE_SERVER_URL", config["serverUrl"])
config["token"] = os.environ.get("LINEWEB_STORAGE_TOKEN", config["token"])
config["storagePath"] = os.environ.get("LINEWEB_STORAGE_PATH", config["storagePath"])

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

# 活跃的二进制流写入（stream_id → 流状态）。每个流拥有独立的文件句柄与 SHA-256 上下文，
# 因此多个上传可以并发进行。旧 base64 分块写入路径（write_file/write_file_data）已移除。
active_streams: dict = {}  # { stream_id: { "type": "write", "file": f, "sha256": h, "bytes_written": int } }

# === 阻塞 I/O 线程池化 — 防止 fsync/rmtree/目录遍历等同步操作卡死事件循环 ===
# 方案 B：重 I/O 丢线程池执行；方案 C：信号量限流，防止并发重操作打满磁盘 I/O。
_io_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="storage-io")
_io_sem = asyncio.Semaphore(2)  # 同时最多 2 个重 I/O 操作


async def run_io(fn, *args):
    """在限流 + 线程池中执行同步阻塞 I/O，返回其返回值。"""
    async with _io_sem:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_io_executor, fn, *args)

def resolve_safe_path(raw_path: str) -> Path:
    if not isinstance(raw_path, str) or not raw_path:
        raise ValueError("非法路径")
    normalized = raw_path.replace('\\', '/')
    root = ROOT.resolve()
    candidate = (ROOT / normalized).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("非法路径")
    return candidate

# === 文件操作函数 ===

def handle_read_file(cmd: dict) -> dict:
    """按 offset + length 读取文件的一个分块。"""
    path = cmd.get("path", "")
    offset = cmd.get("offset", 0)
    length = cmd.get("length", 0)

    abs_path = resolve_safe_path(path)
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

    abs_path = resolve_safe_path(path)
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

    resolve_safe_path(path)
    tmp_path = resolve_safe_path(path + ".tmp")
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


def _commit_stream(stream: dict, expected_sha256: str) -> dict:
    """同步执行流提交：flush + fsync + close + rename/unlink + SHA-256 校验。

    在线程池中运行，避免 fsync（强制刷盘）阻塞事件循环。
    """
    f = stream["file"]
    f.flush()
    os.fsync(f.fileno())
    f.close()

    actual_sha256 = stream["sha256"].hexdigest()
    match = actual_sha256 == expected_sha256

    if match:
        final_path = str(resolve_safe_path(stream["path"]))
        os.rename(stream["tmp_path"], final_path)
        log.info(f"Binary stream write complete: {stream['path']} ({stream['bytes_written']} bytes)")
    else:
        os.unlink(stream["tmp_path"])
        log.error(f"Binary stream SHA-256 mismatch: {stream['path']} (expected={expected_sha256[:8]}..., actual={actual_sha256[:8]}...)")

    return {
        "sha256": actual_sha256,
        "bytesWritten": stream["bytes_written"],
        "success": match,
        "checksumMatch": match,
        "error": None if match else "SHA-256 校验不匹配",
    }


async def handle_stream_eof(ws, cmd):
    """流结束 — 在线程池中执行 fsync + close + rename + SHA-256 校验。"""
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
        result = await run_io(_commit_stream, stream, expected_sha256)
        await ws.send(json.dumps({
            "id": cmd_id,
            "type": "stream_end",
            "streamId": stream_id,
            **result,
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
    abs_path = resolve_safe_path(path)
    if abs_path.is_dir():
        shutil.rmtree(abs_path)
    else:
        abs_path.unlink(missing_ok=True)
    log.info(f"Deleted {path}")
    return {"success": True}


def handle_mkdir(path: str) -> dict:
    abs_path = resolve_safe_path(path)
    abs_path.mkdir(parents=True, exist_ok=True)
    return {"success": True}


def handle_move(path: str, new_path: str) -> dict:
    src = resolve_safe_path(path)
    dst = resolve_safe_path(new_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return {"success": True}


def handle_rename(path: str, new_name: str) -> dict:
    src = resolve_safe_path(path)
    if not new_name or Path(new_name).name != new_name or new_name in ('.', '..'):
        raise ValueError("非法文件名")
    dst = src.parent / new_name
    src.rename(dst)
    return {"success": True}


def handle_stat(path: str) -> dict:
    abs_path = resolve_safe_path(path)
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
    abs_path = resolve_safe_path(path)
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
    "read_file":   handle_read_file,
    "delete_file": handle_delete_file,
    "mkdir":       handle_mkdir,
    "move":        handle_move,
    "rename":      handle_rename,
    "stat":        handle_stat,
    "list_dir":    handle_list_dir,
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
        resolve_safe_path(cmd.get("path", ""))
        await handle_read_file_stream(ws, cmd)
        return None  # 异步处理，不返回同步响应
    if cmd_type == "write_file_stream":
        resolve_safe_path(cmd.get("path", ""))
        result = handle_write_file_stream(cmd)
        return {"id": cmd_id, **result}
    if cmd_type == "stream_eof":
        stream = active_streams.get(cmd.get("streamId"))
        if not stream:
            return {"id": cmd_id, "success": False, "error": "无效的 streamId"}
        resolve_safe_path(stream.get("path", ""))
        await handle_stream_eof(ws, cmd)
        return None

    handler = HANDLERS.get(cmd_type)
    if not handler:
        return {"id": cmd_id, "success": False, "error": f"未知命令: {cmd_type}"}

    # 安全校验：防止路径遍历
    raw_path = cmd.get("path", "")
    path = Path(raw_path.replace('\\', '/')).as_posix()
    try:
        resolve_safe_path(path)
    except ValueError as exc:
        return {"id": cmd_id, "success": False, "error": str(exc)}

    try:
        if cmd_type == "read_file":
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
            resolve_safe_path(new_path)
            result = handler(path, new_path)
        elif cmd_type == "rename":
            result = handler(path, cmd.get("newName", ""))
        elif cmd_type in ("delete_file", "list_dir"):
            # 重 I/O（rmtree / 目录遍历 + stat）：线程池 + 限流执行，避免阻塞事件循环
            result = await run_io(handler, path)
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


class KeepAwake:
    """运行期间阻止系统休眠（仅 Windows，通过 SetThreadExecutionState 实现）。

    - ES_CONTINUOUS：使设置持续生效（否则仅对下一次睡眠请求有效一次）
    - ES_SYSTEM_REQUIRED：阻止系统进入睡眠，但允许显示器正常关闭
    程序退出或调用 disable() 后恢复默认电源行为；即便进程被强杀，
    SetThreadExecutionState 绑定线程，线程终止时系统也会自动清除该设置。
    """

    ES_CONTINUOUS = 0x80000000
    ES_SYSTEM_REQUIRED = 0x00000001

    def __init__(self) -> None:
        self._kernel32 = None

    def enable(self) -> None:
        if platform.system() != "Windows":
            log.info("非 Windows 平台，跳过阻止休眠")
            return
        try:
            kernel32 = ctypes.windll.kernel32
            kernel32.SetThreadExecutionState.restype = ctypes.c_uint
            kernel32.SetThreadExecutionState.argtypes = [ctypes.c_uint]
            kernel32.SetThreadExecutionState(
                self.ES_CONTINUOUS | self.ES_SYSTEM_REQUIRED
            )
            self._kernel32 = kernel32
            log.info("已启用阻止休眠（系统睡眠被抑制，显示器可正常关闭）")
        except Exception as exc:
            log.warning(f"启用阻止休眠失败: {exc}")

    def disable(self) -> None:
        if self._kernel32 is None:
            return
        try:
            # 仅传 ES_CONTINUOUS（不再含 SYSTEM_REQUIRED）即清除阻止休眠标志
            self._kernel32.SetThreadExecutionState(self.ES_CONTINUOUS)
            self._kernel32 = None
            log.info("已恢复系统休眠设置")
        except Exception as exc:
            log.warning(f"恢复休眠设置失败: {exc}")


def main():
    log.info(f"存储节点启动 — 根目录: {ROOT}, 服务器: {config['serverUrl']}")
    keep_awake = KeepAwake()
    keep_awake.enable()
    try:
        asyncio.run(connect())
    except KeyboardInterrupt:
        log.info("用户终止")
    finally:
        keep_awake.disable()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Time Master 屏幕时间推送脚本示例。

用法：
    export LINEWEB_USERNAME="admin"
    export LINEWEB_PASSWORD="你的密码"
    export LINEWEB_API_URL="http://localhost:3001"   # 可选
    python scripts/time-master-push.py [--now]

认证说明（2026-09 起）：
    LineWeb 只接受「账号登录令牌」，不再有独立的屏幕时间 Token。
    本脚本用账号密码登录换取 JWT，并在收到 401 时自动重新登录。
    如需免去反复登录，可设置 LINEWEB_TOKEN（登录令牌）直接复用；
    或把登录请求里的 rememberDays 调大（1–90 天）让令牌更耐久。

说明：
    用户需要自行实现 get_total_seconds_today() 函数，从 Time Master 软件
    的本地数据文件或 API 中读取今日累计屏幕使用秒数。
"""

import os
import sys
import time
import argparse
from datetime import datetime
import requests

# 登录令牌有效期（天），仅影响 login() 换取的令牌寿命
REMEMBER_DAYS = int(os.environ.get("LINEWEB_REMEMBER_DAYS", "90"))


def get_total_seconds_today() -> int:
    """从 Time Master 读取今日累计屏幕使用秒数。

    TODO: 根据实际 Time Master 的数据格式实现。
    这里返回一个占位值，方便测试推送接口是否可用。
    """
    # 示例：读取某个本地 JSON 文件
    # with open(os.path.expanduser("~/.time-master/daily.json")) as f:
    #     data = json.load(f)
    # return data.get("today", 0)
    return 3600  # 占位：1 小时


def base_url() -> str:
    return os.environ.get("LINEWEB_API_URL", "http://localhost:3001").rstrip("/")


def login() -> str:
    """用账号密码换取访问令牌。"""
    username = os.environ.get("LINEWEB_USERNAME")
    password = os.environ.get("LINEWEB_PASSWORD")
    if not username or not password:
        print(
            "错误：请设置环境变量 LINEWEB_USERNAME / LINEWEB_PASSWORD，"
            "或直接提供 LINEWEB_TOKEN",
            file=sys.stderr,
        )
        sys.exit(1)

    resp = requests.post(
        f"{base_url()}/api/auth/login",
        json={"identifier": username, "password": password, "rememberDays": REMEMBER_DAYS},
        timeout=30,
    )
    if resp.status_code == 429:
        raise RuntimeError("登录过于频繁（限流 20 次/15 分钟），请稍后重试")
    resp.raise_for_status()
    return resp.json()["token"]


class TokenStore:
    """内存缓存令牌；401 时自动重新登录一次。"""

    def __init__(self) -> None:
        self._token: str | None = os.environ.get("LINEWEB_TOKEN") or None

    def get(self) -> str:
        if not self._token:
            self._token = login()
        return self._token

    def refresh(self) -> str:
        # LINEWEB_TOKEN 是用户显式提供的，失效时不自动重新登录
        if not os.environ.get("LINEWEB_TOKEN"):
            self._token = login()
        else:
            print("提示：LINEWEB_TOKEN 已失效，请重新设置或改用账号密码登录", file=sys.stderr)
        return self.get()


token_store = TokenStore()


def push(total_seconds: int) -> None:
    url = f"{base_url()}/api/health/push"
    date = datetime.now().strftime("%Y-%m-%d")
    payload = {"totalSeconds": total_seconds, "date": date}

    resp = requests.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {token_store.get()}"},
        timeout=30,
    )

    if resp.status_code == 401:
        # 令牌过期 / 已在服务器端失效（如改过密码）→ 重新登录一次
        resp = requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token_store.refresh()}"},
            timeout=30,
        )

    resp.raise_for_status()
    print(f"已同步 {total_seconds} 秒 ({date})")


def main() -> None:
    parser = argparse.ArgumentParser(description="推送屏幕时间到 LineWeb")
    parser.add_argument("--now", action="store_true", help="立即推送一次")
    args = parser.parse_args()

    if args.now:
        push(get_total_seconds_today())
        return

    # 默认每 15 分钟推送一次
    interval = int(os.environ.get("LINEWEB_PUSH_INTERVAL_SECONDS", "900"))
    while True:
        try:
            push(get_total_seconds_today())
        except Exception as e:
            print(f"推送失败: {e}", file=sys.stderr)
        time.sleep(interval)


if __name__ == "__main__":
    main()

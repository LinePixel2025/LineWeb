#!/usr/bin/env python3
"""Time Master 屏幕时间推送脚本示例。

用法：
    export LINEWEB_SCREEN_TIME_TOKEN="st_xxx"
    export LINEWEB_API_URL="http://localhost:3001"
    python scripts/time-master-push.py [--now]

说明：
    用户需要自行实现 get_total_seconds_today() 函数，从 Time Master 软件
    的本地数据文件或 API 中读取今日累计屏幕使用秒数。
"""

import os
import sys
import argparse
from datetime import datetime
import requests


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


def push(total_seconds: int) -> None:
    token = os.environ.get("LINEWEB_SCREEN_TIME_TOKEN")
    if not token:
        print("错误：请设置环境变量 LINEWEB_SCREEN_TIME_TOKEN", file=sys.stderr)
        sys.exit(1)

    base_url = os.environ.get("LINEWEB_API_URL", "http://localhost:3001")
    url = f"{base_url}/api/health/push"
    date = datetime.now().strftime("%Y-%m-%d")

    resp = requests.post(
        url,
        json={"totalSeconds": total_seconds, "date": date},
        headers={"X-Screen-Time-Token": token},
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
    import time
    interval = int(os.environ.get("LINEWEB_PUSH_INTERVAL_SECONDS", "900"))
    while True:
        try:
            push(get_total_seconds_today())
        except Exception as e:
            print(f"推送失败: {e}", file=sys.stderr)
        time.sleep(interval)


if __name__ == "__main__":
    main()

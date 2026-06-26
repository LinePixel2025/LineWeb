---
name: git-push-policy
description: 不要自动推送 GitHub，只在用户要求后推送
metadata:
  type: feedback
---

用户要求：后续开发中，提交 commit 后不要自动 `git push` 到 GitHub。只有在用户明确说「推送」或「同步到 GitHub」时才执行推送。

**Why:** 用户希望自己控制何时推送到远程仓库，避免过早推送或推送不完整的改动。

**How to apply:** `git commit` 后停止，不执行 `git push`。等用户说「推送」「push」「同步到 GitHub」等明确指令后再推送。即使提交信息写好了，也等用户确认后再推。

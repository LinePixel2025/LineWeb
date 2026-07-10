# Task 5: Storage Sync Exclusion

## Files:
- Modify: `server/src/services/storageSync.ts` (跳过 `_avatars/` 路径)

## Steps

### Step 1: 在 syncDriveFiles 中过滤 _avatars/ 路径

在 `syncDriveFiles` 函数中，在获取 `nodePaths` 并设置 `report.scanned` 之后，添加过滤逻辑：

找到这段代码：
```typescript
    const nodePaths = await listDirRecursive('')
    report.scanned = nodePaths.length
```

修改为：
```typescript
    const nodePaths = await listDirRecursive('')
    // 排除隐藏的系统目录（如 _avatars/），这些不应出现在网盘中
    const filteredPaths = nodePaths.filter(p => !p.startsWith('_avatars/'))
    report.scanned = filteredPaths.length
```

然后修改后续使用 `nodePaths` 的地方，改为使用 `filteredPaths`：
- `const nodePathSet = new Set(filteredPaths)`（原为 `nodePaths`）
- `for (const nodePath of filteredPaths)`（原为 `nodePaths`）

### Step 2: 验证

Run: `cd server && npx tsc --noEmit`
Expected: No errors

### Step 3: 提交

```bash
git add server/src/services/storageSync.ts
git commit -m "fix: skip _avatars/ directory in drive file sync"
```

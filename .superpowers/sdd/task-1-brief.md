# Task 1: Database Schema + Dependencies

## Files:
- Modify: `server/prisma/schema.prisma` (User 模型新增 avatarPath)
- Modify: `server/package.json` (添加 sharp 依赖)
- Execute: `cd server && npm install && npx prisma db push`

## Interfaces:
- Produces: `User.avatarPath: String?` — 存储节点路径（如 `_avatars/1.webp`）

## Steps

### Step 1: 修改 Prisma Schema

User 模型新增 `avatarPath` 字段：

```prisma
model User {
  id               Int       @id @default(autoincrement())
  username         String    @unique
  email            String    @unique
  password         String
  role             String    @default("user")
  settings         String?
  canAccessDrive   Boolean   @default(false)
  avatarPath       String?   @map("avatar_path")
  tokenValidAfter  DateTime  @default(now()) @map("token_valid_after")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")
  posts            Post[]
  comments         Comment[]
  driveFiles       DriveFile[]
  apiKeys          ApiKey[]
  @@map("users")
}
```

### Step 2: 安装 sharp 依赖

Run: `cd server && npm install sharp && npm install -D @types/sharp`

### Step 3: 同步数据库

Run: `cd server && npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.`

### Step 4: 提交

```bash
git add server/prisma/schema.prisma server/package.json server/package-lock.json
git commit -m "feat: add avatarPath field to User model and install sharp"
```

/**
 * 一次性数据脚本：把存量普通用户（role = 'user'）提升为 author
 *
 * 背景：新注册用户默认就是 author 角色（可发布自己的文章），但历史账号仍是 user。
 * 生产环境部署本次改动后执行一次本脚本即可统一；幂等——只更新 role='user' 的账号，
 * 重复执行不会重复影响 admin / author。
 *
 * 用法: cd server && npx tsx scripts/promote-users-to-author.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const result = await prisma.user.updateMany({
    where: { role: 'user' },
    data: { role: 'author' },
  })
  console.log(`✓ 已将 ${result.count} 个 user 角色账号提升为 author`)
}

main()
  .catch((e) => {
    console.error('提升账号角色失败:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

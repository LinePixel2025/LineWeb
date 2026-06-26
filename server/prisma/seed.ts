import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // 检查用户是否已存在，避免每次部署都跑 bcrypt（~700ms 浪费）
  const existingAdmin = await prisma.user.findUnique({ where: { username: 'admin' } })
  const existingLine = await prisma.user.findUnique({ where: { username: 'Line' } })

  if (!existingAdmin) {
    const password = await bcrypt.hash('admin123', 12)
    await prisma.user.create({
      data: { username: 'admin', email: 'admin@lineweb.dev', password, role: 'admin' },
    })
    console.log('✓ 管理员 admin 已创建')
  }
  if (!existingLine) {
    const password = await bcrypt.hash('liang798119', 12)
    await prisma.user.create({
      data: { username: 'Line', email: 'line@lineweb.dev', password, role: 'admin' },
    })
    console.log('✓ 管理员 Line 已创建')
  }

  // 创建示例文章（仅首次）
  const existingPosts = await prisma.post.count()
  if (existingPosts === 0) {
    await prisma.post.create({
      data: {
        title: '欢迎来到 Line Web',
        content: `<h1>欢迎</h1>

<p>这是 Line Web 的第一篇文章。Line Web 是一个使用 Liquid Glass 设计语言的个人网站。</p>

<h2>关于</h2>

<p>Line Web 融合了 Apple 最新的 Liquid Glass 设计理念，提供流畅、现代的用户体验。</p>

<h2>功能</h2>

<ul>
<li>✨ Liquid Glass 视觉效果</li>
<li>📝 文章发布与管理</li>
<li>🧮 在线计算器</li>
<li>🌓 亮色/暗色模式</li>
<li>📱 响应式设计</li>
</ul>`,
        summary: '欢迎来到 Line Web — 一个使用 Liquid Glass 设计语言的个人网站。',
        slug: 'welcome-to-lineweb',
        published: true,
        authorId: 1,
      },
    })
    console.log('✓ 示例文章已创建')
  }

  // 创建示例评论（仅首次，需要文章存在）
  const existingComments = await prisma.comment.count()
  if (existingComments === 0) {
    const post = await prisma.post.findFirst({ where: { published: true } })
    const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } })
    if (post && adminUser) {
      await prisma.comment.create({
        data: {
          content: '欢迎来到 Line Web！这是一个示例评论，由系统自动创建。',
          postId: post.id,
          authorId: adminUser.id,
        },
      })
      console.log('✓ 示例评论已创建')
    }
  }

  console.log('✓ 数据库已初始化')
}

main()
  .catch((e) => {
    console.error('种子数据失败:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

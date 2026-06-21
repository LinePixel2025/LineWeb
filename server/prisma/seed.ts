import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // 创建默认管理员
  const adminPassword = await bcrypt.hash('admin123', 12)
  await prisma.user.upsert({
    where: { email: 'admin@lineweb.dev' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@lineweb.dev',
      password: adminPassword,
      role: 'admin',
    },
  })

  // 创建第二个管理员：Line
  const linePassword = await bcrypt.hash('liang798119', 12)
  await prisma.user.upsert({
    where: { email: 'line@lineweb.dev' },
    update: {},
    create: {
      username: 'Line',
      email: 'line@lineweb.dev',
      password: linePassword,
      role: 'admin',
    },
  })

  // 创建示例文章
  const existing = await prisma.post.count()
  if (existing === 0) {
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
  }

  console.log('✓ 数据库已初始化')
}

main()
  .catch((e) => {
    console.error('种子数据失败:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

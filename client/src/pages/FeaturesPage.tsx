import { Link } from 'react-router-dom'
import { useFeaturedPages } from '../hooks/useQueries'
import { Badge, Icon, type IconName } from '../components/ui'

interface FeaturedPage {
  id: number
  title: string
  slug: string
  featureEmoji: string | null
  featureDesc: string | null
}

const featureIcons: Record<string, IconName> = {
  calculator: 'settings',
  games: 'gamepad',
  posts: 'book',
  profile: 'user',
  aichat: 'sparkles',
  webproxy: 'globe',
}

const features = [
  {
    title: '科学计算器',
    desc: '三角函数、对数、幂、阶乘、括号、DEG/RAD、记忆与历史',
    path: '/calculator',
    icon: 'calculator',
  },
  {
    title: '游戏大厅',
    desc: '单机或与好友联机畅玩 2048',
    path: '/games',
    icon: 'games',
    badge: '联机',
  },
  {
    title: 'DeepSeek 对话',
    desc: '与站内 AI 对话，支持图片提问',
    path: '/deepseek',
    icon: 'aichat',
    badge: '需登录',
  },
  {
    title: '网页反代',
    desc: '输入域名直接打开其他网站，登录态随账号保存',
    path: '/webproxy',
    icon: 'webproxy',
    badge: '需登录',
  },
  {
    title: '文章阅读',
    desc: '浏览已发布的文章，支持完整的 Markdown 渲染',
    path: '/posts',
    icon: 'posts',
  },
  {
    title: '个人中心',
    desc: '管理你的账号信息与个人资料',
    path: '/profile',
    icon: 'profile',
    badge: '需登录',
  },
]

export default function FeaturesPage() {
  const { data: featuredData, isSuccess } = useFeaturedPages()
  const customPages = featuredData?.pages ?? []

  return (
    <div className="gh-page-container">
      <div className="gh-page-header gh-page-header--center">
        <h1 className="gh-page-title">功能页面</h1>
        <p className="gh-page-subtitle">探索 Line Web 提供的各种工具与功能</p>
      </div>

      <div className="gh-feature-grid">
        {features.map((item) => (
          <Link key={item.path} to={item.path} className="gh-feature-card">
            <span className="gh-feature-card-icon"><Icon name={featureIcons[item.icon]} size={24} /></span>
            <h3 className="gh-feature-card-title">{item.title}</h3>
            <p className="gh-feature-card-desc">{item.desc}</p>
            {item.badge && <Badge variant="accent">{item.badge}</Badge>}
          </Link>
        ))}
      </div>

      {customPages.length > 0 && (
        <section className="gh-feature-custom-pages" aria-labelledby="custom-pages-heading">
          <h2 id="custom-pages-heading" className="gh-feature-custom-pages-title">自定义页面</h2>
          <div className="gh-feature-grid">
            {customPages.map((item) => (
              <Link key={item.slug} to={`/page/${item.slug}`} className="gh-feature-card">
                <span className="gh-feature-card-icon gh-feature-card-emoji">
                  {item.featureEmoji || <Icon name="file" size={24} />}
                </span>
                <h3 className="gh-feature-card-title">{item.title}</h3>
                {item.featureDesc && <p className="gh-feature-card-desc">{item.featureDesc}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {isSuccess && customPages.length === 0 && (
        <p className="gh-text-tertiary u-center-text u-mt-4">管理员尚未添加自定义模块</p>
      )}
    </div>
  )
}

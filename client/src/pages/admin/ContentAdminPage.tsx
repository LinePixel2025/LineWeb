import AdminTabShell from './AdminTabShell'
import { ContentPostsPanel } from '../AdminPage'
import { ContentPagesPanel } from './PageList'
import { ContentAnnouncementsPanel } from './AnnouncementAdminPage'
import { ContentCommentsPanel } from './CommentAdminPage'

/**
 * 内容管理（/admin）：合并原 文章管理 / 页面管理 / 站点公告 / 评论管理 四个页面。
 * Tab 按能力过滤：文章 content:write、页面/公告 content:manage、评论 comment:moderate。
 * 编辑器仍走独立路由（/admin/new、/admin/edit/:id、/admin/pages/new、/admin/pages/:id/edit）。
 * 旧地址 /admin/pages|announcements|comments 由 App.tsx 重定向到对应 Tab。
 */
export default function ContentAdminPage() {
  return (
    <AdminTabShell
      tabs={[
        { value: 'posts', label: '文章', capability: 'content:write', content: <ContentPostsPanel /> },
        { value: 'pages', label: '页面', capability: 'content:manage', content: <ContentPagesPanel /> },
        { value: 'announcements', label: '公告', capability: 'content:manage', content: <ContentAnnouncementsPanel /> },
        { value: 'comments', label: '评论', capability: 'comment:moderate', content: <ContentCommentsPanel /> },
      ]}
    />
  )
}

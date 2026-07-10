# Task 7: Frontend Integration

## Files:
- Modify: `client/src/components/comments/CommentSection.tsx` (评论者头像)
- Modify: `client/src/components/Navbar.tsx` (当前用户头像)
- Modify: `client/src/pages/ProfilePage.tsx` (头像上传)
- Modify: `client/src/pages/admin/UserAdminPage.tsx` (用户列表头像)

## Steps

### Step 1: 评论 card 添加 UserAvatar

在 `client/src/components/comments/CommentSection.tsx` 中导入 UserAvatar：
```tsx
import UserAvatar from '../UserAvatar'
```

在 `CommentCard` 组件的 comment-meta div 中，在作者名前添加 UserAvatar：
```tsx
<div className="comment-meta">
  <UserAvatar userId={comment.author.id} username={comment.author.username} size="sm" />
  <span className="comment-author">{comment.author.username}</span>
  <span className="comment-time">{new Date(comment.createdAt).toLocaleString('zh-CN')}</span>
</div>
```

在 reply-item 的 comment-meta 中也添加：
```tsx
<div className="comment-meta">
  <UserAvatar userId={reply.author.id} username={reply.author.username} size="sm" />
  <span className="comment-author">{reply.author.username}</span>
  <span className="comment-time">{new Date(reply.createdAt).toLocaleString('zh-CN')}</span>
</div>
```

### Step 2: 导航栏添加用户头像

在 `client/src/components/Navbar.tsx` 中导入 UserAvatar：
```tsx
import UserAvatar from './UserAvatar'
```

找到用户名的 Link：
```tsx
<Link
  to="/profile"
  className={`navbar-link ${location.pathname === '/profile' ? 'active' : ''}`}
  onClick={closeMenu}
>
  {user.username}
</Link>
```

替换为：
```tsx
<Link
  to="/profile"
  className={`navbar-link ${location.pathname === '/profile' ? 'active' : ''}`}
  onClick={closeMenu}
  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
>
  <UserAvatar userId={user.id} username={user.username} size="sm" />
  {user.username}
</Link>
```

### Step 3: 个人设置页添加头像上传

在 `client/src/pages/ProfilePage.tsx` 中导入：
```tsx
import UserAvatar from '../components/UserAvatar'
```

在资料卡片（profile-card）中，"角色"显示的 div 之后、"退出登录"按钮之前添加：

```tsx
{/* 头像区域 */}
<div style={{ marginBottom: '22px', display: 'flex', alignItems: 'center', gap: '16px' }}>
  <UserAvatar userId={user!.id} username={user!.username} size="xl" />
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <label className="liquid-btn glass sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 16px' }}>
      上传头像
      <input
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          if (file.size > 2 * 1024 * 1024) {
            alert('文件大小不能超过 2MB')
            return
          }
          const formData = new FormData()
          formData.append('avatar', file)
          try {
            await fetch('/api/auth/avatar', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${localStorage.getItem('lineweb_token')}` },
              body: formData,
            })
            window.location.reload()
          } catch {
            alert('上传失败')
          }
        }}
      />
    </label>
    <LiquidButton size="sm" variant="ghost" onClick={async () => {
      try {
        await fetch('/api/auth/avatar', {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('lineweb_token')}` },
        })
        window.location.reload()
      } catch {
        alert('删除失败')
      }
    }}>
      移除头像
    </LiquidButton>
  </div>
</div>
```

### Step 4: 管理后台用户列表添加头像

在 `client/src/pages/admin/UserAdminPage.tsx` 中导入 UserAvatar：
```tsx
import UserAvatar from '../../components/UserAvatar'
```

找到用户名的 td 单元格，替换为：
```tsx
<td className="admin-cell admin-cell--title" data-label="用户名">
  <div className="admin-post-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <UserAvatar userId={u.id} username={u.username} size="sm" />
    {u.username}
  </div>
</td>
```

### Step 5: 提交

```bash
git add client/src/components/comments/CommentSection.tsx client/src/components/Navbar.tsx client/src/pages/ProfilePage.tsx client/src/pages/admin/UserAdminPage.tsx
git commit -m "feat: integrate UserAvatar into comments, navbar, profile, and admin"
```

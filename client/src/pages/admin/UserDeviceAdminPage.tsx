import AdminTabShell from './AdminTabShell'
import { UsersPanel } from './UserAdminPage'
import { DevicesPanel } from './DeviceMonitorPage'

/**
 * 用户与设备（/admin/users）：合并原 用户管理 / 设备监控 两个页面。
 * 路由守卫 user:manage；设备 Tab 额外要求 device:view（当前仅 admin 角色具备）。
 * 旧地址 /admin/devices 由 App.tsx 重定向到 /admin/users?tab=devices。
 */
export default function UserDeviceAdminPage() {
  return (
    <AdminTabShell
      tabs={[
        { value: 'users', label: '用户', content: <UsersPanel /> },
        { value: 'devices', label: '设备', capability: 'device:view', content: <DevicesPanel /> },
      ]}
    />
  )
}

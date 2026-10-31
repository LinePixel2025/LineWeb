import AdminTabShell from './AdminTabShell'
import { AiAssistantPanel } from './AiAdminPage'
import { AiChatPanel } from './AiChatAdminPage'

/**
 * AI 设置（/admin/ai）：合并原 AI 助手配置（/ai/config）与 AI 对话设置（/ai-chat/config）。
 * 两者能力同为 ai:configure（路由守卫），无需 Tab 级过滤。
 * 旧地址 /admin/ai-chat 由 App.tsx 重定向到 /admin/ai?tab=chat。
 */
export default function AiSettingsAdminPage() {
  return (
    <AdminTabShell
      tabs={[
        { value: 'assistant', label: 'AI 助手', content: <AiAssistantPanel /> },
        { value: 'chat', label: 'AI 对话', content: <AiChatPanel /> },
      ]}
    />
  )
}

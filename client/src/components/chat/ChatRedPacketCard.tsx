/**
 * 红包信封卡片（消息流内）：微信式红包卡，红色渐变底 + 🧧 圆章 + 祝福语 + 品牌小字。
 *
 * 纯展示组件：点击行为由父级（ChatMessageRow）组合长按手势后回调，
 * 卡片自身不参与长按/多选逻辑；own 消息的靠右方向由消息行容器类控制。
 */

interface Props {
  /** 祝福语（红包消息正文；空串回退默认祝福语） */
  greeting: string
  onOpen: () => void
}

export default function ChatRedPacketCard({ greeting, onOpen }: Props) {
  return (
    <button
      type="button"
      className="gh-chat-redpacket-card"
      aria-label={greeting ? `打开红包：${greeting}` : '打开红包'}
      onClick={onOpen}
    >
      <span className="gh-chat-redpacket-card-icon" aria-hidden="true">🧧</span>
      <span className="gh-chat-redpacket-card-body">
        <span className="gh-chat-redpacket-card-greeting">
          {greeting || '恭喜发财，大吉大利'}
        </span>
        <span className="gh-chat-redpacket-card-brand">LineWeb 红包</span>
      </span>
    </button>
  )
}

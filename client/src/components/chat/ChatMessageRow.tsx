import { Fragment, memo, useMemo, type ReactNode, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import NekoAvatar from './NekoAvatar'
import UserTitleBadge from '../UserTitleBadge'
import { chatImageUrl } from '../../lib/chat'
import { useLongPress } from '../../hooks/useLongPress'
import type { NekoBundleItem, NekoMessage, NekoRoomMember } from '../../types/chat'
import type { UserTitleDto } from '../../types/points'

export interface ChatMessageSender {
  id: number
  nekoId: number | null
  avatarVersion: number
  name: string
  title: UserTitleDto | null
}

export interface ChatMessageRowProps {
  message: NekoMessage
  own: boolean
  grouped: boolean
  /** showDay 为 null 时不渲染日期分隔 */
  dayLabel: string | null
  selecting: boolean
  selected: boolean
  flash: boolean
  active: boolean
  peerRead: number
  isDirect: boolean
  isRoom: boolean
  selfNekoId: number | null
  sender: ChatMessageSender
  /** 群聊成员（@ 高亮 + 引用/拍一拍名称解析）；父组件用签名稳定引用 */
  members: NekoRoomMember[]
  displayNameOf: (username: string) => string
  nameOfNekoId: (nekoId: number) => string
  onLongPress: (message: NekoMessage, x: number, y: number) => void
  onContextMenu: (message: NekoMessage, x: number, y: number) => void
  onOpenMenu: (message: NekoMessage, x: number, y: number) => void
  onToggleSelect: (messageId: number) => void
  onPokeAvatar: (nekoId: number, mode: 'double' | 'touch') => void
  onPreviewImage: (image: string) => void
  onOpenBundle: (bundle: NekoBundleItem[]) => void
  onJumpQuote: (messageId: number) => void
}

const MESSAGE_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

function formatMessageTime(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return MESSAGE_TIME_FORMAT.format(date)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 群聊正文里的 @昵称 高亮（纯文本切分，不渲染 HTML） */
function MentionText({ body, members }: { body: string; members: NekoRoomMember[] }) {
  const nodes = useMemo<ReactNode>(() => {
    if (!body || members.length === 0) return body
    const names = [...new Set([
      ...members.map((member) => member.displayName || member.username),
      '所有人',
    ])].filter(Boolean).sort((a, b) => b.length - a.length)
    if (names.length === 0) return body
    const regex = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g')
    return body.split(regex).map((part, index) =>
      part.startsWith('@') && names.includes(part.slice(1))
        ? <span key={index} className="gh-chat-mention">{part}</span>
        : <span key={index}>{part}</span>
    )
  }, [body, members])
  return <>{nodes}</>
}

/**
 * 聊天消息行（memo）。
 *
 * 单独抽出来的原因：会话里每来一条新消息、切换「回到最新」、15 秒撤回时钟
 * 都会让 ChatThread 重渲染；如果 30–100 条消息全是内联 JSX，低端设备会出现
 * 明显掉帧。这里只让真正变化的行重渲染（消息对象引用 / 选中 / 高亮 / 已读）。
 */
export default memo(function ChatMessageRow({
  message,
  own,
  grouped,
  dayLabel,
  selecting,
  selected,
  flash,
  active,
  peerRead,
  isDirect,
  isRoom,
  selfNekoId,
  sender,
  members,
  displayNameOf,
  nameOfNekoId,
  onLongPress,
  onContextMenu,
  onOpenMenu,
  onToggleSelect,
  onPokeAvatar,
  onPreviewImage,
  onOpenBundle,
  onJumpQuote,
}: ChatMessageRowProps) {
  const longPress = useLongPress((x, y) => onLongPress(message, x, y))

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (selecting) return
    longPress.begin(event)
  }
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (selecting) return
    event.preventDefault()
    onContextMenu(message, event.clientX, event.clientY)
  }

  if (message.recalled) {
    const who = own ? '你' : displayNameOf(message.fromUsername)
    return (
      <Fragment>
        {dayLabel && <div className="gh-chat-day-sep">{dayLabel}</div>}
        <div className="gh-chat-recall-line" role="status">
          {`${who}撤回了一条消息`}
          {message.byAdmin && !own ? '（管理员）' : ''}
        </div>
      </Fragment>
    )
  }

  const isSticker = Boolean(message.image) && message.body === '[表情]'
  const isImage = Boolean(message.image) && !isSticker
  const quote = message.quote
  const poke = message.poke

  return (
    <Fragment>
      {dayLabel && <div className="gh-chat-day-sep">{dayLabel}</div>}
      <div
        data-message-id={message.id}
        className={`gh-chat-message ${own ? 'gh-chat-message--own' : ''} ${
          grouped ? 'gh-chat-message--grouped' : ''
        } ${selecting ? 'gh-chat-message--selectable' : ''} ${
          selected ? 'gh-chat-message--selected' : ''
        } ${flash ? 'gh-chat-message--flash' : ''} ${active ? 'gh-chat-message--active' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={longPress.move}
        onPointerUp={longPress.end}
        onPointerCancel={longPress.end}
        onContextMenu={handleContextMenu}
      >
        {selecting && (
          <button
            type="button"
            className={`gh-chat-select-toggle ${selected ? 'gh-chat-select-toggle--on' : ''}`}
            aria-label={selected ? '取消选择该消息' : '选择该消息'}
            aria-pressed={selected}
            onClick={() => onToggleSelect(message.id)}
          >
            {selected ? '✓' : ''}
          </button>
        )}
        {!own && grouped && <span className="gh-chat-avatar-spacer" aria-hidden="true" />}
        {!own && !grouped && (
          <span
            className="gh-chat-avatar-poke"
            title="双击拍一拍"
            onDoubleClick={() => {
              if (sender.nekoId) onPokeAvatar(sender.nekoId, 'double')
            }}
            onTouchEnd={() => {
              if (sender.nekoId) onPokeAvatar(sender.nekoId, 'touch')
            }}
          >
            <NekoAvatar
              nekoId={sender.nekoId}
              avatarVersion={sender.avatarVersion}
              fallbackId={sender.id}
              name={sender.name}
              size="sm"
            />
          </span>
        )}
        <div className="gh-chat-message-body">
          <div className={`gh-chat-message-meta ${grouped ? 'gh-chat-message-meta--grouped' : ''}`}>
            {!own && !grouped && (
              <span className="gh-chat-message-sender">
                {sender.name}
                <UserTitleBadge title={sender.title} />
              </span>
            )}
            <time className="gh-chat-message-time" dateTime={new Date(message.ts).toISOString()}>
              {formatMessageTime(message.ts)}
            </time>
            {own && isDirect && (
              <span className="gh-chat-read-tag" title="对方是否已读">
                {message.id <= peerRead ? '已读' : '未读'}
              </span>
            )}
            {message.mentionedMe && <span className="gh-chat-at-badge">@我</span>}
            {!selecting && (
              <button
                type="button"
                className="gh-chat-message-more"
                aria-label="消息操作"
                title="消息操作"
                onClick={(event) => {
                  event.stopPropagation()
                  const rect = event.currentTarget.getBoundingClientRect()
                  onOpenMenu(message, rect.left, rect.bottom + 4)
                }}
              >
                ···
              </button>
            )}
          </div>
          {quote && (
            <button
              type="button"
              className="gh-chat-quote"
              title="跳到被引用的消息"
              onClick={() => onJumpQuote(quote.id)}
            >
              <span className="gh-chat-quote-name">{displayNameOf(quote.from)}</span>
              <span className="gh-chat-quote-text">{quote.text}</span>
            </button>
          )}
          {poke ? (
            <div className={`gh-chat-poke ${poke.toNekoId === selfNekoId ? 'gh-chat-poke--me' : ''}`} role="note">
              {message.mine ? '你' : sender.name} 拍了拍 {nameOfNekoId(poke.toNekoId)}
            </div>
          ) : message.bundle ? (
            <button
              type="button"
              className="gh-chat-bundle"
              aria-label="查看聊天记录"
              onClick={() => {
                if (longPress.wasLongPress()) return
                onOpenBundle(message.bundle!)
              }}
            >
              <span className="gh-chat-bundle-title">聊天记录</span>
              <span className="gh-chat-bundle-lines">
                {message.bundle.slice(0, 3).map((item, index) => (
                  <span key={`${item.t}-${index}`} className="gh-chat-bundle-line">
                    {`${displayNameOf(item.n)}：${item.r ? '消息已撤回' : item.b || '[图片]'}`}
                  </span>
                ))}
              </span>
              <span className="gh-chat-bundle-more">
                共 {message.bundle.length} 条 · 点击查看
              </span>
            </button>
          ) : isSticker ? (
            <img
              className="gh-chat-message-sticker"
              src={chatImageUrl(message.image)}
              alt="表情"
              loading="lazy"
              decoding="async"
            />
          ) : isImage ? (
            <button
              type="button"
              className="gh-chat-message-image-wrap"
              aria-label="查看大图"
              onClick={() => {
                if (longPress.wasLongPress()) return
                onPreviewImage(message.image!)
              }}
            >
              <img
                className="gh-chat-message-image"
                src={chatImageUrl(message.image)}
                alt="图片消息"
                loading="lazy"
                decoding="async"
              />
            </button>
          ) : (
            <div className={`gh-chat-message-bubble ${message.mentionedMe ? 'gh-chat-message-bubble--mention' : ''}`}>
              {isRoom
                ? <MentionText body={message.body} members={members} />
                : message.body}
            </div>
          )}
        </div>
      </div>
    </Fragment>
  )
})

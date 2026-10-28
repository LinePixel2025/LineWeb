import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { chatImageUrl } from '../../lib/chat'
import {
  STICKER_SHOP,
  STICKER_SHOP_PACKS,
  readSavedShopStickerIds,
  shopStickerToFile,
  writeSavedShopStickerIds,
  type ShopSticker,
} from '../../lib/stickers'
import type { NekoSticker } from '../../types/chat'

interface Props {
  open: boolean
  stickers: NekoSticker[]
  onSend: (sticker: NekoSticker) => void
  /** 收藏本地图片为表情（页面负责上传与错误提示） */
  onAdd: (file: File) => Promise<void> | void
  onRemove: (id: number) => Promise<void> | void
  onClose: () => void
}

type Tab = 'mine' | 'shop'

/**
 * 表情包面板：两页签
 *   - 我的表情：neko 的个人表情包（收藏的聊天图片）
 *   - 表情商店：内置原创表情，一键保存到「我的表情」后即可发送
 *
 * 发送口径与 neko 原生客户端一致：正文 `[表情]` + XHTML-IM 图片。
 */
export default function ChatStickerPanel({
  open,
  stickers,
  onSend,
  onAdd,
  onRemove,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [tab, setTab] = useState<Tab>('mine')
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [savedIds, setSavedIds] = useState<string[]>(() => readSavedShopStickerIds())
  const [savingShopId, setSavingShopId] = useState<string | null>(null)
  const [shopPack, setShopPack] = useState<string>('all')
  const [shopNote, setShopNote] = useState<string | null>(null)

  const shopItems = useMemo(
    () => (shopPack === 'all' ? STICKER_SHOP : STICKER_SHOP.filter((item) => item.pack === shopPack)),
    [shopPack],
  )

  if (!open) return null

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || uploading) return
    setUploading(true)
    try {
      await onAdd(file)
    } catch {
      // 失败由页面 banner 展示
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async (sticker: NekoSticker) => {
    if (busyId !== null) return
    if (!window.confirm('把这个表情从表情包移除？')) return
    setBusyId(sticker.id)
    try {
      await onRemove(sticker.id)
    } catch {
      // 同上
    } finally {
      setBusyId(null)
    }
  }

  const handleSaveShopSticker = async (sticker: ShopSticker) => {
    if (savingShopId !== null) return
    setSavingShopId(sticker.id)
    setShopNote(null)
    try {
      const file = await shopStickerToFile(sticker)
      await onAdd(file)
      setSavedIds((prev) => {
        if (prev.includes(sticker.id)) return prev
        const next = [...prev, sticker.id]
        writeSavedShopStickerIds(next)
        return next
      })
      setShopNote(`已保存「${sticker.name}」，在「我的表情」里点一下就能发送。`)
    } catch (err) {
      setShopNote(err instanceof Error && err.message ? err.message : '保存失败，请稍后重试')
    } finally {
      setSavingShopId(null)
    }
  }

  return (
    <div className="gh-chat-sticker-panel" role="dialog" aria-label="表情包">
      <div className="gh-chat-sticker-head">
        <span className="gh-chat-sticker-tabs" role="tablist" aria-label="表情来源">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mine'}
            className={`gh-chat-sticker-tab ${tab === 'mine' ? 'gh-chat-sticker-tab--active' : ''}`}
            onClick={() => setTab('mine')}
          >
            我的表情
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shop'}
            className={`gh-chat-sticker-tab ${tab === 'shop' ? 'gh-chat-sticker-tab--active' : ''}`}
            onClick={() => setTab('shop')}
          >
            表情商店
          </button>
        </span>
        <span className="gh-chat-sticker-actions">
          {tab === 'mine' && (
            <button
              type="button"
              className="gh-chat-composer-tool"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? '上传中…' : '收藏表情'}
            </button>
          )}
          <button type="button" className="gh-chat-sticker-close" aria-label="关闭表情包" onClick={onClose}>
            ×
          </button>
        </span>
      </div>

      {tab === 'mine' ? (
        stickers.length === 0 ? (
          <p className="gh-chat-sticker-empty">
            还没有表情，点「收藏表情」添加，或去「表情商店」一键保存。
          </p>
        ) : (
          <div className="gh-chat-sticker-grid">
            {stickers.map((sticker) => (
              <div key={sticker.id} className="gh-chat-sticker-item">
                <button
                  type="button"
                  className="gh-chat-sticker-send"
                  aria-label="发送表情"
                  title="发送表情"
                  onClick={() => onSend(sticker)}
                >
                  <img src={chatImageUrl(sticker.url)} alt="表情" loading="lazy" />
                </button>
                <button
                  type="button"
                  className="gh-chat-sticker-remove"
                  aria-label="移出表情包"
                  title="移出表情包"
                  disabled={busyId === sticker.id}
                  onClick={() => void handleRemove(sticker)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="gh-chat-sticker-shop">
          <div className="gh-chat-sticker-packs" role="tablist" aria-label="表情包分类">
            <button
              type="button"
              role="tab"
              aria-selected={shopPack === 'all'}
              className={`gh-chat-sticker-pack ${shopPack === 'all' ? 'gh-chat-sticker-pack--active' : ''}`}
              onClick={() => setShopPack('all')}
            >
              全部
            </button>
            {STICKER_SHOP_PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                role="tab"
                aria-selected={shopPack === pack.id}
                className={`gh-chat-sticker-pack ${shopPack === pack.id ? 'gh-chat-sticker-pack--active' : ''}`}
                onClick={() => setShopPack(pack.id)}
              >
                {pack.name}
              </button>
            ))}
          </div>

          <div className="gh-chat-sticker-shop-grid">
            {shopItems.map((sticker) => {
              const saved = savedIds.includes(sticker.id)
              const saving = savingShopId === sticker.id
              return (
                <div key={sticker.id} className="gh-chat-sticker-shop-item">
                  <img src={sticker.src} alt={sticker.name} loading="lazy" />
                  <span className="gh-chat-sticker-shop-name">{sticker.name}</span>
                  <button
                    type="button"
                    className={`gh-chat-sticker-shop-save${saved ? ' gh-chat-sticker-shop-save--saved' : ''}`}
                    disabled={saving || saved}
                    onClick={() => void handleSaveShopSticker(sticker)}
                  >
                    {saving ? '保存中…' : saved ? '已保存' : '保存'}
                  </button>
                </div>
              )
            })}
          </div>
          <p className="gh-chat-sticker-shop-note" role="status">
            {shopNote ??
              '团子 / 橘猫 / 符号为站内原创；经典表情来自 Twemoji（CC-BY 4.0）；奶龙 / 呆猫抓取自公开表情图库（来源见各包目录 LICENSE.txt，仅供个人使用）。保存后即可在聊天中发送。'}
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="gh-chat-visually-hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFile}
      />
    </div>
  )
}

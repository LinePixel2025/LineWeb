import { useEffect, useState } from 'react'
import { GitHubButton } from '../ui'
import type { NekoContact } from '../../types/chat'

interface Props {
  contact: NekoContact
  onClose: () => void
  onSubmit: (remark: string) => Promise<void>
}

/** 联系人备注弹窗（仅自己可见，≤30 字，空串清除） */
export default function ContactRemarkDialog({ contact, onClose, onSubmit }: Props) {
  const [remark, setRemark] = useState(contact.remark ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const save = async (value: string) => {
    setSaving(true)
    setError('')
    try {
      await onSubmit(value.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存备注失败')
    } finally {
      setSaving(false)
    }
  }

  const label = contact.displayName || contact.username
  return (
    <div className="gh-dialog-overlay" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !saving) onClose()
    }}>
      <div className="gh-dialog" role="dialog" aria-modal="true" aria-label="设置联系人备注">
        <h3 className="gh-dialog-title">设置备注</h3>
        <p className="gh-text-secondary" style={{ marginTop: 0 }}>
          为 <strong>{label}</strong> 设置仅自己可见的备注名（最多 30 个字）。
        </p>
        {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
        <label className="gh-form-field">
          <span>备注名</span>
          <input
            className="gh-input"
            type="text"
            maxLength={30}
            value={remark}
            autoFocus
            placeholder={label}
            onChange={(e) => setRemark(e.target.value)}
            disabled={saving}
          />
          <span className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
            {remark.length}/30
          </span>
        </label>
        <div className="gh-dialog-actions">
          {contact.remark ? (
            <GitHubButton variant="ghost" size="md" disabled={saving} onClick={() => void save('')}>
              清空备注
            </GitHubButton>
          ) : null}
          <GitHubButton variant="secondary" size="md" disabled={saving} onClick={onClose}>取消</GitHubButton>
          <GitHubButton variant="primary" size="md" disabled={saving} onClick={() => void save(remark)}>
            {saving ? '保存中…' : '保存'}
          </GitHubButton>
        </div>
      </div>
    </div>
  )
}

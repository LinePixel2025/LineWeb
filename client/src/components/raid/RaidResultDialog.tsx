/**
 * 搜打撤结算弹层：撤离 / 阵亡 / 失联 / 放弃的结果与战利品去向。
 * 撤离后物品留在背包 / 胸挂 / 安全箱，需要玩家到仓库页手动存入（不会自动出售）。
 */

import { Link } from 'react-router-dom'
import { RAID_CONTAINER_LABELS, RAID_ITEM_MAP } from '../../lib/raid/raidRun'
import type { RaidSettlement } from '../../types/petRaid'

interface RaidResultDialogProps {
  settlement: RaidSettlement
  onClose: () => void
}

const RESULT_META: Record<string, { label: string; tone: string; text: string }> = {
  extracted: { label: '撤离成功', tone: 'success', text: '带出的物资已放进背包 / 胸挂 / 安全箱，记得回仓库手动存入。' },
  died: { label: '行动阵亡', tone: 'danger', text: '背包与胸挂里的东西全部丢失，随身装备也丢了（行动保险可保住装备）；安全箱保留。' },
  mia: { label: '失联', tone: 'danger', text: '行动超时，背包与胸挂里的东西丢失；安全箱保留。' },
  abandoned: { label: '已放弃', tone: 'warning', text: '主动放弃行动：背包与胸挂清空，安全箱保留。' },
}

export default function RaidResultDialog({ settlement, onClose }: RaidResultDialogProps) {
  const meta = RESULT_META[settlement.result] ?? RESULT_META.abandoned!
  const grouped = (['backpack', 'rig', 'safe'] as const).map((container) => ({
    container,
    items: settlement.loot.filter((item) => item.container === container),
  }))
  const totalValue = settlement.loot.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="gh-dialog-overlay" role="presentation">
      <div className={`gh-dialog gh-raid-result gh-raid-result--${meta.tone}`} role="dialog" aria-modal="true" aria-label="搜打撤结算">
        <h2 className="gh-dialog-title">{meta.label}</h2>
        <p className="gh-text-secondary">{meta.text}</p>

        <div className="gh-raid-result-stats">
          <span>击杀 <b>{settlement.record.kills}</b></span>
          <span>带出价值 <b>{totalValue}</b></span>
          <span>积分余额 <b>{settlement.balance}</b></span>
        </div>

        {grouped.map(({ container, items }) => (
          <section key={container} className="gh-raid-result-section">
            <h3>{RAID_CONTAINER_LABELS[container]}（{items.length}）</h3>
            {items.length === 0 ? (
              <p className="gh-raid-result-empty">空</p>
            ) : (
              <ul className="gh-raid-result-list">
                {items.map((item, index) => {
                  const def = RAID_ITEM_MAP.get(item.itemKey)
                  return (
                    <li key={`${container}-${item.itemKey}-${index}`}>
                      <span aria-hidden>{item.emoji || def?.emoji || '📦'}</span>
                      <span>{item.name}</span>
                      <b>×{item.amount}</b>
                      <em>{item.value} 积分</em>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}

        {settlement.gearLost.length > 0 && (
          <section className="gh-raid-result-lost">
            <h3>丢失装备</h3>
            <p>{settlement.gearLost.join('、')}</p>
          </section>
        )}

        <div className="gh-dialog-actions">
          <Link className="gh-btn gh-btn--primary" to="/pets/raid/storage" onClick={onClose}>
            前往仓库整理
          </Link>
          <button type="button" className="gh-btn gh-btn--secondary" onClick={onClose}>
            返回大厅
          </button>
        </div>
      </div>
    </div>
  )
}

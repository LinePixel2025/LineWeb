/**
 * 对局内背包 / 胸挂 / 安全箱整理面板。
 *
 * 移动端口径：HUD 在触屏布局会把格子藏起来，所有物资操作集中到这个全屏面板；
 * 点选物品 → 点目标容器即整格移动。桌面端也可用 B / I 打开。
 */

import { useEffect, useMemo, useState } from 'react'
import {
  RAID_ITEM_MAP,
  RAID_RARITY_LABELS,
  addItemToContainer,
  raidItemValue,
  type RaidContainerKind,
  type RaidItemStack,
} from '../../lib/raid/raidRun'
import type { RaidSnapshot } from '../../lib/raid/engine'

interface RaidInventoryProps {
  snapshot: RaidSnapshot
  busy: boolean
  onMove: (from: RaidContainerKind, to: RaidContainerKind, slotIndex: number, amount?: number) => boolean
  onClose: () => void
}

const CONTAINERS: { kind: RaidContainerKind; label: string; hint: string }[] = [
  { kind: 'backpack', label: '背包', hint: '通用物资（撤离保留 · 阵亡丢失）' },
  { kind: 'rig', label: '胸挂', hint: '只能放消耗品（撤离保留 · 阵亡丢失）' },
  { kind: 'safe', label: '安全箱', hint: '撤离 / 阵亡都保留' },
]

const RARITY_COLORS: Record<string, string> = {
  common: '#cbd5e1',
  uncommon: '#4ade80',
  rare: '#60a5fa',
  epic: '#c084fc',
  legendary: '#fb923c',
  mythic: '#f87171',
}

function stacksOf(snapshot: RaidSnapshot, kind: RaidContainerKind): RaidItemStack[] {
  if (kind === 'rig') return snapshot.rig
  if (kind === 'safe') return snapshot.safe
  return snapshot.backpack
}

function capacityOf(snapshot: RaidSnapshot, kind: RaidContainerKind): number {
  if (kind === 'rig') return snapshot.capacities.rig
  if (kind === 'safe') return snapshot.capacities.safe
  return snapshot.capacities.backpack
}

export default function RaidInventory({ snapshot, busy, onMove, onClose }: RaidInventoryProps) {
  const [selected, setSelected] = useState<{ from: RaidContainerKind; slotIndex: number } | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selectedStack = useMemo(() => {
    if (!selected) return null
    return stacksOf(snapshot, selected.from).find((stack) => stack.slotIndex === selected.slotIndex) ?? null
  }, [selected, snapshot])

  const selectedDef = selectedStack ? RAID_ITEM_MAP.get(selectedStack.itemKey) ?? null : null

  const canMoveTo = (kind: RaidContainerKind): boolean => {
    if (!selected || !selectedStack || !selectedDef) return false
    if (kind === selected.from) return false
    if (kind === 'rig' && selectedDef.kind !== 'consumable') return false
    const capacity = capacityOf(snapshot, kind)
    if (capacity <= 0) return false
    return addItemToContainer(stacksOf(snapshot, kind), capacity, selectedStack.itemKey, selectedStack.amount) !== null
  }

  const handleMove = (kind: RaidContainerKind): void => {
    if (!selected || !selectedStack || busy || !canMoveTo(kind)) return
    const ok = onMove(selected.from, kind, selected.slotIndex, selectedStack.amount)
    if (ok) {
      setNotice(`已把 ${selectedDef?.name ?? '物品'} 挪到${CONTAINERS.find((item) => item.kind === kind)?.label ?? kind}`)
      setSelected(null)
    } else {
      setNotice('移动失败：目标容器可能已满')
    }
  }

  const containerValue = (kind: RaidContainerKind): number =>
    stacksOf(snapshot, kind).reduce((sum, stack) => sum + raidItemValue(stack.itemKey) * stack.amount, 0)

  return (
    <div className="gh-raid-inv" role="dialog" aria-modal="true" aria-label="战术背包">
      <div className="gh-raid-inv-card">
        <header className="gh-raid-inv-head">
          <div>
            <p className="gh-raid-inv-eyebrow">TACTICAL INVENTORY</p>
            <h2>战术背包</h2>
            <p className="gh-raid-inv-sub">点选物品，再点目标容器即可整格移动。安全箱里的东西阵亡也不会掉。</p>
          </div>
          <button type="button" className="gh-raid-inv-close" onClick={onClose} aria-label="关闭背包">✕</button>
        </header>

        {notice && <p className="gh-raid-inv-notice">{notice}</p>}

        <div className="gh-raid-inv-grid">
          {CONTAINERS.map((container) => {
            const stacks = stacksOf(snapshot, container.kind)
            const capacity = capacityOf(snapshot, container.kind)
            return (
              <section key={container.kind} className={`gh-raid-inv-panel is-${container.kind}`}>
                <div className="gh-raid-inv-panel-head">
                  <div>
                    <h3>{container.label}</h3>
                    <span>{container.hint}</span>
                  </div>
                  <div className="gh-raid-inv-count">
                    <b>{stacks.length}/{capacity}</b>
                    <em>{containerValue(container.kind)} 价值</em>
                  </div>
                </div>
                {capacity <= 0 ? (
                  <p className="gh-raid-inv-empty">未装备{container.label}（仓库 → 装备 可购买）</p>
                ) : stacks.length === 0 ? (
                  <p className="gh-raid-inv-empty">空</p>
                ) : (
                  <div className="gh-raid-inv-slots">
                    {stacks.map((stack) => {
                      const def = RAID_ITEM_MAP.get(stack.itemKey)
                      if (!def) return null
                      const active = selected?.from === container.kind && selected.slotIndex === stack.slotIndex
                      return (
                        <button
                          key={`${container.kind}-${stack.slotIndex}`}
                          type="button"
                          className={`gh-raid-inv-item${active ? ' is-active' : ''}`}
                          data-rarity={def.rarity}
                          style={{ ['--item-color' as string]: RARITY_COLORS[def.rarity] ?? '#cbd5e1' }}
                          onClick={() => {
                            setNotice('')
                            setSelected(active ? null : { from: container.kind, slotIndex: stack.slotIndex })
                          }}
                        >
                          <span className="gh-raid-inv-item-emoji">{def.emoji}</span>
                          <span className="gh-raid-inv-item-name">{def.name}</span>
                          <span className="gh-raid-inv-item-meta">
                            ×{stack.amount} · {RAID_RARITY_LABELS[def.rarity] ?? '普通'}
                          </span>
                          <span className="gh-raid-inv-item-slot">格 {stack.slotIndex + 1}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <footer className={`gh-raid-inv-actions${selectedStack ? ' is-ready' : ''}`}>
          {selectedStack && selectedDef ? (
            <>
              <div className="gh-raid-inv-selected">
                <span>{selectedDef.emoji}</span>
                <div>
                  <b>{selectedDef.name} ×{selectedStack.amount}</b>
                  <em>来自{CONTAINERS.find((item) => item.kind === selected?.from)?.label}</em>
                </div>
              </div>
              <div className="gh-raid-inv-targets">
                {CONTAINERS.filter((container) => container.kind !== selected?.from).map((container) => {
                  const enabled = !busy && canMoveTo(container.kind)
                  const reason = busy
                    ? '同步中'
                    : container.kind === 'rig' && selectedDef.kind !== 'consumable'
                      ? '胸挂只能放消耗品'
                      : capacityOf(snapshot, container.kind) <= 0
                        ? `未装备${container.label}`
                        : !enabled
                          ? `${container.label}已满`
                          : ''
                  return (
                    <button
                      key={container.kind}
                      type="button"
                      className="gh-raid-inv-target"
                      disabled={!enabled}
                      onClick={() => handleMove(container.kind)}
                    >
                      移到{container.label}
                      {reason ? <em>{reason}</em> : null}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <p className="gh-raid-inv-tip">选中一件物品后，这里会列出可移动到的容器。</p>
          )}
        </footer>
      </div>
    </div>
  )
}

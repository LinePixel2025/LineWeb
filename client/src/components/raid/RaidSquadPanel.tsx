/**
 * 搜打撤好友组队面板（大厅用）：邀请 / 好友选择 / 队伍座位 / 组队出击。
 *
 * 复用站内既有的好友关系与在线状态口径（服务端 /pets/raid/squad 下发），
 * 出击由房主一次性为全员在同一 seed 上开局，门票与保险各自结算。
 */

import { useMemo, useState } from 'react'
import type { RaidSquad, RaidSquadFriend, RaidSquadInvite, RaidSquadStartResult } from '../../types/raidSquad'

interface SquadMapOption {
  key: string
  name: string
  emoji: string
  entryCost: number
  difficulty: string
  recommendLevel: number
}

interface RaidSquadPanelProps {
  squad: RaidSquad | null
  friends: RaidSquadFriend[]
  incoming: RaidSquadInvite[]
  outgoing: RaidSquadInvite[]
  selfUserId: number
  busy: boolean
  error: string
  failed: RaidSquadStartResult['failed']
  maps: SquadMapOption[]
  selectedMapKey: string
  insured: boolean
  insuranceCost: number
  onInvite: (userId: number) => void
  onRespond: (inviteId: number, accept: boolean) => void
  onCancel: (inviteId: number) => void
  onLeave: () => void
  onKick: (userId: number) => void
  onStart: (mapKey: string) => void
}

const SPECIES_EMOJI: Record<string, string> = {
  cat: '🐱', dog: '🐶', bird: '🐦', rabbit: '🐰', fox: '🦊', panda: '🐼',
}

const STATUS_LABEL: Record<string, string> = {
  lobby: '待命',
  active: '行动中',
  extracted: '已撤离',
  died: '阵亡',
  mia: '失联',
  abandoned: '已撤退',
  offline: '离线',
}

function shortName(name: string): string {
  return name.length > 8 ? `${name.slice(0, 7)}…` : name
}

export default function RaidSquadPanel({
  squad,
  friends,
  incoming,
  outgoing,
  selfUserId,
  busy,
  error,
  failed,
  maps,
  selectedMapKey,
  insured,
  insuranceCost,
  onInvite,
  onRespond,
  onCancel,
  onLeave,
  onKick,
  onStart,
}: RaidSquadPanelProps) {
  const [keyword, setKeyword] = useState('')
  const isHost = Boolean(squad && squad.hostUserId === selfUserId)
  const memberCount = squad?.members.length ?? 0
  const maxMembers = squad?.maxMembers ?? 4
  const selectedMap = maps.find((map) => map.key === selectedMapKey) ?? null

  const filteredFriends = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    const inSquad = new Set((squad?.members ?? []).map((member) => member.userId))
    return friends
      .filter((friend) => !inSquad.has(friend.userId))
      .filter((friend) => !query
        || friend.name.toLowerCase().includes(query)
        || friend.displayName.toLowerCase().includes(query)
        || friend.petName.toLowerCase().includes(query))
      .slice(0, 12)
  }, [friends, keyword, squad])

  const perHead = (selectedMap?.entryCost ?? 0) + (insured ? insuranceCost : 0)
  const startBlocked = !squad
    ? '还没有队伍，先邀请好友'
    : memberCount < 2
      ? '至少 2 人才能组队出击'
      : !isHost
        ? '等待房主发起出击'
        : !selectedMap
          ? '先在下方选择行动区域'
          : ''

  return (
    <section className="gh-raidsq">
      <header className="gh-raidsq-head">
        <div>
          <h2>好友组队出击</h2>
          <p>共享同一张地图：击杀、开门、开箱与战利品全局唯一；血量、背包与撤离各自结算。</p>
        </div>
        <span className="gh-raidsq-count">{memberCount}/{maxMembers}</span>
      </header>

      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="gh-raidsq-invites">
          {incoming.map((invite: RaidSquadInvite) => (
            <div key={invite.id} className="gh-raidsq-invite is-in">
              <span><b>{shortName(invite.fromName)}</b> 邀请你组队</span>
              <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" disabled={busy} onClick={() => onRespond(invite.id, true)}>
                接受
              </button>
              <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={() => onRespond(invite.id, false)}>
                拒绝
              </button>
            </div>
          ))}
          {outgoing.map((invite: RaidSquadInvite) => {
            const target = friends.find((friend) => friend.userId === invite.toUserId)
            return (
              <div key={invite.id} className="gh-raidsq-invite is-out">
                <span>已邀请 <b>{shortName(target?.displayName || target?.name || '好友')}</b>，等待回应</span>
                <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={() => onCancel(invite.id)}>
                  取消
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="gh-raidsq-body">
        <div className="gh-raidsq-seats">
          <div className="gh-raidsq-block-title">队伍座位</div>
          {squad ? (
            <ul className="gh-raidsq-seat-list">
              {squad.members.map((member, index) => (
                <li key={member.userId} className={`gh-raidsq-seat is-${member.status}${member.host ? ' is-host' : ''}`}>
                  <span className="gh-raidsq-seat-index">{index + 1}</span>
                  <span className="gh-raidsq-seat-avatar">{SPECIES_EMOJI[member.species] ?? '🐾'}</span>
                  <span className="gh-raidsq-seat-main">
                    <b>{shortName(member.displayName || member.name)}{member.userId === selfUserId ? '（你）' : ''}</b>
                    <em>{member.petName ? `${member.petName} · Lv.${member.level}` : '还没有宠物'}</em>
                  </span>
                  <span className={`gh-raidsq-seat-state${member.online ? '' : ' is-offline'}`}>
                    {STATUS_LABEL[member.status] ?? member.status}
                  </span>
                  {isHost && !isHostOf(member.userId, selfUserId) && squad.status === 'lobby' && (
                    <button type="button" className="gh-raidsq-kick" disabled={busy} onClick={() => onKick(member.userId)} title="移出队伍">
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="gh-raidsq-empty">还没有队伍。邀请好友后自动建队，你是房主。</p>
          )}

          <div className="gh-raidsq-actions">
            {squad && (
              <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={onLeave}>
                {isHost ? '解散队伍' : '退出队伍'}
              </button>
            )}
            {isHost ? (
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                disabled={busy || Boolean(startBlocked) || !selectedMap}
                onClick={() => selectedMap && onStart(selectedMap.key)}
              >
                组队出击{selectedMap ? `（每人 ${perHead} 积分）` : ''}
              </button>
            ) : (
              squad && <span className="gh-raidsq-wait">等待房主出击…</span>
            )}
          </div>
          {startBlocked && squad && squad.status === 'lobby' && (
            <p className="gh-raidsq-note">{startBlocked}</p>
          )}
          {failed.length > 0 && (
            <ul className="gh-raidsq-failed">
              {failed.map((item) => (
                <li key={item.userId}>{shortName(item.name)}：{item.reason}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="gh-raidsq-friends">
          <div className="gh-raidsq-block-title">
            <span>邀请好友</span>
            <input
              type="search"
              value={keyword}
              placeholder="搜索好友 / 宠物"
              onChange={(event) => setKeyword(event.target.value)}
              aria-label="搜索好友"
            />
          </div>
          {filteredFriends.length === 0 ? (
            <p className="gh-raidsq-empty">没有可邀请的好友（好友需在线、且不在其他对局中）。</p>
          ) : (
            <ul className="gh-raidsq-friend-list">
              {filteredFriends.map((friend) => {
                const blocked = friend.inRaid || friend.inOtherGame
                return (
                  <li key={friend.userId} className="gh-raidsq-friend">
                    <span className="gh-raidsq-seat-avatar">{SPECIES_EMOJI[friend.species] ?? '🐾'}</span>
                    <span className="gh-raidsq-seat-main">
                      <b>{shortName(friend.displayName || friend.name)}</b>
                      <em>{friend.petName ? `${friend.petName} · Lv.${friend.level}` : '没有宠物'}</em>
                    </span>
                    <span className={`gh-raidsq-friend-state${friend.online ? ' is-online' : ''}`}>
                      {friend.inRaid ? '搜打撤中' : friend.inOtherGame ? '对局中' : friend.online ? '在线' : '离线'}
                    </span>
                    <button
                      type="button"
                      className="gh-btn gh-btn--secondary gh-btn--sm"
                      disabled={busy || blocked || (squad ? squad.members.length >= squad.maxMembers : false)}
                      onClick={() => onInvite(friend.userId)}
                    >
                      邀请
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {error && <div className="gh-alert gh-alert--danger gh-raidsq-error">{error}</div>}
    </section>
  )
}

function isHostOf(userId: number, selfUserId: number): boolean {
  return userId === selfUserId
}

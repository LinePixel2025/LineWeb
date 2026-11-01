import { Link } from 'react-router-dom'
import PetSprite from './PetSprite'
import { moodLabel, resolveSpeciesMeta } from './petTheme'
import UserAvatar from '../UserAvatar'
import type { PetHomeSummary } from '../../types/pet'

/**
 * 宠物之家列表卡片：贴图 + 名字 + 物种 / 等级 + 人气 + 主人。
 * 整张卡是一个 Link（点击进 /pets/home/:userId），自己不处理业务状态。
 */
export default function PetHomeCard({ home }: { home: PetHomeSummary }) {
  const meta = resolveSpeciesMeta(home.pet.species, { name: home.pet.speciesName })
  return (
    <Link
      to={`/pets/home/${home.userId}`}
      className="gh-pet-home-card"
      aria-label={`${home.username} 的宠物之家：${home.pet.name}`}
    >
      <div className="gh-pet-home-card-art">
        <PetSprite
          species={home.pet.species}
          equipped={home.pet.equipped}
          mood={home.pet.mood}
          size={124}
        />
        {home.isSelf && <span className="gh-pet-home-card-self">我的</span>}
      </div>
      <div className="gh-pet-home-card-body">
        <div className="gh-pet-home-card-title">
          <strong>{home.pet.name}</strong>
          <span className="gh-pet-home-card-level">Lv.{home.pet.level}</span>
        </div>
        <div className="gh-pet-home-card-meta">
          <span>{meta.emoji} {meta.name}</span>
          <span className="gh-pet-home-card-dot" aria-hidden />
          <span>{moodLabel(home.pet.mood)}</span>
        </div>
        <div className="gh-pet-home-card-pop">
          <span aria-hidden>❤️</span>
          {home.pet.pats}
          <em>人气</em>
        </div>
        <div className="gh-pet-home-card-owner">
          <UserAvatar userId={home.userId} username={home.username} size="sm" />
          <span>{home.username}</span>
        </div>
      </div>
    </Link>
  )
}

import type { ReactNode } from 'react'
import type { PetEquipped, PetSpecies } from '../../types/pet'

/**
 * 2D 宠物立绘（纯 inline SVG，无外部图片资源）。
 *
 * - 三种体型：小猫（奶油橘）/ 小狗（米色垂耳）/ 小鸟（天蓝蛋形）；
 * - 装扮覆盖层按 equipped 的 key 渲染（未知 key 静默跳过，等服务端下发新装扮时前端不崩）；
 * - 动画全部由 pet.css 的 keyframes 驱动：容器类 `gh-pet-anim-{action}` 控制整体动作，
 *   SVG 内部件类（眨眼 / 尾巴 / 翅膀）做 idle 循环；
 * - `sad` 时耳朵下垂、呆毛耷拉并挂汗滴，idle 节奏放慢（CSS 覆盖）。
 */

interface PetSpriteProps {
  species: PetSpecies
  /** 当前动画 key：idle/eat/bath/play/happy/dance/roll/sing/flip/spin/magic/firework（未知值回退静态） */
  action?: string
  equipped?: PetEquipped | null
  /** 显示边长（px），默认 200 */
  size?: number
  /** 任一状态值过低：耳朵下垂 + 汗滴 + 动作变慢 */
  sad?: boolean
}

/** 动画 key 白名单：防止服务端返回异常字符串拼进 className */
const ACTION_RE = /^[a-z][a-z0-9_-]*$/

const SPECIES_LABELS: Record<PetSpecies, string> = {
  cat: '小猫',
  dog: '小狗',
  bird: '小鸟',
}

/* ============================================================
   共用部件：大眼睛（含高光） / 腮红
   ============================================================ */

function PetEyes({ cy }: { cy: number }) {
  return (
    <g className="gh-pet-eyes">
      {[84, 116].map((cx) => (
        <g key={cx} className="gh-pet-eye">
          <ellipse cx={cx} cy={cy} rx="11" ry="13" fill="#ffffff" />
          <ellipse cx={cx + 1} cy={cy + 1.5} rx="6.5" ry="8.5" fill="#33303a" />
          <circle cx={cx + 3.4} cy={cy - 3.4} r="2.6" fill="#ffffff" />
          <circle cx={cx - 2.2} cy={cy + 4.2} r="1.2" fill="#ffffff" opacity="0.85" />
        </g>
      ))}
    </g>
  )
}

function PetBlush({ cy }: { cy: number }) {
  return (
    <g fill="#f5a9b8" opacity="0.55">
      <ellipse cx="64" cy={cy} rx="8.5" ry="5" />
      <ellipse cx="136" cy={cy} rx="8.5" ry="5" />
    </g>
  )
}

/* ============================================================
   三种体型（尾巴 / 耳朵 / 头部分组类名供 CSS 做循环动画）
   ============================================================ */

function CatBody() {
  return (
    <g>
      {/* 上翘条纹尾巴 */}
      <g className="gh-pet-tail gh-pet-tail--cat">
        <path d="M148 148 C 178 140, 186 110, 170 88" fill="none" stroke="#f7d9a8" strokeWidth="15" strokeLinecap="round" />
        <path d="M148 148 C 178 140, 186 110, 170 88" fill="none" stroke="#e0aa66" strokeWidth="15" strokeLinecap="round" strokeDasharray="6 19" opacity="0.9" />
      </g>
      {/* 身体 + 浅色肚皮 */}
      <ellipse cx="100" cy="146" rx="50" ry="34" fill="#f7d9a8" />
      <ellipse cx="100" cy="154" rx="27" ry="18" fill="#fbe9c6" />
      {/* 三角耳（内耳粉） */}
      <g className="gh-pet-ear gh-pet-ear--l">
        <path d="M64 60 L55 22 L94 44 Z" fill="#f7d9a8" />
        <path d="M68 53 L62 32 L86 45 Z" fill="#f2b8c6" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r">
        <path d="M136 60 L145 22 L106 44 Z" fill="#f7d9a8" />
        <path d="M132 53 L138 32 L114 45 Z" fill="#f2b8c6" />
      </g>
      <g className="gh-pet-head">
        <circle cx="100" cy="82" r="43" fill="#f7d9a8" />
        {/* 额头条纹 */}
        <g stroke="#e0aa66" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M91 43 q3 8 0 14" />
          <path d="M100 41 q3 9 0 16" />
          <path d="M109 43 q-3 8 0 14" />
        </g>
        <PetEyes cy={78} />
        <PetBlush cy={95} />
        {/* 粉鼻 + ω 嘴 */}
        <path d="M95 91 L105 91 L100 97.5 Z" fill="#f293a9" />
        <path d="M100 98 q0 5 -6.5 6 M100 98 q0 5 6.5 6" stroke="#8a6b45" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* 胡须 */}
        <g stroke="#c9a06a" strokeWidth="2" strokeLinecap="round">
          <path d="M58 84 L35 80" />
          <path d="M58 92 L35 94" />
          <path d="M142 84 L165 80" />
          <path d="M142 92 L165 94" />
        </g>
      </g>
    </g>
  )
}

function DogBody() {
  return (
    <g>
      {/* 摇摆短尾 */}
      <g className="gh-pet-tail gh-pet-tail--dog">
        <path d="M148 136 C 168 128, 175 114, 166 101" fill="none" stroke="#edd3b3" strokeWidth="17" strokeLinecap="round" />
      </g>
      {/* 身体 + 斑块 */}
      <ellipse cx="100" cy="146" rx="52" ry="34" fill="#edd3b3" />
      <ellipse cx="100" cy="154" rx="28" ry="18" fill="#f9edd6" />
      <ellipse cx="65" cy="141" rx="12" ry="16" fill="#dcb98a" transform="rotate(-14 65 141)" />
      {/* 垂耳（画在头后面） */}
      <g className="gh-pet-ear gh-pet-ear--l">
        <path d="M67 56 C 42 58, 36 100, 54 110 C 68 116, 76 92, 73 64 Z" fill="#c89a6b" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r">
        <path d="M133 56 C 158 58, 164 100, 146 110 C 132 116, 124 92, 127 64 Z" fill="#c89a6b" />
      </g>
      <g className="gh-pet-head">
        <circle cx="100" cy="82" r="43" fill="#edd3b3" />
        {/* 头顶斑块 */}
        <path d="M87 41 C 96 38, 108 40, 114 49 C 105 53, 91 52, 87 41 Z" fill="#dcb98a" />
        <PetEyes cy={78} />
        {/* 椭圆吻部 + 黑鼻 */}
        <ellipse cx="100" cy="100" rx="23" ry="16.5" fill="#f9edd6" />
        <ellipse cx="100" cy="93" rx="7" ry="5.5" fill="#3b3630" />
        <path d="M100 99 q0 5 -7 6 M100 99 q0 5 7 6" stroke="#8a6b45" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <PetBlush cy={94} />
      </g>
    </g>
  )
}

function BirdBody() {
  return (
    <g>
      {/* 细腿 + 脚 */}
      <g stroke="#e8a13f" strokeWidth="4.5" strokeLinecap="round" fill="none">
        <path d="M88 170 L88 188" />
        <path d="M112 170 L112 188" />
        <path d="M82 189 L94 189" />
        <path d="M106 189 L118 189" />
      </g>
      {/* 头顶三根呆毛 */}
      <g className="gh-pet-tuft" fill="none" stroke="#7fb9e0" strokeWidth="5" strokeLinecap="round">
        <path d="M94 78 C 90 68, 84 62, 78 57" />
        <path d="M100 76 C 100 66, 100 58, 100 50" />
        <path d="M106 78 C 110 68, 116 62, 122 57" />
      </g>
      {/* 小翅膀（身体后面，偶尔扇动） */}
      <g className="gh-pet-wing gh-pet-wing--l">
        <ellipse cx="58" cy="126" rx="13" ry="27" fill="#8ec7ee" transform="rotate(16 58 126)" />
      </g>
      <g className="gh-pet-wing gh-pet-wing--r">
        <ellipse cx="142" cy="126" rx="13" ry="27" fill="#8ec7ee" transform="rotate(-16 142 126)" />
      </g>
      {/* 蛋形身体（含头）+ 浅色肚皮 */}
      <g className="gh-pet-head">
        <ellipse cx="100" cy="124" rx="45" ry="53" fill="#a9d7f5" />
        <ellipse cx="100" cy="144" rx="27" ry="28" fill="#dff0fb" />
        <PetEyes cy={104} />
        <PetBlush cy={118} />
        {/* 橙三角喙 */}
        <path d="M91 113 L109 113 L100 126 Z" fill="#f5a623" />
        <path d="M94 121 L106 121 L100 127 Z" fill="#e08e12" />
      </g>
    </g>
  )
}

const SPECIES_BODIES: Record<PetSpecies, () => ReactNode> = {
  cat: CatBody,
  dog: DogBody,
  bird: BirdBody,
}

/* ============================================================
   装扮覆盖层（同一套坐标对三种体型做视觉容差：小鸟整体下移）
   ============================================================ */

/** 小鸟蛋形头部偏低，装扮层整体下移的像素数 */
const BIRD_OUTFIT_SHIFT = 22

function CapeHero() {
  return (
    <g className="gh-pet-outfit">
      <path d="M62 104 C 26 128, 30 172, 50 182 L 150 182 C 170 172, 174 128, 138 104 C 124 95, 76 95, 62 104 Z" fill="#d6403a" />
      <path d="M64 106 C 78 116, 122 116, 136 106" fill="none" stroke="#b9332e" strokeWidth="5" strokeLinecap="round" />
    </g>
  )
}

function ScarfBlue() {
  return (
    <g className="gh-pet-outfit">
      <path d="M118 130 L 136 162 L 112 156 Z" fill="#1f6feb" />
      <path d="M64 114 Q 100 132 136 114 L 136 132 Q 100 150 64 132 Z" fill="#2f81f7" />
      <g stroke="#1f6feb" strokeWidth="3" strokeLinecap="round">
        <path d="M118 134 L 128 156" />
        <path d="M124 132 L 134 158" />
      </g>
    </g>
  )
}

function Bowtie() {
  return (
    <g className="gh-pet-outfit">
      <path d="M100 122 L 76 110 L 76 134 Z" fill="#d6403a" />
      <path d="M100 122 L 124 110 L 124 134 Z" fill="#d6403a" />
      <rect x="94" y="115" width="12" height="14" rx="3.5" fill="#b9332e" />
    </g>
  )
}

function HatRed() {
  return (
    <g className="gh-pet-outfit">
      <path d="M70 58 C 70 32, 130 32, 130 58 Z" fill="#e5534b" />
      <ellipse cx="100" cy="58" rx="34" ry="7" fill="#c93c37" />
      <circle cx="100" cy="30" r="8" fill="#fdf2d0" stroke="#e8dcbf" strokeWidth="1.5" />
    </g>
  )
}

function CrownGold() {
  return (
    <g className="gh-pet-outfit">
      <path d="M72 58 L 72 28 L 87 44 L 100 22 L 113 44 L 128 28 L 128 58 Z" fill="#f5c542" stroke="#d4a017" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="100" cy="47" r="5.5" fill="#e5534b" stroke="#c93c37" strokeWidth="1.5" />
      <circle cx="80" cy="52" r="3" fill="#5eb0ef" />
      <circle cx="120" cy="52" r="3" fill="#5eb0ef" />
    </g>
  )
}

function GlassesRound() {
  return (
    <g className="gh-pet-outfit" fill="rgba(255, 255, 255, 0.2)" stroke="#4b4353" strokeWidth="4">
      <circle cx="84" cy="80" r="14" />
      <circle cx="116" cy="80" r="14" />
      <path d="M98 80 L 102 80" fill="none" />
      <path d="M70 77 L 55 71" fill="none" strokeLinecap="round" />
      <path d="M130 77 L 145 71" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Sunglasses() {
  return (
    <g className="gh-pet-outfit">
      <rect x="68" y="70" width="30" height="19" rx="8" fill="#2b2b33" />
      <rect x="102" y="70" width="30" height="19" rx="8" fill="#2b2b33" />
      <path d="M98 76 L 102 76" stroke="#2b2b33" strokeWidth="4" />
      <path d="M68 76 L 54 71" stroke="#2b2b33" strokeWidth="4" strokeLinecap="round" />
      <path d="M132 76 L 146 71" stroke="#2b2b33" strokeWidth="4" strokeLinecap="round" />
      <path d="M74 74 L 84 83" stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" />
      <path d="M108 74 L 118 83" stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" />
    </g>
  )
}

/** 帽子槽位：key → SVG 组（未知 key 不渲染） */
const HAT_OUTFITS: Record<string, () => ReactNode> = {
  hat_red: HatRed,
  crown_gold: CrownGold,
}

/** 颈部槽位（cape_hero 画在身后，单独处理） */
const NECK_FRONT_OUTFITS: Record<string, () => ReactNode> = {
  scarf_blue: ScarfBlue,
  bowtie: Bowtie,
}

/** 面部槽位 */
const FACE_OUTFITS: Record<string, () => ReactNode> = {
  glasses_round: GlassesRound,
  sunglasses: Sunglasses,
}

/* ============================================================
   组件
   ============================================================ */

export default function PetSprite({
  species,
  action = 'idle',
  equipped = null,
  size = 200,
  sad = false,
}: PetSpriteProps) {
  const Body = SPECIES_BODIES[species]
  const safeAction = ACTION_RE.test(action) ? action : 'idle'

  const hat = equipped?.hat ?? null
  const neck = equipped?.neck ?? null
  const face = equipped?.face ?? null

  // 披风画在身体后面，其余装扮画在身体前面
  const cape = neck === 'cape_hero' ? <CapeHero /> : null
  const neckFront = (neck && NECK_FRONT_OUTFITS[neck]?.()) ?? null
  const hatNode = (hat && HAT_OUTFITS[hat]?.()) ?? null
  const faceNode = (face && FACE_OUTFITS[face]?.()) ?? null
  const outfitShift = species === 'bird' ? BIRD_OUTFIT_SHIFT : 0

  const classes = [
    'gh-pet-sprite',
    `gh-pet-anim-${safeAction}`,
    sad ? 'gh-pet-sprite--sad' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" role="img" aria-label={SPECIES_LABELS[species]}>
        {cape}
        <Body />
        <g transform={outfitShift ? `translate(0 ${outfitShift})` : undefined}>
          {neckFront}
          {hatNode}
          {faceNode}
        </g>
        {sad && (
          <text className="gh-pet-sweat" x="143" y="52" fontSize="24" role="presentation">💧</text>
        )}
      </svg>
      {/* 动作特效（默认隐藏，按 gh-pet-anim-{action} 容器类在 CSS 中显示） */}
      <span className="gh-pet-fx gh-pet-fx-bowl" aria-hidden>🥣</span>
      <span className="gh-pet-fx gh-pet-fx-bubble gh-pet-fx-bubble--a" aria-hidden>🫧</span>
      <span className="gh-pet-fx gh-pet-fx-bubble gh-pet-fx-bubble--b" aria-hidden>🫧</span>
      <span className="gh-pet-fx gh-pet-fx-bubble gh-pet-fx-bubble--c" aria-hidden>🫧</span>
      <span className="gh-pet-fx gh-pet-fx-ball" aria-hidden>🎾</span>
      <span className="gh-pet-fx gh-pet-fx-heart gh-pet-fx-heart--a" aria-hidden>💛</span>
      <span className="gh-pet-fx gh-pet-fx-heart gh-pet-fx-heart--b" aria-hidden>💗</span>
      <span className="gh-pet-fx gh-pet-fx-note gh-pet-fx-note--a" aria-hidden>🎵</span>
      <span className="gh-pet-fx gh-pet-fx-note gh-pet-fx-note--b" aria-hidden>🎶</span>
      <span className="gh-pet-fx gh-pet-fx-star gh-pet-fx-star--a" aria-hidden>✨</span>
      <span className="gh-pet-fx gh-pet-fx-star gh-pet-fx-star--b" aria-hidden>⭐</span>
      <span className="gh-pet-fx gh-pet-fx-star gh-pet-fx-star--c" aria-hidden>✨</span>
      <span className="gh-pet-fx gh-pet-fx-spark gh-pet-fx-spark--a" aria-hidden>✦</span>
      <span className="gh-pet-fx gh-pet-fx-spark gh-pet-fx-spark--b" aria-hidden>✧</span>
      <span className="gh-pet-fx gh-pet-fx-spark gh-pet-fx-spark--c" aria-hidden>✦</span>
      <span className="gh-pet-fx gh-pet-fx-spark gh-pet-fx-spark--d" aria-hidden>✧</span>
      <span className="gh-pet-fx gh-pet-fx-spark gh-pet-fx-spark--e" aria-hidden>✦</span>
      <span className="gh-pet-glow" aria-hidden />
    </div>
  )
}

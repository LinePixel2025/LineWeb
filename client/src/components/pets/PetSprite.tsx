import { memo } from 'react'
import type { ReactNode } from 'react'
import type { PetEquipped, PetPalette, PetSpecies } from '../../types/pet'
import { normalizePetSpecies, resolveSpeciesMeta, resolveSpeciesPalette } from './petTheme'

/**
 * 宠物立绘（纯 inline SVG，无外部图片）：240×240 统一坐标，Q 版比例（头约占 60%）。
 *
 * 设计口径：
 * - 六个物种各自一套轮廓：猫尖耳 / 狗垂耳 / 鸟喙与翅 / 兔长耳 / 狐大尾与白面罩 / 熊猫黑眼圈圆耳；
 * - 体色由物种 palette 派生（顶部提亮 + 底部压暗），所以换色不用改任何路径；
 * - 分层顺序：地面投影 → 披风 → 尾巴 → 身体 → 头 → 面部 → 颈部装扮 → 帽子 → 面部装扮 → 特效；
 * - 动画全部由 CSS class 驱动（`.gh-pet-anim-*` + `prefers-reduced-motion` 静音），组件自身零定时器；
 * - 心情（mood）只决定表情与姿态：≥70 眯眼笑 + 星星、<30 垂眼 + 汗滴，不参与任何数值计算。
 */

export interface PetSpriteProps {
  species: PetSpecies
  equipped?: PetEquipped | null
  /** 心情 0–100：驱动表情与活力（缺省按 70 处理） */
  mood?: number
  /** 当前播放的动画 key（idle / feed / bathe / play / touch / pat / 13 个特技） */
  animation?: string
  /** 兼容旧调用：animation 的别名 */
  action?: string
  /** @deprecated 用 mood < 20 表达低落；保留仅为兼容旧调用点 */
  sad?: boolean
  /** 显示边长（px），默认 200 */
  size?: number
  className?: string
  /** 可点击（hover 有轻微放大与指针样式） */
  interactive?: boolean
}

/** 动画 key 白名单：防止服务端异常字符串拼进 className */
const ANIMATION_RE = /^[a-z][a-z0-9_-]*$/
const KNOWN_ANIMATIONS = new Set([
  'idle',
  'happy',
  'feed', 'eat',
  'bathe', 'bath',
  'play',
  'touch', 'pat',
  'stretch', 'beg', 'dance', 'roll', 'highfive', 'sing', 'flip',
  'moonwalk', 'spin', 'playdead', 'wave', 'sneeze', 'yawn', 'magic', 'cheer', 'firework',
  // 战斗技能动画（PetBattleStage 直接传服务端 animation key）
  'basic', 'fire', 'ice', 'thunder', 'heal', 'poison', 'shadow',
  'roar', 'shield', 'drain', 'meteor', 'purify', 'stun', 'dot', 'faint',
])

/** 虹膜基色（每种动物眼睛的气质不同，熊猫单独走「白眼球 + 黑瞳」） */
const IRIS_COLORS: Record<PetSpecies, string> = {
  cat: '#8a5316',
  dog: '#6b4423',
  bird: '#1f6f9c',
  rabbit: '#a4586f',
  fox: '#9a5626',
  panda: '#3a3a44',
}

const MOUTH_STROKE = '#5c3a28'

/* ============================================================
   颜色工具：从 palette 派生渐变，避免为 6 个物种手写 30 个色值
   ============================================================ */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean.split('').map((ch) => ch + ch).join('')
    : clean.padEnd(6, '0').slice(0, 6)
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`
}

/** ratio > 0 提亮（向白混），ratio < 0 压暗（向黑混） */
function shade(hex: string, ratio: number): string {
  const target: [number, number, number] = ratio >= 0 ? [255, 255, 255] : [0, 0, 0]
  const amount = Math.abs(ratio)
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex([
    r + (target[0] - r) * amount,
    g + (target[1] - g) * amount,
    b + (target[2] - b) * amount,
  ])
}

/* ============================================================
   几何常量（所有物种共用头部 / 身体骨架，靠耳朵与尾巴区分）
   ============================================================ */

const BODY_PATH = 'M120 128 C 92 128 74 152 74 178 C 74 198 94 207 120 207 C 146 207 166 198 166 178 C 166 152 148 128 120 128 Z'
const HEAD_PATH = 'M120 46 C 154 46 178 70 178 102 C 178 134 156 154 120 154 C 84 154 62 134 62 102 C 62 70 86 46 120 46 Z'
/** 胸前浅色毛（猫 / 狗 / 狐 / 兔共用，鸟与熊猫另有画法） */
const CHEST_PATH = 'M120 142 C 108 142 98 156 98 174 C 98 190 108 200 120 200 C 132 200 142 190 142 174 C 142 156 132 142 120 142 Z'

/** 2D 心形（以原点为中心，向上约 -16、向下约 +10） */
const HEART_PATH = 'M0 10 C -6 3 -16 -3 -16 -10 C -16 -16 -9 -18 -5 -14 L 0 -9 L 5 -14 C 9 -18 16 -16 16 -10 C 16 -3 6 3 0 10 Z'
/** 四角星光 */
const SPARK_PATH = 'M0 -13 L3.2 -3.2 L13 0 L3.2 3.2 L0 13 L-3.2 3.2 L-13 0 L-3.2 -3.2 Z'

function heart(transform: string, key: string, opacity = 1): ReactNode {
  return (
    <path
      key={key}
      d={HEART_PATH}
      transform={transform}
      fill="#ff6f91"
      opacity={opacity}
    />
  )
}

function sparkle(transform: string, key: string, color = '#ffd76e'): ReactNode {
  return <path key={key} d={SPARK_PATH} transform={transform} fill={color} />
}

/* ============================================================
   渐变定义（同页多实例重复 id 是安全的：内容完全一致）
   ============================================================ */

function PetDefs({ species, palette }: { species: PetSpecies; palette: PetPalette }) {
  const dark = species === 'panda' ? palette.secondary : shade(palette.primary, -0.32)
  const earInner = species === 'panda' ? palette.accent : shade(palette.accent, 0.45)
  return (
    <defs>
      <radialGradient id="lw-pet-shadow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#3c2a18" stopOpacity="0.26" />
        <stop offset="0.65" stopColor="#3c2a18" stopOpacity="0.1" />
        <stop offset="1" stopColor="#3c2a18" stopOpacity="0" />
      </radialGradient>

      <radialGradient id="lw-pet-blush" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#f4737f" stopOpacity="0.62" />
        <stop offset="0.6" stopColor="#f79aab" stopOpacity="0.34" />
        <stop offset="1" stopColor="#ffc9d3" stopOpacity="0" />
      </radialGradient>

      <radialGradient
        id={`lw-pet-body-${species}`}
        gradientUnits="userSpaceOnUse"
        cx="92"
        cy="68"
        r="146"
      >
        <stop offset="0" stopColor={shade(palette.primary, 0.62)} />
        <stop offset="0.34" stopColor={shade(palette.primary, 0.3)} />
        <stop offset="0.7" stopColor={palette.primary} />
        <stop offset="0.92" stopColor={shade(palette.primary, -0.16)} />
        <stop offset="1" stopColor={shade(palette.primary, -0.3)} />
      </radialGradient>

      <linearGradient id={`lw-pet-belly-${species}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={shade(palette.secondary, 0.5)} />
        <stop offset="0.7" stopColor={palette.secondary} />
        <stop offset="1" stopColor={shade(palette.secondary, -0.12)} />
      </linearGradient>

      <radialGradient id={`lw-pet-ear-${species}`} cx="0.5" cy="0.36" r="0.72">
        <stop offset="0" stopColor={shade(earInner, 0.32)} />
        <stop offset="1" stopColor={shade(earInner, -0.08)} />
      </radialGradient>

      <linearGradient id={`lw-pet-iris-${species}`} x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor={shade(IRIS_COLORS[species], -0.45)} />
        <stop offset="0.5" stopColor={IRIS_COLORS[species]} />
        <stop offset="1" stopColor={shade(IRIS_COLORS[species], 0.28)} />
      </linearGradient>

      <linearGradient id={`lw-pet-dark-${species}`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor={shade(dark, 0.22)} />
        <stop offset="1" stopColor={shade(dark, -0.16)} />
      </linearGradient>

      <linearGradient id="lw-pet-nose" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffb0c0" />
        <stop offset="1" stopColor="#e2768f" />
      </linearGradient>

      <linearGradient id="lw-pet-tongue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffa9bb" />
        <stop offset="1" stopColor="#e2647f" />
      </linearGradient>

      <linearGradient id="lw-pet-beak" x1="0" y1="0" x2="0.1" y2="1">
        <stop offset="0" stopColor="#ffe08a" />
        <stop offset="0.55" stopColor="#f9bb45" />
        <stop offset="1" stopColor="#e08f14" />
      </linearGradient>

      <linearGradient id="lw-pet-sweat" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#e8fbff" />
        <stop offset="1" stopColor="#6cc5ee" />
      </linearGradient>

      {/* ---------- 装扮：红色小帽 ---------- */}
      <linearGradient id="lw-pet-hat-red" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#ff8f83" />
        <stop offset="0.55" stopColor="#ef5f55" />
        <stop offset="1" stopColor="#c43a34" />
      </linearGradient>
      <linearGradient id="lw-pet-hat-brim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffd0c6" />
        <stop offset="0.5" stopColor="#ff9a8c" />
        <stop offset="1" stopColor="#e2665a" />
      </linearGradient>
      <radialGradient id="lw-pet-pom" cx="0.34" cy="0.28" r="0.84">
        <stop offset="0" stopColor="#fffdf6" />
        <stop offset="0.6" stopColor="#f4e8d2" />
        <stop offset="1" stopColor="#ddc9a5" />
      </radialGradient>

      {/* ---------- 装扮：黄金皇冠 ---------- */}
      <linearGradient id="lw-pet-crown" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#fff3b4" />
        <stop offset="0.45" stopColor="#f8cf5c" />
        <stop offset="1" stopColor="#d99b1c" />
      </linearGradient>
      <linearGradient id="lw-pet-crown-band" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f7d066" />
        <stop offset="1" stopColor="#c88a13" />
      </linearGradient>

      {/* ---------- 装扮：围巾 / 蝴蝶结 / 披风 ---------- */}
      <linearGradient id="lw-pet-scarf" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stopColor="#86c7ff" />
        <stop offset="0.55" stopColor="#3f8cf0" />
        <stop offset="1" stopColor="#2159b8" />
      </linearGradient>
      <linearGradient id="lw-pet-bowtie" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#ff8d93" />
        <stop offset="1" stopColor="#c93a45" />
      </linearGradient>
      <linearGradient id="lw-pet-cape" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#5b8dff" />
        <stop offset="0.55" stopColor="#3a5fd6" />
        <stop offset="1" stopColor="#22307f" />
      </linearGradient>
      <linearGradient id="lw-pet-glass" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="1" stopColor="#cfe6ff" stopOpacity="0.18" />
      </linearGradient>
      <linearGradient id="lw-pet-shades" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#4c4f5c" />
        <stop offset="0.55" stopColor="#1e2028" />
        <stop offset="1" stopColor="#0d0e13" />
      </linearGradient>

      {/* ---------- 2026-11 新增装扮 ---------- */}
      <linearGradient id="lw-pet-party" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#ff9a8b" />
        <stop offset="0.45" stopColor="#ffd166" />
        <stop offset="1" stopColor="#7b62e8" />
      </linearGradient>
      <linearGradient id="lw-pet-bandana" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#e05a4f" />
        <stop offset="1" stopColor="#9e2b25" />
      </linearGradient>
      <linearGradient id="lw-pet-wings-angel" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.6" stopColor="#f4f0ff" />
        <stop offset="1" stopColor="#d9d2ff" />
      </linearGradient>
      <linearGradient id="lw-pet-wings-bat" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#6a4f9e" />
        <stop offset="0.6" stopColor="#4a3b6b" />
        <stop offset="1" stopColor="#2b2140" />
      </linearGradient>
      <linearGradient id="lw-pet-backpack" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#b08454" />
        <stop offset="1" stopColor="#6f4f32" />
      </linearGradient>
      <radialGradient id="lw-pet-halo" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fff6c4" stopOpacity="0.9" />
        <stop offset="0.7" stopColor="#f8cf5c" stopOpacity="0.55" />
        <stop offset="1" stopColor="#f8cf5c" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="lw-pet-aura-flame" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="#ff5f3c" stopOpacity="0.1" />
        <stop offset="0.55" stopColor="#ff9a3c" stopOpacity="0.75" />
        <stop offset="1" stopColor="#ffe9a3" stopOpacity="0.95" />
      </linearGradient>
    </defs>
  )
}

/* ============================================================
   共用面部零件
   ============================================================ */

function Eyes({ species, mood }: { species: PetSpecies; mood: number }) {
  const happy = mood >= 70
  return (
    <g className="gh-pet-eyes">
      {[101, 139].map((cx) => (
        <g className="gh-pet-eye" key={cx}>
          {species === 'panda' ? (
            <>
              <ellipse cx={cx} cy={110} rx={6.4} ry={7.8} fill="#fbf8f3" />
              <ellipse cx={cx} cy={110} rx={4.4} ry={5.6} fill="#26262d" />
              <circle cx={cx - 1.8} cy={106.6} r={2} fill="#fff" />
            </>
          ) : (
            <>
              <ellipse
                cx={cx}
                cy={110}
                rx={10.6}
                ry={12.8}
                fill={`url(#lw-pet-iris-${species})`}
                stroke="#3a2a20"
                strokeOpacity="0.22"
                strokeWidth={1}
              />
              <ellipse cx={cx - 3.6} cy={105.2} rx={3.7} ry={4.4} fill="#fff" opacity="0.95" />
              <circle cx={cx + 3.8} cy={115} r={2} fill="#fff" opacity="0.78" />
            </>
          )}
        </g>
      ))}
      {happy && (
        <path
          className="gh-pet-eye-star"
          d={SPARK_PATH}
          transform="translate(148 96) scale(0.32)"
          fill="#fff7c9"
          opacity="0.95"
        />
      )}
      {mood < 30 && (
        <g className="gh-pet-brows" stroke={MOUTH_STROKE} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity="0.6">
          <path d="M91 99 Q101 94 111 99" />
          <path d="M129 99 Q139 94 149 99" />
        </g>
      )}
    </g>
  )
}

function Blush({ muted }: { muted: boolean }) {
  return (
    <g className="gh-pet-blush" opacity={muted ? 0.45 : 1}>
      <ellipse cx={76} cy={132} rx={15} ry={9} fill="url(#lw-pet-blush)" />
      <ellipse cx={164} cy={132} rx={15} ry={9} fill="url(#lw-pet-blush)" />
    </g>
  )
}

/* ---------- 猫脸 ---------- */
function CatFace({ mood }: { mood: number }) {
  return (
    <g className="gh-pet-face">
      <ellipse cx={120} cy={133} rx={24} ry={15} fill="#fff8ee" opacity="0.94" />
      <path d="M112 125 H128 L120 134 Z" fill="url(#lw-pet-nose)" />
      <circle cx={117} cy={128} r={1.6} fill="#fff" opacity="0.55" />
      <path d="M120 133 Q120 140 112 140" stroke={MOUTH_STROKE} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <path d="M120 133 Q120 140 128 140" stroke={MOUTH_STROKE} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <g stroke="#c98c5a" strokeWidth={1.9} strokeLinecap="round" opacity="0.5">
        <path d="M92 128 C 82 125 74 124 66 124" />
        <path d="M92 134 C 82 134 74 136 67 138" />
        <path d="M148 128 C 158 125 166 124 174 124" />
        <path d="M148 134 C 158 134 166 136 173 138" />
      </g>
      <Blush muted={mood < 30} />
    </g>
  )
}

/* ---------- 狗脸 ---------- */
function DogFace({ mood }: { mood: number }) {
  return (
    <g className="gh-pet-face">
      <ellipse cx={120} cy={134} rx={27} ry={18} fill="#fffaf2" opacity="0.96" />
      <ellipse cx={92} cy={88} rx={6.4} ry={4.2} transform="rotate(-14 92 88)" fill="#8a5f3c" opacity="0.4" />
      <ellipse cx={148} cy={88} rx={6.4} ry={4.2} transform="rotate(14 148 88)" fill="#8a5f3c" opacity="0.4" />
      <ellipse cx={120} cy={125} rx={8.6} ry={6.4} fill="#4a3328" />
      <path d="M120 131 V 135" stroke="#6b4a36" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M107 138 Q120 149 133 138" stroke={MOUTH_STROKE} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <path
        d="M111 142 Q120 158 129 142 Q120 147 111 142 Z"
        fill="url(#lw-pet-tongue)"
        stroke="#d05d78"
        strokeWidth={1}
        opacity={mood >= 40 ? 1 : 0.55}
      />
      <Blush muted={mood < 30} />
    </g>
  )
}

/* ---------- 鸟脸 ---------- */
function BirdFace({ mood }: { mood: number }) {
  return (
    <g className="gh-pet-face">
      <path d="M108 122 Q120 113 132 122 Q120 132 108 122 Z" fill="url(#lw-pet-beak)" stroke="#d08a17" strokeWidth={1} />
      <path d="M110 129 Q120 136 130 129" fill="#eda42c" opacity="0.9" />
      <path d="M114 130 Q120 134 126 130" fill="#c97a13" opacity="0.55" />
      <Blush muted={mood < 30} />
    </g>
  )
}

/* ---------- 兔脸 ---------- */
function RabbitFace({ mood }: { mood: number }) {
  return (
    <g className="gh-pet-face">
      <circle cx={110} cy={133} r={9} fill="#fffafc" />
      <circle cx={130} cy={133} r={9} fill="#fffafc" />
      <path d="M116 124 H124 L120 129 Z" fill="url(#lw-pet-nose)" />
      <path d="M120 129 V 133" stroke={MOUTH_STROKE} strokeWidth={2} strokeLinecap="round" />
      <path d="M120 133 Q115 139 110 135" stroke={MOUTH_STROKE} strokeWidth={2} strokeLinecap="round" fill="none" />
      <path d="M120 133 Q125 139 130 135" stroke={MOUTH_STROKE} strokeWidth={2} strokeLinecap="round" fill="none" />
      <rect x={115.2} y={134} width={4.4} height={7.2} rx={1.8} fill="#fffefc" stroke="#e6d2d8" strokeWidth={0.8} />
      <rect x={120.4} y={134} width={4.4} height={7.2} rx={1.8} fill="#fffefc" stroke="#e6d2d8" strokeWidth={0.8} />
      <Blush muted={mood < 30} />
    </g>
  )
}

/* ---------- 狐脸（白面罩在头层画，这里只画五官） ---------- */
function FoxFace({ mood }: { mood: number }) {
  return (
    <g className="gh-pet-face">
      <ellipse cx={120} cy={136} rx={23} ry={14} fill="#fffaf4" />
      <path d="M112 128 H128 L120 135 Z" fill="#4a3330" />
      <path d="M120 135 Q120 141 111 141" stroke={MOUTH_STROKE} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <path d="M120 135 Q120 141 129 141" stroke={MOUTH_STROKE} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <path d="M132 138 Q138 140 141 136" stroke={MOUTH_STROKE} strokeWidth={1.8} strokeLinecap="round" fill="none" opacity="0.65" />
      <Blush muted={mood < 30} />
    </g>
  )
}

/* ---------- 熊猫脸 ---------- */
function PandaFace({ mood }: { mood: number }) {
  return (
    <g className="gh-pet-face">
      <ellipse cx={120} cy={137} rx={21} ry={13} fill="#fbf8f3" opacity="0.85" />
      <path d="M114 128 H126 L120 134 Z" fill="#2c2c34" />
      <path d="M120 134 Q120 140 112 140" stroke="#5d5d68" strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <path d="M120 134 Q120 140 128 140" stroke="#5d5d68" strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <Blush muted={mood < 30} />
    </g>
  )
}

/* ============================================================
   物种身体（每种一套轮廓：耳朵 / 尾巴 / 花纹各不相同）
   ============================================================ */

type ArtProps = { palette: PetPalette; mood: number }

/** 猫：尖耳 + 额纹 + 胡须 + 环纹长尾 */
function CatArt({ palette, mood }: ArtProps) {
  const bodyFill = 'url(#lw-pet-body-cat)'
  return (
    <g className="gh-pet-creature gh-pet-creature--cat">
      <g className="gh-pet-tail">
        <path d="M154 194 C 186 198 204 178 200 150" stroke={palette.primary} strokeWidth={16} strokeLinecap="round" fill="none" />
        <path d="M197 152 C 199 172 188 187 170 191" stroke={shade(palette.primary, -0.22)} strokeWidth={7} strokeLinecap="round" fill="none" opacity="0.5" />
      </g>
      <path d={BODY_PATH} fill={bodyFill} />
      <path d={CHEST_PATH} fill="url(#lw-pet-belly-cat)" opacity="0.96" />
      <ellipse cx={86} cy={199} rx={18} ry={11} fill={shade(palette.primary, 0.14)} />
      <ellipse cx={154} cy={199} rx={18} ry={11} fill={shade(palette.primary, 0.14)} />
      <g stroke={shade(palette.primary, -0.34)} strokeWidth={1.6} strokeLinecap="round" opacity="0.4">
        <path d="M80 203 V 207" /><path d="M88 204 V 208" /><path d="M148 204 V 208" /><path d="M156 203 V 207" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--l">
        <path d="M72 68 C 66 46 72 26 84 18 C 94 28 102 42 109 55 C 96 64 84 69 72 68 Z" fill={bodyFill} />
        <path d="M80 62 C 77 47 81 34 86 27 C 92 34 97 45 101 55 C 94 60 87 63 80 62 Z" fill="url(#lw-pet-ear-cat)" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r">
        <path d="M168 68 C 174 46 168 26 156 18 C 146 28 138 42 131 55 C 144 64 156 69 168 68 Z" fill={bodyFill} />
        <path d="M160 62 C 163 47 159 34 154 27 C 148 34 143 45 139 55 C 146 60 153 63 160 62 Z" fill="url(#lw-pet-ear-cat)" />
      </g>
      <path d={HEAD_PATH} fill={bodyFill} />
      <g stroke={shade(palette.primary, -0.3)} strokeWidth={3.4} strokeLinecap="round" opacity="0.34">
        <path d="M110 58 L113 70" /><path d="M120 54 V 68" /><path d="M130 58 L127 70" />
      </g>
      <path d="M86 72 C 96 56 110 49 126 48" stroke="#fff" strokeOpacity="0.42" strokeWidth={6} strokeLinecap="round" fill="none" />
      <Eyes species="cat" mood={mood} />
      <CatFace mood={mood} />
    </g>
  )
}

/** 狗：垂耳 + 眉毛斑点 + 舌头 + 短翘尾 */
function DogArt({ palette, mood }: ArtProps) {
  const bodyFill = 'url(#lw-pet-body-dog)'
  return (
    <g className="gh-pet-creature gh-pet-creature--dog">
      <g className="gh-pet-tail">
        <path d="M158 188 C 178 184 188 168 184 150" stroke={palette.primary} strokeWidth={13} strokeLinecap="round" fill="none" />
        <path d="M180 154 C 184 168 178 178 168 182" stroke={shade(palette.primary, -0.2)} strokeWidth={6} strokeLinecap="round" fill="none" opacity="0.45" />
      </g>
      <path d={BODY_PATH} fill={bodyFill} />
      <path d={CHEST_PATH} fill="url(#lw-pet-belly-dog)" opacity="0.96" />
      <ellipse cx={86} cy={199} rx={18} ry={11} fill={shade(palette.primary, 0.16)} />
      <ellipse cx={154} cy={199} rx={18} ry={11} fill={shade(palette.primary, 0.16)} />
      <g stroke={shade(palette.primary, -0.34)} strokeWidth={1.6} strokeLinecap="round" opacity="0.4">
        <path d="M80 203 V 207" /><path d="M88 204 V 208" /><path d="M148 204 V 208" /><path d="M156 203 V 207" />
      </g>
      <path d={HEAD_PATH} fill={bodyFill} />
      <g className="gh-pet-ear gh-pet-ear--l">
        <path d="M74 82 C 54 92 46 124 58 148 C 70 158 86 150 90 130 C 94 110 86 92 74 82 Z" fill={shade(palette.primary, -0.14)} />
        <path d="M80 98 C 70 108 68 126 74 138 C 80 143 85 137 86 126 C 87 114 84 104 80 98 Z" fill="url(#lw-pet-ear-dog)" opacity="0.55" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r">
        <path d="M166 82 C 186 92 194 124 182 148 C 170 158 154 150 150 130 C 146 110 154 92 166 82 Z" fill={shade(palette.primary, -0.14)} />
        <path d="M160 98 C 170 108 172 126 166 138 C 160 143 155 137 154 126 C 153 114 156 104 160 98 Z" fill="url(#lw-pet-ear-dog)" opacity="0.55" />
      </g>
      <path d="M88 72 C 98 57 112 50 128 49" stroke="#fff" strokeOpacity="0.4" strokeWidth={6} strokeLinecap="round" fill="none" />
      <Eyes species="dog" mood={mood} />
      <DogFace mood={mood} />
    </g>
  )
}

/** 小鸟：羽冠 + 喙 + 双层羽翅 + 尾羽 + 三趾爪 */
function BirdArt({ palette, mood }: ArtProps) {
  const bodyFill = 'url(#lw-pet-body-bird)'
  return (
    <g className="gh-pet-creature gh-pet-creature--bird">
      <path d="M150 188 L198 204 L190 184 L202 174 L152 174 Z" fill={shade(palette.primary, -0.14)} />
      <path d="M150 184 L188 196 L184 182 L194 176 L150 176 Z" fill={shade(palette.primary, 0.2)} opacity="0.55" />
      <path d="M120 120 C 92 120 78 146 78 172 C 78 196 96 206 120 206 C 144 206 162 196 162 172 C 162 146 148 120 120 120 Z" fill={bodyFill} />
      <ellipse cx={120} cy={178} rx={30} ry={24} fill="url(#lw-pet-belly-bird)" opacity="0.95" />
      <g className="gh-pet-wing gh-pet-wing--l">
        <path d="M86 146 C 62 152 54 176 66 196 C 82 190 94 168 96 148 Z" fill={shade(palette.primary, -0.16)} stroke={shade(palette.primary, -0.34)} strokeWidth={1.6} strokeOpacity="0.4" />
        <path d="M82 156 C 70 164 66 178 68 188" stroke={shade(palette.primary, -0.34)} strokeWidth={2} strokeLinecap="round" fill="none" opacity="0.45" />
      </g>
      <g className="gh-pet-wing gh-pet-wing--r">
        <path d="M154 146 C 178 152 186 176 174 196 C 158 190 146 168 144 148 Z" fill={shade(palette.primary, -0.16)} stroke={shade(palette.primary, -0.34)} strokeWidth={1.6} strokeOpacity="0.4" />
        <path d="M158 156 C 170 164 174 178 172 188" stroke={shade(palette.primary, -0.34)} strokeWidth={2} strokeLinecap="round" fill="none" opacity="0.45" />
      </g>
      <g stroke="#e79a2c" strokeWidth={3.4} strokeLinecap="round" fill="none">
        <path d="M108 204 V 218" /><path d="M104 219 L 98 223" /><path d="M108 219 L 108 224" /><path d="M112 219 L 118 223" />
        <path d="M132 204 V 218" /><path d="M128 219 L 122 223" /><path d="M132 219 L 132 224" /><path d="M136 219 L 142 223" />
      </g>
      <g className="gh-pet-crest">
        <ellipse cx={120} cy={40} rx={8.4} ry={23} transform="rotate(-7 120 40)" fill={bodyFill} />
        <ellipse cx={104} cy={46} rx={7.2} ry={19} transform="rotate(-28 104 46)" fill={bodyFill} opacity="0.9" />
        <ellipse cx={136} cy={46} rx={7.2} ry={19} transform="rotate(28 136 46)" fill={bodyFill} opacity="0.9" />
        <path d="M118 30 C 117 22 118 16 120 12" stroke={shade(palette.primary, 0.42)} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity="0.55" />
      </g>
      <path d={HEAD_PATH} fill={bodyFill} />
      <path d="M88 72 C 98 57 112 50 128 49" stroke="#fff" strokeOpacity="0.45" strokeWidth={6} strokeLinecap="round" fill="none" />
      <Eyes species="bird" mood={mood} />
      <BirdFace mood={mood} />
    </g>
  )
}

/** 兔：长耳（内粉）+ 圆绒球尾 + 门牙 */
function RabbitArt({ palette, mood }: ArtProps) {
  const bodyFill = 'url(#lw-pet-body-rabbit)'
  return (
    <g className="gh-pet-creature gh-pet-creature--rabbit">
      <circle cx={170} cy={184} r={14} fill={shade(palette.secondary, 0.55)} />
      <circle cx={174} cy={180} r={5} fill="#fff" opacity="0.7" />
      <g className="gh-pet-ear gh-pet-ear--l">
        <ellipse cx={98} cy={48} rx={14} ry={41} transform="rotate(-9 98 48)" fill={bodyFill} />
        <ellipse cx={98} cy={50} rx={7.5} ry={31} transform="rotate(-9 98 50)" fill="url(#lw-pet-ear-rabbit)" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r">
        <ellipse cx={142} cy={48} rx={14} ry={41} transform="rotate(9 142 48)" fill={bodyFill} />
        <ellipse cx={142} cy={50} rx={7.5} ry={31} transform="rotate(9 142 50)" fill="url(#lw-pet-ear-rabbit)" />
      </g>
      <path d={BODY_PATH} fill={bodyFill} />
      <path d={CHEST_PATH} fill="url(#lw-pet-belly-rabbit)" opacity="0.96" />
      <ellipse cx={86} cy={199} rx={18} ry={11} fill={shade(palette.primary, 0.2)} />
      <ellipse cx={154} cy={199} rx={18} ry={11} fill={shade(palette.primary, 0.2)} />
      <g stroke="#c9aebb" strokeWidth={1.6} strokeLinecap="round" opacity="0.5">
        <path d="M80 203 V 207" /><path d="M88 204 V 208" /><path d="M148 204 V 208" /><path d="M156 203 V 207" />
      </g>
      <path d={HEAD_PATH} fill={bodyFill} />
      <path d="M88 72 C 98 57 112 50 128 49" stroke="#fff" strokeOpacity="0.55" strokeWidth={6} strokeLinecap="round" fill="none" />
      <Eyes species="rabbit" mood={mood} />
      <RabbitFace mood={mood} />
    </g>
  )
}

/** 狐：大尖耳（深色耳尖）+ 白面罩 + 蓬松大尾 */
function FoxArt({ palette, mood }: ArtProps) {
  const bodyFill = 'url(#lw-pet-body-fox)'
  const dark = shade(palette.primary, -0.4)
  return (
    <g className="gh-pet-creature gh-pet-creature--fox">
      <g className="gh-pet-tail">
        <path d="M148 196 C 186 208 218 188 212 152 C 208 128 188 118 170 128 C 190 138 198 158 188 174 C 178 188 160 190 146 178 Z" fill={shade(palette.primary, -0.04)} stroke={shade(palette.primary, -0.3)} strokeWidth={1.6} strokeOpacity="0.35" />
        <path d="M201 134 C 216 146 218 172 204 186 C 195 194 183 196 172 191 C 194 180 203 158 201 134 Z" fill={palette.secondary} />
      </g>
      <path d={BODY_PATH} fill={bodyFill} />
      <path d={CHEST_PATH} fill="url(#lw-pet-belly-fox)" opacity="0.97" />
      <ellipse cx={86} cy={199} rx={18} ry={11} fill={dark} opacity="0.9" />
      <ellipse cx={154} cy={199} rx={18} ry={11} fill={dark} opacity="0.9" />
      <g className="gh-pet-ear gh-pet-ear--l">
        <path d="M70 66 C 62 40 68 20 82 10 C 90 24 100 40 108 54 C 94 64 82 68 70 66 Z" fill={bodyFill} />
        <path d="M76 20 C 82 24 92 38 100 52 L 84 58 C 80 42 78 30 76 20 Z" fill={dark} opacity="0.9" />
        <path d="M80 56 C 78 44 81 32 85 26 C 90 34 95 44 98 53 C 92 57 86 58 80 56 Z" fill="url(#lw-pet-ear-fox)" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r">
        <path d="M170 66 C 178 40 172 20 158 10 C 150 24 140 40 132 54 C 146 64 158 68 170 66 Z" fill={bodyFill} />
        <path d="M164 20 C 158 24 148 38 140 52 L 156 58 C 160 42 162 30 164 20 Z" fill={dark} opacity="0.9" />
        <path d="M160 56 C 162 44 159 32 155 26 C 150 34 145 44 142 53 C 148 57 154 58 160 56 Z" fill="url(#lw-pet-ear-fox)" />
      </g>
      <path d={HEAD_PATH} fill={bodyFill} />
      <path
        d="M64 102 C 70 136 92 151 120 152 C 148 151 170 136 176 102 C 158 116 140 121 120 121 C 100 121 82 116 64 102 Z"
        fill="#fffaf2"
      />
      <path
        d="M64 102 C 74 126 96 141 120 142 C 144 141 166 126 176 102"
        stroke={shade(palette.secondary, -0.06)}
        strokeWidth={1.5}
        fill="none"
        opacity="0.5"
      />
      <path d="M86 74 C 96 57 110 50 126 49" stroke="#fff" strokeOpacity="0.4" strokeWidth={6} strokeLinecap="round" fill="none" />
      <Eyes species="fox" mood={mood} />
      <FoxFace mood={mood} />
    </g>
  )
}

/** 熊猫：圆耳 + 黑眼圈 + 黑肩黑腿 + 圆滚滚白肚 */
function PandaArt({ palette, mood }: ArtProps) {
  const bodyFill = 'url(#lw-pet-body-panda)'
  const dark = `url(#lw-pet-dark-panda)`
  return (
    <g className="gh-pet-creature gh-pet-creature--panda">
      <circle cx={166} cy={188} r={10} fill={palette.secondary} opacity="0.9" />
      <g className="gh-pet-ear gh-pet-ear--l">
        <circle cx={74} cy={58} r={21} fill={dark} />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r">
        <circle cx={166} cy={58} r={21} fill={dark} />
      </g>
      <path d={BODY_PATH} fill={bodyFill} />
      <path d="M120 148 C 110 148 102 160 102 176 C 102 192 110 202 120 202 C 130 202 138 192 138 176 C 138 160 130 148 120 148 Z" fill="#fffdf9" />
      <ellipse cx={86} cy={200} rx={19} ry={11} fill={palette.secondary} />
      <ellipse cx={154} cy={200} rx={19} ry={11} fill={palette.secondary} />
      <path d="M86 148 C 72 160 68 178 72 194 C 84 197 94 189 97 176 C 100 163 95 152 86 148 Z" fill={dark} opacity="0.95" />
      <path d="M154 148 C 168 160 172 178 168 194 C 156 197 146 189 143 176 C 140 163 145 152 154 148 Z" fill={dark} opacity="0.95" />
      <path d={HEAD_PATH} fill={bodyFill} />
      <ellipse cx={100} cy={108} rx={17} ry={20} transform="rotate(-14 100 108)" fill={dark} />
      <ellipse cx={140} cy={108} rx={17} ry={20} transform="rotate(14 140 108)" fill={dark} />
      <path d="M88 72 C 98 57 112 50 128 49" stroke="#fff" strokeOpacity="0.75" strokeWidth={7} strokeLinecap="round" fill="none" />
      <Eyes species="panda" mood={mood} />
      <PandaFace mood={mood} />
    </g>
  )
}

function renderCreature(species: PetSpecies, palette: PetPalette, mood: number): ReactNode {
  switch (species) {
    case 'dog': return <DogArt palette={palette} mood={mood} />
    case 'bird': return <BirdArt palette={palette} mood={mood} />
    case 'rabbit': return <RabbitArt palette={palette} mood={mood} />
    case 'fox': return <FoxArt palette={palette} mood={mood} />
    case 'panda': return <PandaArt palette={palette} mood={mood} />
    default: return <CatArt palette={palette} mood={mood} />
  }
}

/* ============================================================
   装扮（7 件，各自独立 SVG 造型；坐标以槽位锚点为原点）
   ============================================================ */

interface SlotAnchor { x: number; y: number; s: number }

/**
 * 每个物种的头部/颈部尺寸不同，装备锚点必须逐个微调，
 * 否则帽子会飘在空中、围巾会盖住下巴。
 */
const OUTFIT_ANCHORS: Record<
  PetSpecies,
  { hat: SlotAnchor; neck: SlotAnchor; face: SlotAnchor; cape: number }
> = {
  cat: {
    hat: { x: 120, y: 48, s: 1 },
    neck: { x: 120, y: 150, s: 1 },
    face: { x: 120, y: 110, s: 1 },
    cape: 1,
  },
  dog: {
    hat: { x: 120, y: 45, s: 1.03 },
    neck: { x: 120, y: 152, s: 1.05 },
    face: { x: 120, y: 110, s: 1 },
    cape: 1.03,
  },
  bird: {
    hat: { x: 120, y: 58, s: 0.88 },
    neck: { x: 120, y: 150, s: 0.84 },
    face: { x: 120, y: 112, s: 0.94 },
    cape: 0.94,
  },
  rabbit: {
    hat: { x: 120, y: 43, s: 0.98 },
    neck: { x: 120, y: 150, s: 0.98 },
    face: { x: 120, y: 110, s: 1 },
    cape: 1,
  },
  fox: {
    hat: { x: 120, y: 42, s: 1.02 },
    neck: { x: 120, y: 150, s: 1.02 },
    face: { x: 120, y: 110, s: 1.02 },
    cape: 1.02,
  },
  panda: {
    hat: { x: 120, y: 39, s: 1.03 },
    neck: { x: 120, y: 152, s: 1.06 },
    face: { x: 120, y: 110, s: 1.04 },
    cape: 1.05,
  },
}

function HatRed() {
  return (
    <g>
      <path d="M-44 2 C -44 -30 -22 -48 0 -48 C 22 -48 44 -30 44 2 Z" fill="url(#lw-pet-hat-red)" />
      <path d="M-46 0 Q0 -16 46 0 L 46 10 Q0 24 -46 10 Z" fill="url(#lw-pet-hat-brim)" />
      <path d="M-38 -2 Q0 -14 38 -2" stroke="#ffd7cf" strokeWidth={3} opacity="0.45" fill="none" />
      <circle cx={4} cy={-52} r={12} fill="url(#lw-pet-pom)" />
      <circle cx={-2} cy={-56} r={4.4} fill="#fff" opacity="0.55" />
      <path d="M-26 -30 C -18 -40 -6 -44 4 -44" stroke="#fff" strokeOpacity="0.3" strokeWidth={5} strokeLinecap="round" fill="none" />
    </g>
  )
}

function CrownGold() {
  return (
    <g>
      <path
        d="M-38 8 L-38 -20 L-20 -6 L0 -30 L20 -6 L38 -20 L38 8 Z"
        fill="url(#lw-pet-crown)"
        stroke="#b88712"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <rect x={-40} y={4} width={80} height={12} rx={5} fill="url(#lw-pet-crown-band)" stroke="#b88712" strokeWidth={1.5} />
      <circle cx={-21} cy={10} r={3.2} fill="#ff6b81" />
      <circle cx={0} cy={10} r={3.6} fill="#5fd0ff" />
      <circle cx={21} cy={10} r={3.2} fill="#8bffb0" />
      <circle cx={0} cy={-30} r={3.8} fill="#fff3b4" />
      <path d="M-30 -8 L-24 -12" stroke="#fff8d0" strokeWidth={3} strokeLinecap="round" opacity="0.7" />
    </g>
  )
}

function ScarfBlue() {
  return (
    <g>
      <path d="M-40 -6 C -28 10 28 10 40 -6 C 40 8 26 18 0 18 C -26 18 -40 8 -40 -6 Z" fill="url(#lw-pet-scarf)" />
      <path d="M22 8 C 32 22 33 38 24 48 L 8 42 C 18 34 18 20 12 10 Z" fill="url(#lw-pet-scarf)" />
      <path d="M12 14 C 20 22 22 34 21 42" stroke="#1d4fa3" strokeWidth={2} opacity="0.45" fill="none" />
      <path d="M-40 -4 C -24 -14 24 -14 40 -4" stroke="#a9d6ff" strokeWidth={3} opacity="0.55" fill="none" />
      <path d="M8 40 L 24 46" stroke="#1d4fa3" strokeWidth={2} opacity="0.5" />
    </g>
  )
}

function Bowtie() {
  return (
    <g>
      <path d="M-4 0 L-26 -12 Q-36 -14 -36 -2 Q-36 10 -26 12 Z" fill="url(#lw-pet-bowtie)" />
      <path d="M4 0 L26 -12 Q36 -14 36 -2 Q36 10 26 12 Z" fill="url(#lw-pet-bowtie)" />
      <circle cx={0} cy={0} r={8} fill="#e14b56" stroke="#b32d38" strokeWidth={1.5} />
      <path d="M-24 -6 L-12 -2" stroke="#ffd0d6" strokeWidth={3} opacity="0.55" strokeLinecap="round" />
      <path d="M24 -6 L12 -2" stroke="#ffd0d6" strokeWidth={3} opacity="0.45" strokeLinecap="round" />
    </g>
  )
}

function CapeHero({ scale }: { scale: number }) {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--cape" transform={`translate(120 150) scale(${scale}) translate(-120 -150)`}>
      <path
        d="M88 144 C 66 160 58 186 64 208 C 76 215 92 212 104 206 C 112 202 128 202 136 206 C 148 212 164 215 176 208 C 182 186 174 160 152 144 Z"
        fill="url(#lw-pet-cape)"
      />
      <path d="M120 150 C 120 176 118 196 116 207" stroke="#1b2568" strokeWidth={4} opacity="0.4" fill="none" />
      <path d="M94 154 C 80 170 76 190 78 204" stroke="#8fb3ff" strokeWidth={3} opacity="0.35" fill="none" />
      <path d="M146 154 C 160 170 164 190 162 204" stroke="#8fb3ff" strokeWidth={3} opacity="0.3" fill="none" />
    </g>
  )
}

function CapeCollar({ anchor }: { anchor: SlotAnchor }) {
  return (
    <g
      className="gh-pet-outfit gh-pet-outfit--neck"
      transform={`translate(${anchor.x} ${anchor.y - 4}) scale(${anchor.s})`}
    >
      <path d="M-30 -4 Q0 8 30 -4" stroke="#22307f" strokeWidth={7} strokeLinecap="round" fill="none" />
      <circle cx={0} cy={4} r={6.4} fill="#f8cf5c" stroke="#b88712" strokeWidth={1.4} />
    </g>
  )
}

function GlassesRound() {
  return (
    <g
      className="gh-pet-outfit gh-pet-outfit--face"
      fill="url(#lw-pet-glass)"
      fillOpacity={0.55}
      stroke="#6b4a2f"
      strokeWidth={2.6}
      strokeLinejoin="round"
    >
      <circle cx={-19} cy={0} r={16} />
      <circle cx={19} cy={0} r={16} />
      <path d="M-3 0 Q0 -4 3 0" fill="none" />
      <path d="M-35 -3 L-47 -9" fill="none" strokeLinecap="round" />
      <path d="M35 -3 L47 -9" fill="none" strokeLinecap="round" />
      <path d="M-25 -8 L-19 -11" stroke="#fff" strokeWidth={3} opacity="0.65" fill="none" strokeLinecap="round" />
      <path d="M13 -8 L19 -11" stroke="#fff" strokeWidth={3} opacity="0.5" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Sunglasses() {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--face">
      <rect x={-37} y={-13} width={32} height={26} rx={10} fill="url(#lw-pet-shades)" stroke="#16171c" strokeWidth={2} transform="rotate(-4 -21 0)" />
      <rect x={5} y={-13} width={32} height={26} rx={10} fill="url(#lw-pet-shades)" stroke="#16171c" strokeWidth={2} transform="rotate(4 21 0)" />
      <path d="M-5 -2 Q0 -6 5 -2" stroke="#16171c" strokeWidth={3} fill="none" />
      <path d="M-33 -3 L-44 -8" stroke="#16171c" strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M33 -3 L44 -8" stroke="#16171c" strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M-30 -8 L-22 -10" stroke="#fff" strokeWidth={3} opacity="0.35" strokeLinecap="round" />
      <path d="M12 -8 L20 -10" stroke="#fff" strokeWidth={3} opacity="0.3" strokeLinecap="round" />
    </g>
  )
}

/* ---------- 2026-11 新增装扮造型 ---------- */

function PartyHat() {
  return (
    <g>
      <path d="M-30 6 L0 -54 L30 6 Z" fill="url(#lw-pet-party)" stroke="#c26a7a" strokeWidth={1.6} strokeLinejoin="round" />
      <path d="M-34 4 Q0 16 34 4 L34 12 Q0 24 -34 12 Z" fill="#ffd166" stroke="#d99b1c" strokeWidth={1.2} />
      <circle cx={0} cy={-56} r={9} fill="#ff6f91" />
      <circle cx={-3} cy={-59} r={3} fill="#fff" opacity={0.6} />
      <path d="M-18 -10 L-8 -32" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.4} />
      <circle cx={0} cy={10} r={3.2} fill="#7b62e8" />
      <circle cx={-18} cy={9} r={2.6} fill="#5fd0ff" />
      <circle cx={18} cy={9} r={2.6} fill="#8bffb0" />
    </g>
  )
}

function Bandana() {
  return (
    <g>
      <path d="M-42 -2 Q0 -18 42 -2 L42 8 Q0 20 -42 8 Z" fill="url(#lw-pet-bandana)" stroke="#7d211c" strokeWidth={1.4} />
      <path d="M28 8 L48 27 L30 31 Z" fill="#b8352d" stroke="#7d211c" strokeWidth={1.2} />
      <path d="M-42 -1 Q0 -14 42 -1" stroke="#ff9a8f" strokeWidth={2} opacity={0.45} fill="none" />
      <circle cx={-22} cy={4} r={2} fill="#fff" opacity={0.55} />
      <circle cx={-6} cy={7} r={2} fill="#fff" opacity={0.45} />
      <circle cx={14} cy={5} r={2} fill="#fff" opacity={0.5} />
    </g>
  )
}

function Monocle() {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--face">
      <circle cx={19} cy={0} r={15} fill="url(#lw-pet-glass)" fillOpacity={0.35} stroke="#c9a227" strokeWidth={3} />
      <circle cx={19} cy={0} r={15} fill="none" stroke="#f3d36a" strokeWidth={1} opacity={0.7} />
      <path d="M34 5 C 44 18 46 32 40 44" stroke="#c9a227" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <path d="M12 -7 L18 -10" stroke="#fff" strokeWidth={3} opacity={0.6} strokeLinecap="round" />
    </g>
  )
}

function BellCollar() {
  return (
    <g>
      <path d="M-34 -4 Q0 10 34 -4" stroke="#c0392b" strokeWidth={8} strokeLinecap="round" fill="none" />
      <path d="M-34 -4 Q0 7 34 -4" stroke="#e05a4f" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.6} />
      <circle cx={0} cy={9} r={7.4} fill="#f8cf5c" stroke="#b88712" strokeWidth={1.6} />
      <path d="M-2.2 9 H2.2" stroke="#8a6a10" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx={-2} cy={6.4} r={1.8} fill="#fff8d0" opacity={0.8} />
    </g>
  )
}

function StarPin() {
  return (
    <g>
      <path d={SPARK_PATH} transform="translate(0 2) scale(0.66)" fill="#f8cf5c" stroke="#d99b1c" strokeWidth={1.4} />
      <circle cx={0} cy={2} r={2.2} fill="#fff6c4" />
      <path d="M-30 -2 Q0 7 30 -2" stroke="#d99b1c" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.55} />
    </g>
  )
}

function Backpack({ scale }: { scale: number }) {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--back" transform={`translate(120 162) scale(${scale})`}>
      <rect x={-38} y={-42} width={76} height={66} rx={16} fill="url(#lw-pet-backpack)" stroke="#5f4630" strokeWidth={2.2} />
      <rect x={-30} y={-54} width={60} height={20} rx={9} fill="#a67c52" stroke="#5f4630" strokeWidth={1.8} />
      <path d="M-38 -12 H38" stroke="#5f4630" strokeWidth={2.4} opacity={0.7} />
      <rect x={-11} y={-6} width={22} height={18} rx={4} fill="#f0c36a" stroke="#b88712" strokeWidth={1.4} />
      <path d="M-26 -32 V 8" stroke="#8a6a4a" strokeWidth={2} opacity={0.5} />
      <path d="M26 -32 V 8" stroke="#8a6a4a" strokeWidth={2} opacity={0.5} />
      <circle cx={0} cy={3} r={2.6} fill="#5f4630" />
    </g>
  )
}

function AngelWing() {
  return (
    <g>
      <path
        d="M-8 6 C -38 -16 -74 -12 -94 14 C -72 10 -58 22 -48 42 C -40 24 -26 12 -8 14 Z"
        fill="url(#lw-pet-wings-angel)"
        stroke="#cfc6f5"
        strokeWidth={2}
      />
      <path d="M-20 12 C -38 6 -56 10 -70 22" stroke="#d8d0f7" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <path d="M-16 20 C -32 18 -46 24 -56 34" stroke="#e2dcff" strokeWidth={2} fill="none" strokeLinecap="round" />
      <path d="M-12 28 C -24 28 -34 34 -40 42" stroke="#ebe7ff" strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </g>
  )
}

function WingsAngel() {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--back gh-pet-outfit--wings">
      <g transform="translate(120 150)">
        <AngelWing />
        <g transform="scale(-1 1)"><AngelWing /></g>
      </g>
    </g>
  )
}

function BatWing() {
  return (
    <g>
      <path
        d="M-8 6 C -38 -10 -76 0 -94 32 C -68 26 -54 36 -40 50 C -30 30 -20 18 -8 18 Z"
        fill="url(#lw-pet-wings-bat)"
        stroke="#2b2140"
        strokeWidth={1.8}
      />
      <path d="M-20 16 C -38 14 -54 22 -66 36" stroke="#8f74c9" strokeWidth={2} fill="none" opacity={0.55} />
      <path d="M-14 24 C -28 26 -40 32 -48 42" stroke="#8f74c9" strokeWidth={1.8} fill="none" opacity={0.45} />
      <path d="M-8 10 L-88 30" stroke="#241a38" strokeWidth={1.4} opacity={0.6} />
    </g>
  )
}

function WingsBat() {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--back gh-pet-outfit--wings">
      <g transform="translate(120 150)">
        <BatWing />
        <g transform="scale(-1 1)"><BatWing /></g>
      </g>
    </g>
  )
}

function HaloGold() {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--aura gh-pet-outfit--halo">
      <ellipse cx={120} cy={28} rx={44} ry={12} fill="url(#lw-pet-halo)" opacity={0.8} />
      <ellipse cx={120} cy={28} rx={34} ry={8} fill="none" stroke="url(#lw-pet-crown)" strokeWidth={6} />
      <ellipse cx={120} cy={28} rx={34} ry={8} fill="none" stroke="#fff6c4" strokeWidth={1.6} opacity={0.8} />
    </g>
  )
}

function AuraSparkle() {
  const sparks = [
    { x: 38, y: 90, s: 0.75 },
    { x: 196, y: 82, s: 0.62 },
    { x: 52, y: 168, s: 0.52 },
    { x: 188, y: 172, s: 0.58 },
    { x: 96, y: 30, s: 0.45 },
    { x: 150, y: 36, s: 0.4 },
  ]
  return (
    <g className="gh-pet-outfit gh-pet-outfit--aura gh-pet-outfit--sparkle">
      {sparks.map((spark, index) => (
        <path
          key={index}
          d={SPARK_PATH}
          transform={`translate(${spark.x} ${spark.y}) scale(${spark.s})`}
          fill={index % 2 === 0 ? '#ffe9a3' : '#bfe6ff'}
          opacity={0.85}
        />
      ))}
    </g>
  )
}

function AuraFlame() {
  const flames = [
    { x: 62, y: 198, s: 1 },
    { x: 178, y: 198, s: 0.9 },
    { x: 46, y: 160, s: 0.72 },
    { x: 194, y: 158, s: 0.8 },
    { x: 120, y: 220, s: 0.8 },
  ]
  return (
    <g className="gh-pet-outfit gh-pet-outfit--aura gh-pet-outfit--flame">
      {flames.map((flame, index) => (
        <path
          key={index}
          d="M0 0 C -9 -14 -5 -28 0 -38 C 5 -28 9 -14 0 0 Z"
          transform={`translate(${flame.x} ${flame.y}) scale(${flame.s})`}
          fill="url(#lw-pet-aura-flame)"
        />
      ))}
    </g>
  )
}

function NeckOutfit({ outfitKey, anchor }: { outfitKey: string; anchor: SlotAnchor }) {
  const node = outfitKey === 'scarf_blue'
    ? <ScarfBlue />
    : outfitKey === 'bowtie'
      ? <Bowtie />
      : outfitKey === 'bell_collar'
        ? <BellCollar />
        : outfitKey === 'star_pin'
          ? <StarPin />
          : null
  if (!node) return null
  return (
    <g className="gh-pet-outfit gh-pet-outfit--neck" transform={`translate(${anchor.x} ${anchor.y}) scale(${anchor.s})`}>
      {node}
    </g>
  )
}

function HatOutfit({ outfitKey, anchor }: { outfitKey: string; anchor: SlotAnchor }) {
  const node = outfitKey === 'hat_red'
    ? <HatRed />
    : outfitKey === 'crown_gold'
      ? <CrownGold />
      : outfitKey === 'party_hat'
        ? <PartyHat />
        : outfitKey === 'bandana'
          ? <Bandana />
          : null
  if (!node) return null
  return (
    <g className="gh-pet-outfit gh-pet-outfit--hat" transform={`translate(${anchor.x} ${anchor.y}) scale(${anchor.s})`}>
      {node}
    </g>
  )
}

function FaceOutfit({ outfitKey, anchor }: { outfitKey: string; anchor: SlotAnchor }) {
  const node = outfitKey === 'glasses_round'
    ? <GlassesRound />
    : outfitKey === 'sunglasses'
      ? <Sunglasses />
      : outfitKey === 'monocle'
        ? <Monocle />
        : null
  if (!node) return null
  return (
    <g className="gh-pet-outfit gh-pet-outfit--face" transform={`translate(${anchor.x} ${anchor.y}) scale(${anchor.s})`}>
      {node}
    </g>
  )
}

function BackOutfit({ outfitKey, scale }: { outfitKey: string; scale: number }) {
  switch (outfitKey) {
    case 'wings_angel': return <WingsAngel />
    case 'wings_bat': return <WingsBat />
    case 'backpack': return <Backpack scale={scale} />
    default: return null
  }
}

function AuraOutfit({ outfitKey }: { outfitKey: string }) {
  switch (outfitKey) {
    case 'halo_gold': return <HaloGold />
    case 'aura_sparkle': return <AuraSparkle />
    case 'aura_flame': return <AuraFlame />
    default: return null
  }
}

/* ============================================================
   动作特效（默认隐藏，由 `gh-pet-anim-*` 容器类在 CSS 里按 key 显示）
   ============================================================ */

function Note({ transform }: { transform: string }) {
  return (
    <g transform={transform}>
      <ellipse cx={0} cy={0} rx={5.6} ry={4.1} transform="rotate(-18)" fill="#7b62e8" />
      <path d="M4.6 -1.4 V -17" stroke="#7b62e8" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M4.6 -17 C 9.5 -15 11.5 -12 10.4 -8.6" stroke="#7b62e8" strokeWidth={2.6} strokeLinecap="round" fill="none" />
    </g>
  )
}

function Zzz({ transform }: { transform: string }) {
  return (
    <path
      d="M0 0 H11 L0 13 H11"
      transform={transform}
      stroke="#6b7bd6"
      strokeWidth={2.6}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

function PetEffects() {
  return (
    <g className="gh-pet-fx-layer" aria-hidden>
      <g className="gh-pet-fx gh-pet-fx-hearts">
        {heart('translate(56 98) scale(0.72) rotate(-14)', 'h1')}
        {heart('translate(78 62) scale(0.5) rotate(10)', 'h2', 0.85)}
        {heart('translate(184 102) scale(0.62) rotate(12)', 'h3', 0.9)}
      </g>
      <g className="gh-pet-fx gh-pet-fx-bubbles">
        <circle cx={70} cy={86} r={11} fill="#eefbff" opacity={0.82} />
        <circle cx={76} cy={82} r={3.4} fill="#fff" opacity={0.9} />
        <circle cx={84} cy={62} r={7} fill="#eefbff" opacity={0.72} />
        <circle cx={176} cy={78} r={9} fill="#eefbff" opacity={0.75} />
        <circle cx={190} cy={112} r={6} fill="#eefbff" opacity={0.65} />
        <circle cx={60} cy={128} r={5} fill="#eefbff" opacity={0.6} />
      </g>
      <g className="gh-pet-fx gh-pet-fx-notes">
        <Note transform="translate(56 86)" />
        <Note transform="translate(186 92) scale(0.86)" />
        <Note transform="translate(70 52) scale(0.7)" />
      </g>
      <g className="gh-pet-fx gh-pet-fx-sparkles">
        {sparkle('translate(64 74) scale(0.9)', 's1')}
        {sparkle('translate(186 80) scale(0.7)', 's2', '#ffe9a3')}
        {sparkle('translate(120 30) scale(0.62)', 's3', '#fff2bd')}
        {sparkle('translate(50 140) scale(0.5)', 's4', '#bfe6ff')}
        {sparkle('translate(198 138) scale(0.56)', 's5', '#ffd0e2')}
      </g>
      <g className="gh-pet-fx gh-pet-fx-ball">
        <circle cx={190} cy={196} r={13} fill="#f6ee8a" stroke="#d7ca55" strokeWidth={2} />
        <path d="M179 190 Q190 197 201 190" stroke="#fff" strokeWidth={2} fill="none" opacity={0.8} />
        <path d="M179 201 Q190 194 201 201" stroke="#d7ca55" strokeWidth={1.6} fill="none" opacity={0.7} />
      </g>
      <g className="gh-pet-fx gh-pet-fx-confetti">
        <rect x={54} y={70} width={7} height={12} rx={2} fill="#ff7b8a" transform="rotate(-18 57 76)" />
        <rect x={86} y={48} width={6} height={11} rx={2} fill="#ffd76e" transform="rotate(22 89 53)" />
        <rect x={150} y={46} width={7} height={12} rx={2} fill="#74d9ff" transform="rotate(-12 153 52)" />
        <rect x={184} y={72} width={6} height={11} rx={2} fill="#a4f0a6" transform="rotate(32 187 77)" />
        <rect x={70} y={110} width={6} height={10} rx={2} fill="#c9a6ff" transform="rotate(14 73 115)" />
        <rect x={176} y={124} width={6} height={10} rx={2} fill="#ffb0c0" transform="rotate(-24 179 129)" />
      </g>
      <g className="gh-pet-fx gh-pet-fx-zzz">
        <Zzz transform="translate(168 84) scale(0.9)" />
        <Zzz transform="translate(184 62) scale(0.66)" />
      </g>
      <g className="gh-pet-fx gh-pet-fx-hand">
        <g transform="translate(194 120) rotate(10)">
          <rect x={-10} y={-4} width={20} height={22} rx={9} fill="#ffcf9a" stroke="#e0a86f" strokeWidth={1.6} />
          <rect x={-10} y={-20} width={6.4} height={20} rx={3.2} fill="#ffd9ab" stroke="#e0a86f" strokeWidth={1.4} />
          <rect x={-2.6} y={-24} width={6.4} height={24} rx={3.2} fill="#ffd9ab" stroke="#e0a86f" strokeWidth={1.4} />
          <rect x={4.6} y={-21} width={6.4} height={21} rx={3.2} fill="#ffd9ab" stroke="#e0a86f" strokeWidth={1.4} />
          <rect x={-20} y={0} width={12} height={7} rx={3.5} fill="#ffd9ab" stroke="#e0a86f" strokeWidth={1.4} transform="rotate(-24 -14 3)" />
        </g>
      </g>
      <g className="gh-pet-fx gh-pet-fx-bowl">
        <g transform="translate(120 216)">
          <path d="M-24 0 Q-20 17 0 17 Q20 17 24 0 Z" fill="#dfe5ef" stroke="#b9c3d4" strokeWidth={1.4} />
          <ellipse cx={0} cy={0} rx={24} ry={5} fill="#f6d9a5" />
          <circle cx={-7} cy={-1} r={3.4} fill="#e2a05c" />
          <circle cx={5} cy={1} r={2.8} fill="#d98d4b" />
        </g>
      </g>
      <g className="gh-pet-fx gh-pet-fx-dust">
        <circle cx={74} cy={214} r={7} fill="#d8c3a4" opacity={0.8} />
        <circle cx={162} cy={214} r={7} fill="#d8c3a4" opacity={0.8} />
        <circle cx={56} cy={202} r={5} fill="#e2d2b8" opacity={0.7} />
      </g>
    </g>
  )
}

/** 低落状态的汗滴（不占动画层，随 mood 常驻） */
function Sweat() {
  return (
    <g className="gh-pet-sweat" aria-hidden>
      <path d="M172 74 C 166 84 164 90 168 94 C 172 98 180 96 181 90 C 182 84 176 80 172 74 Z" fill="url(#lw-pet-sweat)" />
      <circle cx={172} cy={87} r={2.2} fill="#fff" opacity={0.7} />
    </g>
  )
}

/* ============================================================
   组件
   ============================================================ */

function PetSprite({
  species: rawSpecies,
  equipped = null,
  mood = 70,
  animation,
  action,
  size = 200,
  className,
  interactive = false,
}: PetSpriteProps) {
  const species = normalizePetSpecies(rawSpecies)
  const palette = resolveSpeciesPalette(species)
  const meta = resolveSpeciesMeta(species)
  const requested = animation ?? action ?? 'idle'
  const safeAnimation = ANIMATION_RE.test(requested) && KNOWN_ANIMATIONS.has(requested)
    ? requested
    : 'idle'
  const safeMood = Math.max(0, Math.min(100, Number.isFinite(mood) ? mood : 70))
  const anchors = OUTFIT_ANCHORS[species]

  const classes = ['gh-pet-sprite', `gh-pet-anim-${safeAnimation}`]
  if (safeMood >= 70) classes.push('gh-pet-sprite--happy')
  if (safeMood < 30) classes.push('gh-pet-sprite--low')
  if (interactive) classes.push('gh-pet-sprite--interactive')
  if (className) classes.push(className)

  return (
    <div
      className={classes.join(' ')}
      style={{ width: size, height: size }}
      data-species={species}
      data-animation={safeAnimation}
    >
      <svg viewBox="0 0 240 240" role="img" aria-label={meta.name}>
        <PetDefs species={species} palette={palette} />
        <ellipse cx={120} cy={214} rx={62} ry={11} fill="url(#lw-pet-shadow)" />
        {equipped?.back && <BackOutfit outfitKey={equipped.back} scale={anchors.cape} />}
        {equipped?.neck === 'cape_hero' && <CapeHero scale={anchors.cape} />}
        <g className="gh-pet-motion">
          <g className="gh-pet-breathe">
            {renderCreature(species, palette, safeMood)}
          </g>
        </g>
        {equipped?.aura && <AuraOutfit outfitKey={equipped.aura} />}
        {equipped?.neck && equipped.neck !== 'cape_hero' && (
          <NeckOutfit outfitKey={equipped.neck} anchor={anchors.neck} />
        )}
        {equipped?.neck === 'cape_hero' && <CapeCollar anchor={anchors.neck} />}
        {equipped?.hat && <HatOutfit outfitKey={equipped.hat} anchor={anchors.hat} />}
        {equipped?.face && <FaceOutfit outfitKey={equipped.face} anchor={anchors.face} />}
        <PetEffects />
        {safeMood < 30 && <Sweat />}
      </svg>
    </div>
  )
}

/** 纯 SVG 立绘：props 不变时跳过渲染（列表里同一只宠物会随父级状态频繁重渲染） */
export default memo(PetSprite)



import type { ReactNode } from 'react'
import type { PetEquipped, PetSpecies } from '../../types/pet'

/**
 * 2D 宠物立绘（纯 inline SVG，无外部图片资源）—— 高完成度 2.5D 贴纸 / 手办质感。
 *
 * 设计口径：
 * - 统一 200x200 viewBox，Q 版大头（头高约占整体 58%）+ 小身体 + 短腿，坐姿/站姿自然；
 * - 深棕柔和描边（非纯黑）+ 径向渐变体色 + 顶部高光 + 底部环境遮蔽（AO 月牙），无硬阴影；
 * - 大眼：深色眼窝、虹膜渐变、双高光、上眼睑线、睫毛、眉毛；`gh-pet-eye` 负责眨眼；
 * - 三种体型：橘猫（额纹 / 白吻 / 胡须 / 环纹尾）、小狗（垂耳 / 白吻 / 舌头 / 摇尾）、
 *   小鸟（羽冠 / 喙 / 双层羽翅 / 尾羽 / 三趾爪）；
 * - idle 循环：呼吸（`gh-pet-breathe`）+ 猫尾摇摆 / 狗尾摇摆 / 鸟尾 + 猫耳抽动 / 鸟翼扇动 + 眨眼；
 * - sad：耳朵下垂、眉毛内压、嘴角下撇、暗淡高光 + 汗滴，idle 放慢；
 * - 装扮按 equipped 的 hat/neck/face 槽位渲染，未知 key 静默跳过；披风画在身体之后；
 * - 动作动画全部由 pet.css 的 `gh-pet-anim-{action}` 容器类驱动，特效元素默认隐藏、按类显示；
 * - 所有动画在 `prefers-reduced-motion: reduce` 下静音。
 */

interface PetSpriteProps {
  species: PetSpecies
  /** 当前动画 key：idle/eat/bath/play/happy/dance/roll/sing/flip/spin/magic/firework
   *  + stretch/beg/highfive/moonwalk/playdead/cheer（未知值回退静态） */
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
   渐变 / 描边定义（同一页面多实例重复定义相同 id 是安全的）
   ============================================================ */

function PetDefs() {
  return (
    <defs>
      {/* ---------- 通用：投影 / 腮红 / 汗滴 ---------- */}
      <radialGradient id="lw-pet-shadow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#5a3e22" stopOpacity="0.3" />
        <stop offset="0.62" stopColor="#5a3e22" stopOpacity="0.14" />
        <stop offset="1" stopColor="#5a3e22" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="lw-pet-blush" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#f37f96" stopOpacity="0.8" />
        <stop offset="0.55" stopColor="#f79bad" stopOpacity="0.42" />
        <stop offset="1" stopColor="#f9b3c1" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="lw-pet-sweat" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#dff7ff" />
        <stop offset="1" stopColor="#6cc5ee" />
      </linearGradient>

      {/* ---------- 眼睛虹膜（三物种各自色系） ---------- */}
      <linearGradient id="lw-pet-iris-cat" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#3b2412" />
        <stop offset="0.42" stopColor="#8e5318" />
        <stop offset="0.82" stopColor="#c98a2e" />
        <stop offset="1" stopColor="#7a4a15" />
      </linearGradient>
      <linearGradient id="lw-pet-iris-dog" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#2e1d12" />
        <stop offset="0.5" stopColor="#6b3f22" />
        <stop offset="0.86" stopColor="#a86f3f" />
        <stop offset="1" stopColor="#5f371c" />
      </linearGradient>
      <linearGradient id="lw-pet-iris-bird" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#10283f" />
        <stop offset="0.45" stopColor="#1d5f92" />
        <stop offset="0.84" stopColor="#4fb4de" />
        <stop offset="1" stopColor="#17466b" />
      </linearGradient>

      {/* ---------- 小猫：橘色虎斑 ---------- */}
      <radialGradient id="lw-pet-cat-body" gradientUnits="userSpaceOnUse" cx="72" cy="46" r="132">
        <stop offset="0" stopColor="#ffe9bf" />
        <stop offset="0.34" stopColor="#fbd28c" />
        <stop offset="0.68" stopColor="#f4b160" />
        <stop offset="0.9" stopColor="#e29440" />
        <stop offset="1" stopColor="#c97a2e" />
      </radialGradient>
      <linearGradient id="lw-pet-cat-leg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fbd18b" />
        <stop offset="0.6" stopColor="#f0ad58" />
        <stop offset="1" stopColor="#d98c38" />
      </linearGradient>
      <linearGradient id="lw-pet-cat-belly" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fffaf0" />
        <stop offset="0.66" stopColor="#fdeecd" />
        <stop offset="1" stopColor="#f5ddb0" />
      </linearGradient>
      <linearGradient id="lw-pet-cat-tail" x1="0" y1="1" x2="0.9" y2="0">
        <stop offset="0" stopColor="#e59a46" />
        <stop offset="0.55" stopColor="#f7c377" />
        <stop offset="1" stopColor="#ffe0a8" />
      </linearGradient>
      <radialGradient id="lw-pet-ear-pink" cx="0.5" cy="0.42" r="0.7">
        <stop offset="0" stopColor="#ffd4dc" />
        <stop offset="1" stopColor="#f2a0b1" />
      </radialGradient>
      <linearGradient id="lw-pet-nose" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f9b3c4" />
        <stop offset="1" stopColor="#e97f9b" />
      </linearGradient>

      {/* ---------- 小狗：奶咖色垂耳 ---------- */}
      <radialGradient id="lw-pet-dog-body" gradientUnits="userSpaceOnUse" cx="70" cy="45" r="135">
        <stop offset="0" stopColor="#fff4e0" />
        <stop offset="0.36" stopColor="#f6dcb6" />
        <stop offset="0.7" stopColor="#e8c18d" />
        <stop offset="1" stopColor="#c99662" />
      </radialGradient>
      <linearGradient id="lw-pet-dog-leg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f7ddb6" />
        <stop offset="0.6" stopColor="#e3b98a" />
        <stop offset="1" stopColor="#c99a63" />
      </linearGradient>
      <linearGradient id="lw-pet-dog-ear" x1="0.15" y1="0" x2="0.85" y2="1">
        <stop offset="0" stopColor="#d7a672" />
        <stop offset="0.55" stopColor="#bb8655" />
        <stop offset="1" stopColor="#9b693c" />
      </linearGradient>
      <linearGradient id="lw-pet-dog-belly" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fffcf5" />
        <stop offset="0.7" stopColor="#faeed9" />
        <stop offset="1" stopColor="#f0dcbc" />
      </linearGradient>
      <linearGradient id="lw-pet-tongue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fba6b8" />
        <stop offset="1" stopColor="#e66685" />
      </linearGradient>

      {/* ---------- 小鸟：薄荷蓝 ---------- */}
      <radialGradient id="lw-pet-bird-body" gradientUnits="userSpaceOnUse" cx="72" cy="45" r="132">
        <stop offset="0" stopColor="#e6fbff" />
        <stop offset="0.34" stopColor="#b9effc" />
        <stop offset="0.68" stopColor="#7ed7f1" />
        <stop offset="0.9" stopColor="#4db6dc" />
        <stop offset="1" stopColor="#2e8fb8" />
      </radialGradient>
      <linearGradient id="lw-pet-bird-belly" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f8feff" />
        <stop offset="0.7" stopColor="#e0f8ff" />
        <stop offset="1" stopColor="#c3ecf8" />
      </linearGradient>
      <linearGradient id="lw-pet-bird-wing" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#9ee6fa" />
        <stop offset="0.55" stopColor="#5ec6e8" />
        <stop offset="1" stopColor="#2f95bf" />
      </linearGradient>
      <linearGradient id="lw-pet-bird-crest" x1="0" y1="1" x2="0.6" y2="0">
        <stop offset="0" stopColor="#7dd6f2" />
        <stop offset="1" stopColor="#c8f5ff" />
      </linearGradient>
      <linearGradient id="lw-pet-bird-beak" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffd469" />
        <stop offset="0.55" stopColor="#f9b23c" />
        <stop offset="1" stopColor="#e08f14" />
      </linearGradient>

      {/* ---------- 装扮：毛线帽 ---------- */}
      <linearGradient id="lw-pet-hat-red" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ff8578" />
        <stop offset="0.55" stopColor="#ef5f55" />
        <stop offset="1" stopColor="#c93c37" />
      </linearGradient>
      <radialGradient id="lw-pet-pom" cx="0.36" cy="0.3" r="0.82">
        <stop offset="0" stopColor="#fffdf6" />
        <stop offset="0.62" stopColor="#f2e6cd" />
        <stop offset="1" stopColor="#dcc9a4" />
      </radialGradient>

      {/* ---------- 装扮：皇冠 ---------- */}
      <linearGradient id="lw-pet-crown" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#fff0ae" />
        <stop offset="0.42" stopColor="#f8d05f" />
        <stop offset="1" stopColor="#dda01f" />
      </linearGradient>
      <linearGradient id="lw-pet-crown-band" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f5c94e" />
        <stop offset="1" stopColor="#c98c14" />
      </linearGradient>

      {/* ---------- 装扮：围巾 / 领结 / 披风 ---------- */}
      <linearGradient id="lw-pet-scarf" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stopColor="#77bcff" />
        <stop offset="0.55" stopColor="#3f8cf0" />
        <stop offset="1" stopColor="#2464c4" />
      </linearGradient>
      <linearGradient id="lw-pet-bowtie" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#f6796f" />
        <stop offset="0.6" stopColor="#dd4c45" />
        <stop offset="1" stopColor="#b8312f" />
      </linearGradient>
      <linearGradient id="lw-pet-cape" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#e85a51" />
        <stop offset="0.55" stopColor="#cf3f3a" />
        <stop offset="1" stopColor="#9d2926" />
      </linearGradient>

      {/* ---------- 装扮：镜片 ---------- */}
      <radialGradient id="lw-pet-glasses-lens" cx="0.32" cy="0.26" r="0.85">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="0.55" stopColor="#dff3ff" stopOpacity="0.18" />
        <stop offset="1" stopColor="#b8def5" stopOpacity="0.1" />
      </radialGradient>
      <linearGradient id="lw-pet-sun-lens" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stopColor="#5b6272" />
        <stop offset="0.45" stopColor="#2c303c" />
        <stop offset="1" stopColor="#14161f" />
      </linearGradient>
    </defs>
  )
}

/* ============================================================
   共用部件：大眼睛（渐变瞳 + 双高光 + 眼睑 + 睫毛） / 眉毛 / 腮红 / 汗滴
   ============================================================ */

function PetEyes({ cy, iris }: { cy: number; iris: string }) {
  return (
    <>
      <g className="gh-pet-eyes">
        {[80, 120].map((cx) => {
          const outer = cx < 100 ? -1 : 1
          return (
            <g key={cx} className="gh-pet-eye">
              {/* 眼窝 / 睫毛底色 */}
              <ellipse cx={cx} cy={cy} rx="13.2" ry="15" fill="#3a2a25" />
              {/* 虹膜渐变 + 下半反光 */}
              <ellipse cx={cx} cy={cy + 1.2} rx="11.2" ry="12.6" fill={`url(#${iris})`} />
              <ellipse cx={cx} cy={cy + 6} rx="7.2" ry="5.4" fill="#fff3cf" opacity="0.28" />
              {/* 主高光 / 次高光 */}
              <circle className="gh-pet-eye-shine" cx={cx - 4.2} cy={cy - 5} r="4.6" fill="#ffffff" />
              <circle className="gh-pet-eye-shine" cx={cx + 4.8} cy={cy + 5.2} r="2" fill="#ffffff" opacity="0.92" />
              {/* 上眼睑线 + 外眼角睫毛 */}
              <path
                d={`M ${cx - 12} ${cy - 13.2} Q ${cx} ${cy - 21.5} ${cx + 12} ${cy - 13.2}`}
                fill="none"
                stroke="#3a2a25"
                strokeWidth="2.4"
                strokeLinecap="round"
                opacity="0.78"
              />
              <path
                d={`M ${cx + outer * 12} ${cy - 11} l ${outer * 2.8} -2.4`}
                fill="none"
                stroke="#3a2a25"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.55"
              />
            </g>
          )
        })}
      </g>
      {/* 装死时的 × 眼（默认隐藏，容器类 gh-pet-anim-playdead 打开） */}
      <g className="gh-pet-xeyes">
        {[80, 120].map((cx) => (
          <g key={cx} stroke="#3a2a25" strokeWidth="3.4" strokeLinecap="round">
            <path d={`M ${cx - 7} ${cy - 7} L ${cx + 7} ${cy + 7}`} />
            <path d={`M ${cx + 7} ${cy - 7} L ${cx - 7} ${cy + 7}`} />
          </g>
        ))}
      </g>
    </>
  )
}

function PetBrows({
  y,
  stroke,
  opacity = 0.7,
  width = 3,
}: {
  y: number
  stroke: string
  opacity?: number
  width?: number
}) {
  return (
    <g
      className="gh-pet-brows"
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      opacity={opacity}
    >
      <g className="gh-pet-brow gh-pet-brow--l">
        <path d={`M 68 ${y + 4} Q 78 ${y - 2} 89 ${y + 2}`} />
      </g>
      <g className="gh-pet-brow gh-pet-brow--r">
        <path d={`M 132 ${y + 4} Q 122 ${y - 2} 111 ${y + 2}`} />
      </g>
    </g>
  )
}

function PetBlush({ cy }: { cy: number }) {
  return (
    <g className="gh-pet-blush">
      <ellipse cx="63" cy={cy} rx="11" ry="6.2" fill="url(#lw-pet-blush)" />
      <ellipse cx="137" cy={cy} rx="11" ry="6.2" fill="url(#lw-pet-blush)" />
    </g>
  )
}

function PetSweat() {
  return (
    <g className="gh-pet-sweat">
      <path
        d="M 146 47 C 140 56 137 62 139 67 C 141 71 147 72 150 68 C 153 64 152 57 146 47 Z"
        fill="url(#lw-pet-sweat)"
        stroke="#5aa9ce"
        strokeWidth="1.1"
        strokeOpacity="0.55"
      />
      <ellipse cx="144.5" cy="61" rx="1.9" ry="2.8" fill="#ffffff" opacity="0.85" transform="rotate(16 144.5 61)" />
    </g>
  )
}

/* ============================================================
   小猫：橘色虎斑
   ============================================================ */

function CatBody() {
  return (
    <g>
      {/* 环纹大弯尾（画在身体之后） */}
      <g className="gh-pet-tail gh-pet-tail--cat">
        <path
          d="M126 163 C 152 167 171 150 172 127 C 173 111 170 99 165 92"
          fill="none"
          stroke="url(#lw-pet-cat-tail)"
          strokeWidth="17"
          strokeLinecap="round"
        />
        <g stroke="#c17a33" strokeWidth="5.4" strokeLinecap="round" opacity="0.9">
          <path d="M152 160 L 163 148" />
          <path d="M168 140 L 177 130" />
          <path d="M170 118 L 177 107" />
        </g>
        <circle cx="165" cy="92" r="8.6" fill="#fff3da" />
        <path d="M161 88 Q 164 85 168 87" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      </g>

      <g className="gh-pet-breathe">
        <g className="gh-pet-body">
          {/* 坐姿身体 */}
          <ellipse
            cx="100"
            cy="151"
            rx="37"
            ry="33"
            fill="url(#lw-pet-cat-body)"
            stroke="#8a5423"
            strokeWidth="1.6"
            strokeOpacity="0.5"
          />
          <ellipse cx="88" cy="134" rx="14" ry="8" fill="#ffffff" opacity="0.16" transform="rotate(-20 88 134)" />
          {/* 奶白胸腹 */}
          <path
            d="M100 121 C 85 121 74 135 73 151 C 72 168 84 179 100 179 C 116 179 128 168 127 151 C 126 135 115 121 100 121 Z"
            fill="url(#lw-pet-cat-belly)"
          />
          <g fill="#fff9ec">
            <circle cx="87" cy="125" r="5.4" />
            <circle cx="100" cy="122" r="6" />
            <circle cx="113" cy="125" r="5.4" />
          </g>
          {/* 头部投在胸口的柔和阴影 */}
          <ellipse cx="100" cy="133" rx="31" ry="8.5" fill="#8a5423" opacity="0.13" />
          {/* 后爪 */}
          <ellipse cx="69" cy="173" rx="13.5" ry="10.5" fill="url(#lw-pet-cat-leg)" stroke="#a96726" strokeWidth="1.2" strokeOpacity="0.4" />
          <ellipse cx="131" cy="173" rx="13.5" ry="10.5" fill="url(#lw-pet-cat-leg)" stroke="#a96726" strokeWidth="1.2" strokeOpacity="0.4" />
          <g stroke="#b97431" strokeWidth="1.4" strokeLinecap="round" opacity="0.5">
            <path d="M64 170 v 4" />
            <path d="M69 169 v 4" />
            <path d="M136 170 v 4" />
            <path d="M131 169 v 4" />
          </g>
          {/* 前爪（可作揖 / 击掌） */}
          <g className="gh-pet-arm gh-pet-arm--l">
            <path
              d="M80 143 C 75 155 74 169 79 179 C 82 185 91 184 93 177 C 95 168 94 154 95 143 Z"
              fill="url(#lw-pet-cat-leg)"
              stroke="#b97431"
              strokeWidth="1.2"
              strokeOpacity="0.4"
            />
            <ellipse cx="85.5" cy="178.5" rx="8.2" ry="5.6" fill="#fff6e3" opacity="0.96" />
            <path d="M85 177 v 4 M90 177 v 4" fill="none" stroke="#c98a3f" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
          </g>
          <g className="gh-pet-arm gh-pet-arm--r">
            <path
              d="M120 143 C 125 155 126 169 121 179 C 118 185 109 184 107 177 C 105 168 106 154 105 143 Z"
              fill="url(#lw-pet-cat-leg)"
              stroke="#b97431"
              strokeWidth="1.2"
              strokeOpacity="0.4"
            />
            <ellipse cx="114.5" cy="178.5" rx="8.2" ry="5.6" fill="#fff6e3" opacity="0.96" />
            <path d="M115 177 v 4 M110 177 v 4" fill="none" stroke="#c98a3f" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
          </g>
          {/* 底部环境遮蔽 */}
          <path
            d="M68 168 C 78 180 88 184 100 184 C 112 184 122 180 132 168 C 127 180 116 186 100 186 C 84 186 73 180 68 168 Z"
            fill="#b26b26"
            opacity="0.16"
          />
        </g>

        {/* 圆角三角耳 */}
        <g className="gh-pet-ear gh-pet-ear--l gh-pet-ear--cat">
          <path
            d="M64 52 C 55 41 48 27 46 15 C 45 9 50 6 55 10 C 68 21 81 32 94 40 C 84 45 74 49 64 52 Z"
            fill="url(#lw-pet-cat-body)"
            stroke="#8a5423"
            strokeWidth="1.6"
            strokeOpacity="0.5"
            strokeLinejoin="round"
          />
          <path d="M63 46 C 57 37 53 27 52 19 C 61 28 71 35 81 40 C 75 42 69 44 63 46 Z" fill="url(#lw-pet-ear-pink)" />
          <path d="M47 14 C 49 10 52 9 55 9" fill="none" stroke="#fff3da" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
        </g>
        <g className="gh-pet-ear gh-pet-ear--r gh-pet-ear--cat">
          <path
            d="M136 52 C 145 41 152 27 154 15 C 155 9 150 6 145 10 C 132 21 119 32 106 40 C 116 45 126 49 136 52 Z"
            fill="url(#lw-pet-cat-body)"
            stroke="#8a5423"
            strokeWidth="1.6"
            strokeOpacity="0.5"
            strokeLinejoin="round"
          />
          <path d="M137 46 C 143 37 147 27 148 19 C 139 28 129 35 119 40 C 125 42 131 44 137 46 Z" fill="url(#lw-pet-ear-pink)" />
          <path d="M153 14 C 151 10 148 9 145 9" fill="none" stroke="#fff3da" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
        </g>

        {/* 头 */}
        <g className="gh-pet-head">
          <path
            d="M100 27 C 126 27 147 40 153 62 C 159 83 155 103 143 116 C 131 128 116 132 100 132 C 84 132 69 128 57 116 C 45 103 41 83 47 62 C 53 40 74 27 100 27 Z"
            fill="url(#lw-pet-cat-body)"
            stroke="#8a5423"
            strokeWidth="1.7"
            strokeOpacity="0.5"
          />
          <path d="M61 65 C 67 47 81 36 98 33" fill="none" stroke="#fff3d6" strokeWidth="3" strokeLinecap="round" opacity="0.32" />
          {/* 脸颊绒毛 */}
          <g fill="url(#lw-pet-cat-body)">
            <path d="M54 86 C 47 87 42 91 38 97 C 45 97 51 95 56 92 Z" />
            <path d="M56 100 C 49 102 44 106 41 112 C 48 111 54 108 59 105 Z" />
            <path d="M146 86 C 153 87 158 91 162 97 C 155 97 149 95 144 92 Z" />
            <path d="M144 100 C 151 102 156 106 159 112 C 152 111 146 108 141 105 Z" />
          </g>
          {/* 顶部高光 + 底部 AO */}
          <ellipse cx="80" cy="46" rx="25" ry="11" fill="#fff6de" opacity="0.32" transform="rotate(-20 80 46)" />
          <circle cx="62" cy="57" r="4" fill="#ffffff" opacity="0.16" />
          <path
            d="M56 108 C 70 126 86 132 100 132 C 114 132 130 126 144 108 C 136 123 120 130 100 130 C 80 130 64 123 56 108 Z"
            fill="#b26b26"
            opacity="0.18"
          />
          {/* 额纹 */}
          <g stroke="#c17a33" strokeWidth="4" strokeLinecap="round" opacity="0.8">
            <path d="M100 36 v 10" />
            <path d="M88 39 q 2 5 0 9" />
            <path d="M112 39 q -2 5 0 9" />
          </g>
          <PetBlush cy={99} />
          {/* 白吻部 */}
          <path
            d="M100 87 C 87 87 76 93 74 102 C 72 111 83 119 100 119 C 117 119 128 111 126 102 C 124 93 113 87 100 87 Z"
            fill="url(#lw-pet-cat-belly)"
            stroke="#e2c493"
            strokeWidth="1.1"
            strokeOpacity="0.5"
          />
          <g fill="#fffdf6">
            <circle cx="84" cy="91" r="4.4" />
            <circle cx="100" cy="89" r="4.8" />
            <circle cx="116" cy="91" r="4.4" />
          </g>
          {/* 粉鼻 + ω 嘴 + sad 嘴 */}
          <path
            d="M94 92 h12 q2.6 0 1.6 2.4 l-5.4 6.4 q-2.2 2.6 -4.4 0 l-5.4 -6.4 q-1 -2.4 1.6 -2.4 Z"
            fill="url(#lw-pet-nose)"
          />
          <ellipse cx="97" cy="94.4" rx="1.8" ry="1.2" fill="#ffffff" opacity="0.8" />
          <g fill="none" stroke="#8a6440" strokeWidth="2.1" strokeLinecap="round">
            <path className="gh-pet-mouth-happy" d="M100 101.5 V 104" />
            <path className="gh-pet-mouth-happy" d="M100 104 q -5 6 -10 1.5 M 100 104 q 5 6 10 1.5" />
            <path className="gh-pet-mouth-sad" d="M92 111 q 8 -6 16 0" />
          </g>
          <PetBrows y={58} stroke="#b97431" opacity={0.55} width={2.8} />
          <PetEyes cy={81} iris="lw-pet-iris-cat" />
          {/* 胡须 + 须点 */}
          <g fill="none" stroke="#a9764a" strokeWidth="1.6" strokeLinecap="round" opacity="0.7">
            <path d="M75 96 C 61 93 50 91 39 90" />
            <path d="M75 101 C 61 101 50 102 38 104" />
            <path d="M76 106 C 63 108 53 112 44 117" />
            <path d="M125 96 C 139 93 150 91 161 90" />
            <path d="M125 101 C 139 101 150 102 162 104" />
            <path d="M124 106 C 137 108 147 112 156 117" />
          </g>
          <g fill="#b97431" opacity="0.35">
            <circle cx="70" cy="96" r="1.2" />
            <circle cx="68" cy="102" r="1.2" />
            <circle cx="70" cy="108" r="1.2" />
            <circle cx="130" cy="96" r="1.2" />
            <circle cx="132" cy="102" r="1.2" />
            <circle cx="130" cy="108" r="1.2" />
          </g>
        </g>
      </g>
    </g>
  )
}

/* ============================================================
   小狗：奶咖垂耳
   ============================================================ */

function DogBody() {
  return (
    <g>
      {/* 蓬松摇尾 */}
      <g className="gh-pet-tail gh-pet-tail--dog">
        <path
          d="M130 163 C 151 167 166 153 169 134"
          fill="none"
          stroke="url(#lw-pet-dog-body)"
          strokeWidth="19"
          strokeLinecap="round"
        />
        <circle cx="169" cy="134" r="10.5" fill="#f9ead0" />
        <path d="M178 132 C 184 129 188 124 190 118 C 184 122 179 127 176 131 Z" fill="#f9ead0" />
        <path d="M164 128 q 3 -4 7 -4" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      </g>

      <g className="gh-pet-breathe">
        <g className="gh-pet-body">
          <ellipse
            cx="100"
            cy="151"
            rx="37"
            ry="33"
            fill="url(#lw-pet-dog-body)"
            stroke="#6b4a33"
            strokeWidth="1.6"
            strokeOpacity="0.45"
          />
          <ellipse cx="88" cy="134" rx="14" ry="8" fill="#ffffff" opacity="0.2" transform="rotate(-20 88 134)" />
          {/* 侧腹斑块 */}
          <ellipse cx="67" cy="148" rx="12" ry="17" fill="#c58f58" opacity="0.4" transform="rotate(-14 67 148)" />
          {/* 奶白胸腹 */}
          <path
            d="M100 121 C 85 121 74 135 73 151 C 72 168 84 179 100 179 C 116 179 128 168 127 151 C 126 135 115 121 100 121 Z"
            fill="url(#lw-pet-dog-belly)"
          />
          <g fill="#fffcf5">
            <circle cx="87" cy="125" r="5.4" />
            <circle cx="100" cy="122" r="6" />
            <circle cx="113" cy="125" r="5.4" />
          </g>
          <ellipse cx="100" cy="133" rx="31" ry="8.5" fill="#8a5c34" opacity="0.13" />
          {/* 后爪 */}
          <ellipse cx="69" cy="173" rx="13.5" ry="10.5" fill="url(#lw-pet-dog-leg)" stroke="#a9784a" strokeWidth="1.2" strokeOpacity="0.4" />
          <ellipse cx="131" cy="173" rx="13.5" ry="10.5" fill="url(#lw-pet-dog-leg)" stroke="#a9784a" strokeWidth="1.2" strokeOpacity="0.4" />
          <g stroke="#b48252" strokeWidth="1.4" strokeLinecap="round" opacity="0.5">
            <path d="M64 170 v 4" />
            <path d="M69 169 v 4" />
            <path d="M136 170 v 4" />
            <path d="M131 169 v 4" />
          </g>
          <g className="gh-pet-arm gh-pet-arm--l">
            <path
              d="M80 143 C 75 155 74 169 79 179 C 82 185 91 184 93 177 C 95 168 94 154 95 143 Z"
              fill="url(#lw-pet-dog-leg)"
              stroke="#b48252"
              strokeWidth="1.2"
              strokeOpacity="0.4"
            />
            <ellipse cx="85.5" cy="178.5" rx="8.2" ry="5.6" fill="#fffaf0" opacity="0.96" />
            <path d="M85 177 v 4 M90 177 v 4" fill="none" stroke="#c09060" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
          </g>
          <g className="gh-pet-arm gh-pet-arm--r">
            <path
              d="M120 143 C 125 155 126 169 121 179 C 118 185 109 184 107 177 C 105 168 106 154 105 143 Z"
              fill="url(#lw-pet-dog-leg)"
              stroke="#b48252"
              strokeWidth="1.2"
              strokeOpacity="0.4"
            />
            <ellipse cx="114.5" cy="178.5" rx="8.2" ry="5.6" fill="#fffaf0" opacity="0.96" />
            <path d="M115 177 v 4 M110 177 v 4" fill="none" stroke="#c09060" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
          </g>
          {/* 底部环境遮蔽 */}
          <path
            d="M68 168 C 78 180 88 184 100 184 C 112 184 122 180 132 168 C 127 180 116 186 100 186 C 84 186 73 180 68 168 Z"
            fill="#9c6a3d"
            opacity="0.16"
          />
        </g>

        {/* 垂耳（头后，外侧深 / 内侧浅） */}
        <g className="gh-pet-ear gh-pet-ear--l gh-pet-ear--dog">
          <path
            d="M70 40 C 50 42 33 58 30 80 C 27 102 36 124 52 137 C 63 146 73 137 74 118 C 75 94 74 62 84 48 Z"
            fill="url(#lw-pet-dog-ear)"
            stroke="#6b4a33"
            strokeWidth="1.5"
            strokeOpacity="0.45"
          />
          <path d="M66 52 C 52 57 41 70 40 85 C 39 101 46 117 55 125 C 60 129 64 124 64 114 C 64 92 66 66 71 54 Z" fill="#a9784a" opacity="0.5" />
          <path d="M57 58 C 48 76 47 104 53 124" fill="none" stroke="#8a5c34" strokeWidth="2" strokeLinecap="round" opacity="0.32" />
          <path d="M38 82 C 36 98 40 114 48 126" fill="none" stroke="#e0b383" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
          <path d="M44 132 C 42 138 41 142 42 146 C 46 142 50 138 52 133 Z" fill="#b98552" />
        </g>
        <g className="gh-pet-ear gh-pet-ear--r gh-pet-ear--dog">
          <path
            d="M130 40 C 150 42 167 58 170 80 C 173 102 164 124 148 137 C 137 146 127 137 126 118 C 125 94 126 62 116 48 Z"
            fill="url(#lw-pet-dog-ear)"
            stroke="#6b4a33"
            strokeWidth="1.5"
            strokeOpacity="0.45"
          />
          <path d="M134 52 C 148 57 159 70 160 85 C 161 101 154 117 145 125 C 140 129 136 124 136 114 C 136 92 134 66 129 54 Z" fill="#a9784a" opacity="0.5" />
          <path d="M143 58 C 152 76 153 104 147 124" fill="none" stroke="#8a5c34" strokeWidth="2" strokeLinecap="round" opacity="0.32" />
          <path d="M162 82 C 164 98 160 114 152 126" fill="none" stroke="#e0b383" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
          <path d="M156 132 C 158 138 159 142 158 146 C 154 142 150 138 148 133 Z" fill="#b98552" />
        </g>

        {/* 头 */}
        <g className="gh-pet-head">
          <path
            d="M100 28 C 128 28 149 41 155 63 C 161 85 156 106 142 119 C 129 130 115 134 100 134 C 85 134 71 130 58 119 C 44 106 39 85 45 63 C 51 41 72 28 100 28 Z"
            fill="url(#lw-pet-dog-body)"
            stroke="#6b4a33"
            strokeWidth="1.7"
            strokeOpacity="0.45"
          />
          <path d="M60 65 C 66 47 81 36 99 33" fill="none" stroke="#fff6e6" strokeWidth="3" strokeLinecap="round" opacity="0.32" />
          {/* 左眼奶白斑 + 顶部高光 + AO */}
          <ellipse cx="78" cy="80" rx="21" ry="24" fill="#faecd6" opacity="0.9" />
          <ellipse cx="80" cy="47" rx="25" ry="11" fill="#fffaf0" opacity="0.34" transform="rotate(-20 80 47)" />
          <circle cx="62" cy="58" r="4" fill="#ffffff" opacity="0.16" />
          <path
            d="M58 108 C 72 126 87 134 100 134 C 113 134 128 126 142 108 C 134 124 119 132 100 132 C 81 132 66 124 58 108 Z"
            fill="#b98b5e"
            opacity="0.18"
          />
          <PetBlush cy={100} />
          {/* 奶白吻部 */}
          <ellipse
            cx="100"
            cy="104"
            rx="29"
            ry="18.5"
            fill="url(#lw-pet-dog-belly)"
            stroke="#e6cda8"
            strokeWidth="1.1"
            strokeOpacity="0.55"
          />
          {/* 黑鼻 + 高光 + Y 形嘴 */}
          <ellipse cx="100" cy="93.5" rx="8.4" ry="6.4" fill="#3b2e29" />
          <ellipse cx="97.4" cy="91.4" rx="2.8" ry="1.8" fill="#ffffff" opacity="0.72" transform="rotate(-18 97.4 91.4)" />
          <path className="gh-pet-mouth-happy" d="M100 99 V 105" fill="none" stroke="#8a6b45" strokeWidth="2.2" strokeLinecap="round" />
          <path
            className="gh-pet-mouth-happy"
            d="M100 105 q -6 6 -12 1 M 100 105 q 6 6 12 1"
            fill="none"
            stroke="#8a6b45"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <g className="gh-pet-mouth-sad">
            <path d="M90 112 q 10 -6 20 0" fill="none" stroke="#8a6b45" strokeWidth="2.1" strokeLinecap="round" />
          </g>
          {/* 舌头（默认藏起，play/happy/beg/cheer/playdead 露出） */}
          <g className="gh-pet-tongue">
            <path d="M94 107 C 93 120 107 120 106 107 Q 100 110 94 107 Z" fill="url(#lw-pet-tongue)" />
            <path d="M100 109 v 4" fill="none" stroke="#d95f7e" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
          </g>
          <PetBrows y={58} stroke="#b07c4c" opacity={0.7} width={3.4} />
          <PetEyes cy={81} iris="lw-pet-iris-dog" />
        </g>
      </g>
    </g>
  )
}

/* ============================================================
   小鸟：薄荷蓝
   ============================================================ */

function BirdBody() {
  return (
    <g>
      {/* 尾羽 */}
      <g className="gh-pet-tail gh-pet-tail--bird">
        <path d="M112 158 C 134 158 155 169 168 184 C 150 186 128 176 112 166 Z" fill="url(#lw-pet-bird-wing)" />
        <path d="M108 168 C 128 170 146 180 156 192 C 138 192 118 182 106 172 Z" fill="#7acbea" opacity="0.92" />
        <path d="M116 160 C 134 164 148 172 156 182" fill="none" stroke="#2f7e9f" strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
      </g>

      {/* 三趾爪 */}
      <g fill="none" stroke="#efa233" strokeWidth="4.2" strokeLinecap="round">
        <path d="M87 170 V 186" />
        <path d="M113 170 V 186" />
        <path d="M87 186 L 81 191 M 87 186 V 192 M 87 186 L 93 191" />
        <path d="M113 186 L 107 191 M 113 186 V 192 M 113 186 L 119 191" />
      </g>

      <g className="gh-pet-breathe">
        <g className="gh-pet-body">
          <ellipse
            cx="100"
            cy="152"
            rx="37"
            ry="33"
            fill="url(#lw-pet-bird-body)"
            stroke="#2f7e9f"
            strokeWidth="1.6"
            strokeOpacity="0.45"
          />
          <ellipse cx="88" cy="134" rx="14" ry="8" fill="#ffffff" opacity="0.22" transform="rotate(-22 88 134)" />
          <ellipse cx="100" cy="157" rx="24" ry="24" fill="url(#lw-pet-bird-belly)" />
          <g fill="url(#lw-pet-bird-belly)">
            <circle cx="88" cy="132" r="7" />
            <circle cx="100" cy="129" r="8" />
            <circle cx="112" cy="132" r="7" />
          </g>
          <ellipse cx="100" cy="132" rx="30" ry="8" fill="#2f7e9f" opacity="0.12" />
          <path
            d="M68 168 C 78 180 88 184 100 184 C 112 184 122 180 132 168 C 127 180 116 186 100 186 C 84 186 73 180 68 168 Z"
            fill="#2f7e9f"
            opacity="0.14"
          />
        </g>

        {/* 双层羽翅（同时作为 “手臂” 参与作揖 / 击掌 / 欢呼） */}
        <g className="gh-pet-wing gh-pet-wing--l gh-pet-arm gh-pet-arm--l">
          <path
            d="M72 126 C 56 132 46 148 45 164 C 44 173 51 180 59 177 C 66 174 70 165 74 160 C 77 167 85 169 89 162 C 93 154 91 136 86 128 C 82 123 76 123 72 126 Z"
            fill="url(#lw-pet-bird-wing)"
            stroke="#2f7e9f"
            strokeWidth="1.5"
            strokeOpacity="0.4"
          />
          <path d="M56 156 C 62 164 70 168 78 167" fill="none" stroke="#d8f7ff" strokeWidth="2.4" strokeLinecap="round" opacity="0.65" />
          <path d="M60 148 C 65 154 71 157 76 157" fill="none" stroke="#d8f7ff" strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />
          <path d="M48 168 C 54 174 60 177 66 177" fill="none" stroke="#d8f7ff" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        </g>
        <g className="gh-pet-wing gh-pet-wing--r gh-pet-arm gh-pet-arm--r">
          <path
            d="M128 126 C 144 132 154 148 155 164 C 156 173 149 180 141 177 C 134 174 130 165 126 160 C 123 167 115 169 111 162 C 107 154 109 136 114 128 C 118 123 124 123 128 126 Z"
            fill="url(#lw-pet-bird-wing)"
            stroke="#2f7e9f"
            strokeWidth="1.5"
            strokeOpacity="0.4"
          />
          <path d="M144 156 C 138 164 130 168 122 167" fill="none" stroke="#d8f7ff" strokeWidth="2.4" strokeLinecap="round" opacity="0.65" />
          <path d="M140 148 C 135 154 129 157 124 157" fill="none" stroke="#d8f7ff" strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />
          <path d="M152 168 C 146 174 140 177 134 177" fill="none" stroke="#d8f7ff" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        </g>

        {/* 羽冠（头后，头会盖住根部） */}
        <g className="gh-pet-tuft">
          <path d="M96 34 C 89 25 86 15 90 6 C 97 13 101 23 102 33 Z" fill="url(#lw-pet-bird-crest)" stroke="#2f7e9f" strokeWidth="1.3" strokeOpacity="0.45" />
          <path d="M104 33 C 106 21 113 11 121 6 C 117 16 112 26 108 34 Z" fill="url(#lw-pet-bird-crest)" stroke="#2f7e9f" strokeWidth="1.3" strokeOpacity="0.45" />
          <path d="M100 32 C 96 20 98 10 104 2 C 108 11 106 23 104 33 Z" fill="#8bd9f2" stroke="#2f7e9f" strokeWidth="1.3" strokeOpacity="0.45" />
        </g>

        {/* 头 */}
        <g className="gh-pet-head">
          <ellipse
            cx="100"
            cy="79"
            rx="52"
            ry="50"
            fill="url(#lw-pet-bird-body)"
            stroke="#2f7e9f"
            strokeWidth="1.7"
            strokeOpacity="0.45"
          />
          <path d="M58 66 C 64 46 79 34 98 31" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
          <ellipse cx="78" cy="47" rx="24" ry="11" fill="#ffffff" opacity="0.32" transform="rotate(-20 78 47)" />
          <circle cx="60" cy="58" r="4" fill="#ffffff" opacity="0.18" />
          <path
            d="M56 108 C 70 126 86 129 100 129 C 114 129 130 126 144 108 C 136 123 120 128 100 128 C 80 128 64 123 56 108 Z"
            fill="#2f7e9f"
            opacity="0.16"
          />
          <PetBrows y={58} stroke="#3e8fb4" opacity={0.5} width={3} />
          <PetEyes cy={81} iris="lw-pet-iris-bird" />
          <PetBlush cy={98} />
          {/* 双层喙 */}
          <path
            d="M88 92 Q 100 83 112 92 Q 106 99 100 100 Q 94 99 88 92 Z"
            fill="url(#lw-pet-bird-beak)"
            stroke="#c9821a"
            strokeWidth="1.3"
            strokeOpacity="0.6"
          />
          <path d="M92 100 Q 100 98 108 100 Q 104 109 100 110 Q 96 109 92 100 Z" fill="#e89116" stroke="#c9821a" strokeWidth="1.1" strokeOpacity="0.5" />
          <path d="M95 92 Q 100 89 105 92" fill="none" stroke="#fff1c9" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
          <g fill="#a9670c" opacity="0.6">
            <circle cx="96" cy="90.5" r="1" />
            <circle cx="104" cy="90.5" r="1" />
          </g>
        </g>
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
   装扮覆盖层（三种体型共用同一套面部 / 颈部锚点）
   ============================================================ */

/** 英雄披风：画在身体之后，只从两侧与下摆露出 */
function CapeHero() {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--back">
      <path
        d="M73 116 C 45 124 34 152 39 184 L 161 184 C 166 152 155 124 127 116 C 116 111 84 111 73 116 Z"
        fill="url(#lw-pet-cape)"
        stroke="#7e211e"
        strokeWidth="1.6"
        strokeOpacity="0.5"
      />
      <path d="M40 177 L 160 177 L 158 184 L 42 184 Z" fill="#8e2621" opacity="0.6" />
      <path d="M73 116 C 84 111 116 111 127 116" fill="none" stroke="#ffb27a" strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />
      <circle cx="76" cy="117" r="4.2" fill="#f5c542" stroke="#b98210" strokeWidth="1.2" />
      <circle cx="124" cy="117" r="4.2" fill="#f5c542" stroke="#b98210" strokeWidth="1.2" />
    </g>
  )
}

/** 英雄披风：正面肩甲与星形搭扣（与背后披风同组渲染） */
function CapeHeroFront() {
  return (
    <g className="gh-pet-outfit">
      <path
        d="M78 134 C 86 130 114 130 122 134 C 126 137 127 141 126 145 C 115 141 108 142 100 147 C 92 142 85 141 74 145 C 73 141 74 137 78 134 Z"
        fill="url(#lw-pet-cape)"
        stroke="#7e211e"
        strokeWidth="1.5"
        strokeOpacity="0.5"
      />
      <circle cx="100" cy="140" r="4.8" fill="#f5c542" stroke="#b98210" strokeWidth="1.2" />
      <path
        d="M100 137 l1 2.2 2.4 .3 -1.8 1.7 .4 2.4 -2 -1.1 -2 1.1 .4 -2.4 -1.8 -1.7 2.4 -.3 Z"
        fill="#fff3c4"
        opacity="0.95"
      />
    </g>
  )
}

/** 蓝色针织围巾：围带 + 罗纹 + 垂下的尾端与流苏 */
function ScarfBlue() {
  return (
    <g className="gh-pet-outfit">
      <path
        d="M64 123 C 80 136 120 136 136 123 L 139 141 C 122 154 78 154 61 141 Z"
        fill="url(#lw-pet-scarf)"
        stroke="#245fae"
        strokeWidth="1.5"
        strokeOpacity="0.45"
      />
      <path d="M64 123 C 80 136 120 136 136 123 L 137 130 C 120 143 80 143 63 130 Z" fill="#ffffff" opacity="0.14" />
      <g stroke="#2c74d4" strokeWidth="2" strokeLinecap="round" opacity="0.6">
        <path d="M72 130 v 15" />
        <path d="M83 134 v 15" />
        <path d="M94 136 v 15" />
        <path d="M106 136 v 15" />
        <path d="M117 134 v 15" />
        <path d="M128 130 v 15" />
      </g>
      <path
        d="M120 142 C 129 149 135 160 134 173 L 121 167 C 122 157 119 148 114 143 Z"
        fill="#2f7ce0"
        stroke="#245fae"
        strokeWidth="1.4"
        strokeOpacity="0.45"
      />
      <path d="M123 146 C 129 153 132 161 132 168" fill="none" stroke="#77bcff" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <g stroke="#1f5cba" strokeWidth="1.6" strokeLinecap="round" opacity="0.7">
        <path d="M122 169 v 5" />
        <path d="M126 170 v 5" />
        <path d="M130 171 v 5" />
        <path d="M134 171 v 4" />
      </g>
    </g>
  )
}

/** 红色蝴蝶结：缎面双翼 + 中心结 + 高光 */
function Bowtie() {
  return (
    <g className="gh-pet-outfit">
      <path
        d="M98 136 C 88 128 78 123 72 122 C 69 121 67 123 68 127 L 71 143 C 72 146 74 148 77 146 C 84 143 92 139 98 136 Z"
        fill="url(#lw-pet-bowtie)"
        stroke="#96262a"
        strokeWidth="1.4"
        strokeOpacity="0.45"
      />
      <path
        d="M102 136 C 112 128 122 123 128 122 C 131 121 133 123 132 127 L 129 143 C 128 146 126 148 123 146 C 116 143 108 139 102 136 Z"
        fill="url(#lw-pet-bowtie)"
        stroke="#96262a"
        strokeWidth="1.4"
        strokeOpacity="0.45"
      />
      <path d="M76 128 C 82 132 88 134 94 137" fill="none" stroke="#ffb1a9" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
      <path d="M124 128 C 118 132 112 134 106 137" fill="none" stroke="#ffb1a9" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
      <rect x="94" y="128" width="12" height="17" rx="5" fill="#b93a34" stroke="#96262a" strokeWidth="1.3" strokeOpacity="0.5" />
      <rect x="96.5" y="130.5" width="3.4" height="10" rx="1.7" fill="#ffffff" opacity="0.35" />
    </g>
  )
}

/** 红色针织小帽：帽筒 + 折边 + 手工绒球 */
function HatRed() {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--hat">
      <path
        d="M76 48 C 76 26 124 26 124 48 Z"
        fill="url(#lw-pet-hat-red)"
        stroke="#8e2a26"
        strokeWidth="1.5"
        strokeOpacity="0.45"
      />
      <path d="M82 33 Q 90 27 100 26 Q 110 27 118 33" fill="none" stroke="#ff9e93" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      <rect x="66" y="43" width="68" height="13" rx="6.5" fill="#c93c37" stroke="#8e2a26" strokeWidth="1.5" strokeOpacity="0.45" />
      <g stroke="#a92f2a" strokeWidth="2" strokeLinecap="round" opacity="0.7">
        <path d="M80 46 v 7" />
        <path d="M100 46 v 7" />
        <path d="M120 46 v 7" />
      </g>
      <circle cx="100" cy="24" r="9.5" fill="url(#lw-pet-pom)" stroke="#a98b62" strokeWidth="1.2" strokeOpacity="0.45" />
      <path d="M95 20 Q 98 17 102 18" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </g>
  )
}

/** 黄金皇冠：五尖 + 宝珠 + 底带宝石 */
function CrownGold() {
  return (
    <g className="gh-pet-outfit gh-pet-outfit--hat">
      <path
        d="M66 46 L66 24 L82 37 L100 15 L118 37 L134 24 L134 46 Z"
        fill="url(#lw-pet-crown)"
        stroke="#a97813"
        strokeWidth="1.6"
        strokeOpacity="0.5"
        strokeLinejoin="round"
      />
      <path d="M66 41 H 134 V 50 H 66 Z" fill="url(#lw-pet-crown-band)" stroke="#a97813" strokeWidth="1.4" strokeOpacity="0.45" />
      <path d="M73 31 L 79 37" fill="none" stroke="#fff8d0" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M127 31 L 121 37" fill="none" stroke="#fff8d0" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <g fill="#fff3c4" stroke="#d9a92c" strokeWidth="1.2">
        <circle cx="66" cy="24" r="3.6" />
        <circle cx="100" cy="15" r="3.8" />
        <circle cx="134" cy="24" r="3.6" />
      </g>
      <circle cx="100" cy="45.5" r="5.6" fill="#e5534b" stroke="#c93c37" strokeWidth="1.5" />
      <circle cx="98.2" cy="43.6" r="1.7" fill="#ffffff" opacity="0.85" />
      <circle cx="81" cy="46" r="3.4" fill="#5eb0ef" stroke="#3f8bd1" strokeWidth="1.1" />
      <circle cx="80.2" cy="45" r="1.1" fill="#ffffff" opacity="0.85" />
      <circle cx="119" cy="46" r="3.4" fill="#5eb0ef" stroke="#3f8bd1" strokeWidth="1.1" />
      <circle cx="118.2" cy="45" r="1.1" fill="#ffffff" opacity="0.85" />
    </g>
  )
}

/** 圆框眼镜：金属细框 + 镜片反光 */
function GlassesRound() {
  return (
    <g className="gh-pet-outfit">
      <g fill="url(#lw-pet-glasses-lens)" stroke="#4b3a33" strokeWidth="3.2">
        <circle cx="80" cy="81" r="16" />
        <circle cx="120" cy="81" r="16" />
      </g>
      <path d="M96 81 h8" fill="none" stroke="#4b3a33" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M64 78 L 49 72" fill="none" stroke="#4b3a33" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M136 78 L 151 72" fill="none" stroke="#4b3a33" strokeWidth="3.2" strokeLinecap="round" />
      <g fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="2.6" strokeLinecap="round">
        <path d="M73 75 L 82 84.5" />
        <path d="M77 72.5 L 85.5 81" />
        <path d="M113 75 L 122 84.5" />
        <path d="M117 72.5 L 125.5 81" />
      </g>
    </g>
  )
}

/** 墨镜：宽幅深色镜片 + 斜向反光 */
function Sunglasses() {
  return (
    <g className="gh-pet-outfit">
      <rect x="63" y="68" width="34" height="24" rx="10" fill="url(#lw-pet-sun-lens)" stroke="#22242e" strokeWidth="1.6" />
      <rect x="103" y="68" width="34" height="24" rx="10" fill="url(#lw-pet-sun-lens)" stroke="#22242e" strokeWidth="1.6" />
      <path d="M97 77 h6" fill="none" stroke="#22242e" strokeWidth="4" strokeLinecap="round" />
      <path d="M63 74 L 48 68" fill="none" stroke="#22242e" strokeWidth="4" strokeLinecap="round" />
      <path d="M137 74 L 152 68" fill="none" stroke="#22242e" strokeWidth="4" strokeLinecap="round" />
      <path d="M70 73 L 81 83" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="3" strokeLinecap="round" />
      <path d="M110 73 L 121 83" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="3" strokeLinecap="round" />
      <path d="M69 90 Q 80 94 95 89" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2" strokeLinecap="round" />
      <path d="M109 90 Q 120 94 135 89" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

/** 帽子槽位：key → SVG 组（未知 key 不渲染） */
const HAT_OUTFITS: Record<string, () => ReactNode> = {
  hat_red: HatRed,
  crown_gold: CrownGold,
}

/** 颈部槽位（cape_hero 背后披风 + 正面肩甲分两层画） */
const NECK_FRONT_OUTFITS: Record<string, () => ReactNode> = {
  scarf_blue: ScarfBlue,
  bowtie: Bowtie,
  cape_hero: CapeHeroFront,
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

  // 披风画在身体之后，其余装扮画在身体之前
  const cape = neck === 'cape_hero' ? <CapeHero /> : null
  const neckFront = (neck && NECK_FRONT_OUTFITS[neck]?.()) ?? null
  const hatNode = (hat && HAT_OUTFITS[hat]?.()) ?? null
  const faceNode = (face && FACE_OUTFITS[face]?.()) ?? null

  const classes = [
    'gh-pet-sprite',
    `gh-pet-anim-${safeAction}`,
    sad ? 'gh-pet-sprite--sad' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} style={{ width: size, height: size }} data-species={species}>
      <svg viewBox="0 0 200 200" role="img" aria-label={SPECIES_LABELS[species]}>
        <PetDefs />
        {/* 地面投影（柔和淡影） */}
        <ellipse cx="100" cy="188" rx="46" ry="8" fill="url(#lw-pet-shadow)" />
        {cape}
        <Body />
        {neckFront}
        {hatNode}
        {faceNode}
        {sad && <PetSweat />}
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
      {/* 新增动作特效 */}
      <span className="gh-pet-fx gh-pet-fx-zzz gh-pet-fx-zzz--a" aria-hidden>💤</span>
      <span className="gh-pet-fx gh-pet-fx-zzz gh-pet-fx-zzz--b" aria-hidden>💤</span>
      <span className="gh-pet-fx gh-pet-fx-hand" aria-hidden>✋</span>
      <span className="gh-pet-fx gh-pet-fx-dust gh-pet-fx-dust--a" aria-hidden />
      <span className="gh-pet-fx gh-pet-fx-dust gh-pet-fx-dust--b" aria-hidden />
      <span className="gh-pet-fx gh-pet-fx-dust gh-pet-fx-dust--c" aria-hidden />
      <span className="gh-pet-fx gh-pet-fx-dizzy gh-pet-fx-dizzy--a" aria-hidden>💫</span>
      <span className="gh-pet-fx gh-pet-fx-dizzy gh-pet-fx-dizzy--b" aria-hidden>💫</span>
      <span className="gh-pet-fx gh-pet-fx-confetti gh-pet-fx-confetti--1" aria-hidden />
      <span className="gh-pet-fx gh-pet-fx-confetti gh-pet-fx-confetti--2" aria-hidden />
      <span className="gh-pet-fx gh-pet-fx-confetti gh-pet-fx-confetti--3" aria-hidden />
      <span className="gh-pet-fx gh-pet-fx-confetti gh-pet-fx-confetti--4" aria-hidden />
      <span className="gh-pet-fx gh-pet-fx-confetti gh-pet-fx-confetti--5" aria-hidden />
      <span className="gh-pet-glow" aria-hidden />
    </div>
  )
}

import type { ReactNode } from 'react'
import type { PetEquipped, PetSpecies } from '../../types/pet'

/**
 * 2D 宠物立绘（纯 inline SVG，无外部图片资源）—— 圆润毛绒贴纸风。
 *
 * - 三种体型：橘猫 tabby（梨形身 + 环纹大弯尾）/ 小狗（奶咖垂耳 + 蓬松摇尾 + 小舌头）/ 小鸟（天蓝蛋形 + 双层羽翅）；
 * - 质感全靠 <defs> 渐变（`lw-pet-*` 前缀 id）+ 毛绒小锯齿 + 多层高光塑形，无硬外描边（仅眼鼻喙留深色细节线）；
 * - 装扮覆盖层按 equipped 的 key 渲染（未知 key 静默跳过，等服务端下发新装扮时前端不崩）；
 * - 动画全部由 pet.css 的 keyframes 驱动：容器类 `gh-pet-anim-{action}` 控制整体动作，
 *   SVG 内部件类（眨眼 / 尾巴 / 翅膀 / 猫耳抽动 / 狗吐舌）做 idle 循环；
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
   渐变定义（同一页面多实例重复定义相同 id 是安全的）
   ============================================================ */

function PetDefs() {
  return (
    <defs>
      {/* 地面投影 / 腮红（软边径向） */}
      <radialGradient id="lw-pet-shadow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#5a3e22" stopOpacity="0.26" />
        <stop offset="0.65" stopColor="#5a3e22" stopOpacity="0.13" />
        <stop offset="1" stopColor="#5a3e22" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="lw-pet-blush" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#f08fa2" stopOpacity="0.85" />
        <stop offset="0.6" stopColor="#f2a0b0" stopOpacity="0.5" />
        <stop offset="1" stopColor="#f2a0b0" stopOpacity="0" />
      </radialGradient>
      {/* 眼睛：上深下浅渐变瞳 */}
      <linearGradient id="lw-pet-eye" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2f2a36" />
        <stop offset="1" stopColor="#7a677f" />
      </linearGradient>
      {/* 小猫：身体 / 肚皮 / 耳内粉 / 鼻 */}
      <radialGradient id="lw-pet-cat-body" cx="0.42" cy="0.3" r="0.95">
        <stop offset="0" stopColor="#fadd9e" />
        <stop offset="0.55" stopColor="#f2c278" />
        <stop offset="1" stopColor="#e8a857" />
      </radialGradient>
      <linearGradient id="lw-pet-cat-belly" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fef6e0" />
        <stop offset="1" stopColor="#f6e2b8" />
      </linearGradient>
      <radialGradient id="lw-pet-ear-pink" cx="0.5" cy="0.45" r="0.65">
        <stop offset="0" stopColor="#f9c6d2" />
        <stop offset="1" stopColor="#ee9aac" />
      </radialGradient>
      <radialGradient id="lw-pet-nose" cx="0.5" cy="0.35" r="0.75">
        <stop offset="0" stopColor="#f8aec0" />
        <stop offset="1" stopColor="#e87e99" />
      </radialGradient>
      {/* 小狗：身体 / 肚皮 / 垂耳（外深内浅，左右各一份保证外侧深色） / 舌头 */}
      <radialGradient id="lw-pet-dog-body" cx="0.42" cy="0.3" r="0.95">
        <stop offset="0" stopColor="#f2dfbe" />
        <stop offset="1" stopColor="#d9ae79" />
      </radialGradient>
      <linearGradient id="lw-pet-dog-belly" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fdf7ea" />
        <stop offset="1" stopColor="#f3e3c5" />
      </linearGradient>
      <linearGradient id="lw-pet-dog-ear-l" x1="0" y1="0" x2="1" y2="0.35">
        <stop offset="0" stopColor="#b98a5e" />
        <stop offset="1" stopColor="#c89a6b" />
      </linearGradient>
      <linearGradient id="lw-pet-dog-ear-r" x1="0" y1="0" x2="1" y2="0.35">
        <stop offset="0" stopColor="#c89a6b" />
        <stop offset="1" stopColor="#b98a5e" />
      </linearGradient>
      <linearGradient id="lw-pet-tongue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f7a9bb" />
        <stop offset="1" stopColor="#e96e8c" />
      </linearGradient>
      {/* 小鸟：蛋形身 / 肚白 */}
      <linearGradient id="lw-pet-bird-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#9cd1f2" />
        <stop offset="1" stopColor="#6fb4e3" />
      </linearGradient>
      <linearGradient id="lw-pet-bird-belly" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#eff9ff" />
        <stop offset="1" stopColor="#c9e7fa" />
      </linearGradient>
      {/* 装扮：毛线帽 / 绒球 / 皇冠 / 领结 / 披风 / 墨镜镜片 */}
      <linearGradient id="lw-pet-hat-red" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f0655c" />
        <stop offset="1" stopColor="#ce3f38" />
      </linearGradient>
      <radialGradient id="lw-pet-pom" cx="0.38" cy="0.32" r="0.8">
        <stop offset="0" stopColor="#fffdf6" />
        <stop offset="1" stopColor="#ebddbc" />
      </radialGradient>
      <linearGradient id="lw-pet-crown" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f8d56b" />
        <stop offset="1" stopColor="#dfa928" />
      </linearGradient>
      <linearGradient id="lw-pet-bowtie" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e5534b" />
        <stop offset="1" stopColor="#c93c37" />
      </linearGradient>
      <linearGradient id="lw-pet-cape" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e0524a" />
        <stop offset="1" stopColor="#b9332e" />
      </linearGradient>
      <linearGradient id="lw-pet-sun-lens" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5a5a68" />
        <stop offset="1" stopColor="#20202a" />
      </linearGradient>
    </defs>
  )
}

/* ============================================================
   共用部件：大眼睛（渐变瞳 + 双层高光 + 眼睑线） / 腮红
   ============================================================ */

function PetEyes({ cy }: { cy: number }) {
  return (
    <g className="gh-pet-eyes">
      {[84, 116].map((cx) => (
        <g key={cx} className="gh-pet-eye">
          <ellipse cx={cx} cy={cy} rx="12.5" ry="14" fill="url(#lw-pet-eye)" />
          {/* 主高光（左上大圆）+ 次高光（右下小点） */}
          <circle cx={cx - 4.2} cy={cy - 5.2} r="4.4" fill="#ffffff" />
          <circle cx={cx + 4.4} cy={cy + 5.6} r="1.9" fill="#ffffff" opacity="0.85" />
          {/* 顶部细弧眼睑线 */}
          <path
            d={`M ${cx - 11} ${cy - 11} Q ${cx} ${cy - 18.5} ${cx + 11} ${cy - 11}`}
            fill="none" stroke="#4b4148" strokeWidth="2" strokeLinecap="round" opacity="0.5"
          />
        </g>
      ))}
    </g>
  )
}

function PetBlush({ cy }: { cy: number }) {
  return (
    <g>
      <ellipse cx="63" cy={cy} rx="11" ry="6.5" fill="url(#lw-pet-blush)" />
      <ellipse cx="137" cy={cy} rx="11" ry="6.5" fill="url(#lw-pet-blush)" />
    </g>
  )
}

/* ============================================================
   三种体型（尾巴 / 耳朵 / 头部分组类名供 CSS 做循环动画；
   毛绒小锯齿用同色系小弧片拼在轮廓边缘）
   ============================================================ */

function CatBody() {
  return (
    <g>
      {/* 上翘环纹大弯尾：底色 + 深色环纹（虚线段）+ 蓬松圆尾尖 */}
      <g className="gh-pet-tail gh-pet-tail--cat">
        <path d="M146 150 C 176 144, 188 112, 168 90" fill="none" stroke="#f2c278" strokeWidth="16" strokeLinecap="round" />
        <path d="M146 150 C 176 144, 188 112, 168 90" fill="none" stroke="#c98a45" strokeWidth="16" strokeLinecap="butt" strokeDasharray="7 14" strokeDashoffset="-4" opacity="0.85" />
        <circle cx="168" cy="90" r="9.5" fill="#f9dca0" />
        <path d="M176 83 C 181 80, 185 75, 186 69 C 181 73, 177 78, 174 81 Z" fill="#f2c278" />
      </g>
      {/* 坐姿梨形身 + 侧面条纹理 */}
      <path d="M78 118 C 58 128, 48 150, 50 162 C 52 178, 74 182, 100 182 C 126 182, 148 178, 150 162 C 152 150, 142 128, 122 118 C 112 113, 88 113, 78 118 Z" fill="url(#lw-pet-cat-body)" />
      <g fill="none" stroke="#de9e56" strokeWidth="5" strokeLinecap="round" opacity="0.8">
        <path d="M59 140 C 52 148, 51 158, 55 166" />
        <path d="M72 146 C 68 152, 67 160, 70 166" />
        <path d="M141 140 C 148 148, 149 158, 145 166" />
        <path d="M128 146 C 132 152, 133 160, 130 166" />
      </g>
      {/* 胸口奶白毛绒（圆片叠出锯齿边） */}
      <g fill="url(#lw-pet-cat-belly)">
        <ellipse cx="100" cy="155" rx="29" ry="21" />
        <circle cx="88" cy="137" r="5.5" />
        <circle cx="112" cy="137" r="5.5" />
        <circle cx="71" cy="152" r="6" />
        <circle cx="129" cy="149" r="6" />
        <circle cx="76" cy="165" r="7" />
        <circle cx="89" cy="172" r="7.5" />
        <circle cx="104" cy="174" r="7.5" />
        <circle cx="119" cy="170" r="7" />
        <circle cx="129" cy="161" r="6" />
      </g>
      {/* 圆角三角耳（轮廓干净，内耳粉渐变；蓬松感交给脸颊毛刺与胸口毛绒） */}
      <g className="gh-pet-ear gh-pet-ear--l gh-pet-ear--cat">
        <path d="M73 68 C 60 58, 52 42, 54 24 C 55 18, 61 17, 65 23 C 77 36, 90 45, 99 48 C 90 55, 80 62, 73 68 Z" fill="url(#lw-pet-cat-body)" />
        <path d="M72 59 C 65 51, 61 40, 62 30 C 70 38, 81 45, 91 49 C 84 52, 77 55, 72 59 Z" fill="url(#lw-pet-ear-pink)" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r gh-pet-ear--cat">
        <path d="M127 68 C 140 58, 148 42, 146 24 C 145 18, 139 17, 135 23 C 123 36, 110 45, 101 48 C 110 55, 120 62, 127 68 Z" fill="url(#lw-pet-cat-body)" />
        <path d="M128 59 C 135 51, 139 40, 138 30 C 130 38, 119 45, 109 49 C 116 52, 123 55, 128 59 Z" fill="url(#lw-pet-ear-pink)" />
      </g>
      <g className="gh-pet-head">
        <circle cx="100" cy="80" r="45" fill="url(#lw-pet-cat-body)" />
        {/* 发际线两道短条纹（圆头、贴发际线，避免读成竖起的毛簇/天线） */}
        <g fill="none" stroke="#de9e56" strokeWidth="4.5" strokeLinecap="round" opacity="0.85">
          <path d="M90 46.5 c 1.5 3.5, 1.5 6, -1 8.5" />
          <path d="M110 46.5 c -1.5 3.5, -1.5 6, 1 8.5" />
        </g>
        <PetEyes cy={79} />
        <PetBlush cy={96} />
        {/* 脸颊毛绒小刺 */}
        <g fill="#e9ac60">
          <path d="M60 88 C 54 87, 49 89, 46 93 C 51 94, 56 93, 60 91 Z" />
          <path d="M62 99 C 56 99, 51 101, 48 105 C 53 105.5, 59 104, 62 101.5 Z" />
          <path d="M140 88 C 146 87, 151 89, 154 93 C 149 94, 144 93, 140 91 Z" />
          <path d="M138 99 C 144 99, 149 101, 152 105 C 147 105.5, 141 104, 138 101.5 Z" />
        </g>
        {/* 微弯胡须（细、低透明度） */}
        <g fill="none" stroke="#c9a06a" strokeWidth="1.8" strokeLinecap="round" opacity="0.7">
          <path d="M64 84 C 54 82, 44 80, 35 79" />
          <path d="M63 91 C 53 91, 43 92, 34 94" />
          <path d="M64 98 C 55 100, 46 104, 38 109" />
          <path d="M136 84 C 146 82, 156 80, 165 79" />
          <path d="M137 91 C 147 91, 157 92, 166 94" />
          <path d="M136 98 C 145 100, 154 104, 162 109" />
        </g>
        {/* 粉渐变鼻 + 饱满 ω 嘴 */}
        <path d="M94 91.5 h 12 q 2.4 0 1.2 2.2 l -5.2 6.2 q -2 2.3 -4 0 l -5.2 -6.2 q -1.2 -2.2 1.2 -2.2 Z" fill="url(#lw-pet-nose)" />
        <ellipse cx="97" cy="94" rx="1.8" ry="1.2" fill="#fcd7e0" opacity="0.9" />
        <path d="M100 101.5 v 2" fill="none" stroke="#8a6440" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M100 103.5 q -5.5 7.5 -11 1.5 M 100 103.5 q 5.5 7.5 11 1.5" fill="none" stroke="#8a6440" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </g>
  )
}

function DogBody() {
  return (
    <g>
      {/* 蓬松摇尾（尾根下移到身侧后方，最高点明显低于头顶，避免读成第三只耳朵） */}
      <g className="gh-pet-tail gh-pet-tail--dog">
        <path d="M146 154 C 170 150, 180 138, 172 122" fill="none" stroke="#e8c9a0" strokeWidth="19" strokeLinecap="round" />
        <circle cx="172" cy="122" r="10.5" fill="#fbf2e2" />
        <path d="M180 116 C 185 112, 188 107, 189 101 C 184 105, 180 110, 178 114 Z" fill="#e8c9a0" />
      </g>
      {/* 坐姿身 + 侧腹斑块 + 胸口毛绒肚皮 */}
      <path d="M76 118 C 56 128, 46 150, 48 162 C 50 178, 73 182, 100 182 C 127 182, 150 178, 152 162 C 154 150, 144 128, 124 118 C 113 113, 87 113, 76 118 Z" fill="url(#lw-pet-dog-body)" />
      <ellipse cx="64" cy="143" rx="12" ry="17" fill="#dbb98a" opacity="0.9" transform="rotate(-14 64 143)" />
      <g fill="url(#lw-pet-dog-belly)">
        <ellipse cx="100" cy="156" rx="30" ry="21" />
        <circle cx="86" cy="138" r="5.5" />
        <circle cx="114" cy="138" r="5.5" />
        <circle cx="74" cy="165" r="7" />
        <circle cx="88" cy="172" r="7.5" />
        <circle cx="104" cy="174" r="7.5" />
        <circle cx="120" cy="169" r="7" />
        <circle cx="130" cy="160" r="6" />
      </g>
      {/* 垂耳（画在头后面，线性渐变外深内浅 + 耳尖毛分叉） */}
      <g className="gh-pet-ear gh-pet-ear--l gh-pet-ear--dog">
        <path d="M80 42 C 58 40, 40 56, 36 82 C 33 100, 42 113, 55 113 C 63 113, 68 105, 69 94 C 71 76, 74 58, 82 48 Z" fill="url(#lw-pet-dog-ear-l)" />
        <path d="M44 110 C 40 114, 38 119, 38 125 C 43 121, 47 116, 50 111 Z" fill="#c09265" />
        <path d="M54 114 C 52 119, 51 124, 52 129 C 56 125, 58 119, 58 115 Z" fill="#c09265" />
      </g>
      <g className="gh-pet-ear gh-pet-ear--r gh-pet-ear--dog">
        <path d="M120 42 C 142 40, 160 56, 164 82 C 167 100, 158 113, 145 113 C 137 113, 132 105, 131 94 C 129 76, 126 58, 118 48 Z" fill="url(#lw-pet-dog-ear-r)" />
        <path d="M156 110 C 160 114, 162 119, 162 125 C 157 121, 153 116, 150 111 Z" fill="#c09265" />
        <path d="M146 114 C 148 119, 149 124, 148 129 C 144 125, 142 119, 142 115 Z" fill="#c09265" />
      </g>
      <g className="gh-pet-head">
        <circle cx="100" cy="80" r="45" fill="url(#lw-pet-dog-body)" />
        {/* 头顶斑块 + 眉点 */}
        <path d="M85 40 C 95 35, 110 37, 117 48 C 107 55, 92 54, 85 40 Z" fill="#dbb98a" opacity="0.85" />
        <ellipse cx="83" cy="64" rx="4.2" ry="2.6" fill="#a67846" transform="rotate(-12 83 64)" />
        <ellipse cx="117" cy="64" rx="4.2" ry="2.6" fill="#a67846" transform="rotate(12 117 64)" />
        <PetEyes cy={79} />
        {/* 奶白吻部 + 黑鼻（大高光）+ Y 形嘴线 */}
        <ellipse cx="100" cy="101" rx="24" ry="17" fill="url(#lw-pet-dog-belly)" />
        <ellipse cx="100" cy="93" rx="7.5" ry="5.8" fill="#3b3630" />
        <ellipse cx="97.6" cy="91" rx="2.6" ry="1.6" fill="#ffffff" opacity="0.75" transform="rotate(-18 97.6 91)" />
        <path d="M100 98.8 V 104" fill="none" stroke="#8a6b45" strokeWidth="2.3" strokeLinecap="round" />
        <path d="M100 104 Q 95 109 89.5 107 M 100 104 Q 105 109 110.5 107" fill="none" stroke="#8a6b45" strokeWidth="2.3" strokeLinecap="round" />
        {/* 小舌头（play/happy 时由 CSS 显示并摆动） */}
        <g className="gh-pet-tongue">
          <path d="M95.5 106.5 C 94.5 117, 105.5 117, 104.5 106.5 Q 100 109 95.5 106.5 Z" fill="url(#lw-pet-tongue)" />
          <path d="M100 108.5 V 113" fill="none" stroke="#d95f7e" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
        </g>
        <PetBlush cy={94} />
      </g>
    </g>
  )
}

function BirdBody() {
  return (
    <g>
      {/* 橙脚 + 爪趾分叉 */}
      <g fill="none" stroke="#e8a13f" strokeWidth="4.2" strokeLinecap="round">
        <path d="M89 170 V 186" />
        <path d="M111 170 V 186" />
        <path d="M89 186 L 82 191 M 89 186 V 192 M 89 186 L 96 191" />
        <path d="M111 186 L 104 191 M 111 186 V 192 M 111 186 L 118 191" />
      </g>
      {/* 呆毛：三根圆头羽毛 + 尖部深青短段 */}
      <g className="gh-pet-tuft" fill="none" strokeLinecap="round">
        <g stroke="#7fb9e0" strokeWidth="5">
          <path d="M92 76 C 88 68, 84 62, 79 54" />
          <path d="M100 73 V 48" />
          <path d="M108 76 C 112 68, 116 62, 121 54" />
        </g>
        <g stroke="#4e93c4" strokeWidth="5">
          <path d="M84.5 60.5 L 79.5 54.5" />
          <path d="M100 56 V 48.5" />
          <path d="M115.5 60.5 L 120.5 54.5" />
        </g>
      </g>
      {/* 翅膀：主羽 + 覆羽两层（偶尔扇动） */}
      <g className="gh-pet-wing gh-pet-wing--l">
        <path d="M62 104 C 44 110, 35 132, 43 152 C 55 144, 63 126, 65 107 Z" fill="#7fb9e0" />
        <path d="M61 107 C 52 111, 45 122, 44.5 136 C 52 128, 58 118, 62 108 Z" fill="#a9d7f5" />
      </g>
      <g className="gh-pet-wing gh-pet-wing--r">
        <path d="M138 104 C 156 110, 165 132, 157 152 C 145 144, 137 126, 135 107 Z" fill="#7fb9e0" />
        <path d="M139 107 C 148 111, 155 122, 155.5 136 C 148 128, 142 118, 138 108 Z" fill="#a9d7f5" />
      </g>
      {/* 小尾羽（身体后方，右下探出） */}
      <g>
        <path d="M112 160 C 126 160, 137 166, 143 175 C 132 176, 120 172, 112 165 Z" fill="#5fa0d6" />
        <path d="M114 168 C 126 170, 134 176, 138 184 C 128 183, 118 178, 113 172 Z" fill="#79bce6" />
      </g>
      {/* 蛋形身体（含头）+ 浅色肚皮 */}
      <g className="gh-pet-head">
        <ellipse cx="100" cy="126" rx="46" ry="55" fill="url(#lw-pet-bird-body)" />
        <ellipse cx="100" cy="146" rx="29" ry="31" fill="url(#lw-pet-bird-belly)" />
        <PetEyes cy={104} />
        <PetBlush cy={121} />
        {/* 双层喙 + 高光小弧 */}
        <path d="M90 112 L 110 112 L 100 124.5 Z" fill="#f5a623" />
        <path d="M94.5 121 L 105.5 121 L 100 128 Z" fill="#e08e12" />
        <path d="M94.5 114.5 Q 97.5 116.5 100.5 115.8" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
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

function CapeHero({ bird = false }: { bird?: boolean }) {
  // 小鸟蛋形身覆盖面大，披风上沿压低 + 宽度收窄，只从身后露出下摆两侧，
  // 避免包住下半身像坐在桶里；猫/狗保持原披风轮廓
  return bird ? (
    <g className="gh-pet-outfit">
      <path d="M74 120 C 42 132, 36 170, 54 183 L 146 183 C 164 170, 158 132, 126 120 C 112 113, 88 113, 74 120 Z" fill="url(#lw-pet-cape)" />
      <path d="M78 122 C 90 130, 110 130, 122 122" fill="none" stroke="#b9332e" strokeWidth="5" strokeLinecap="round" />
      {/* 领口金色圆搭扣 */}
      <circle cx="83" cy="126" r="4.2" fill="#f5c542" stroke="#d4a017" strokeWidth="1.4" />
      <circle cx="117" cy="126" r="4.2" fill="#f5c542" stroke="#d4a017" strokeWidth="1.4" />
    </g>
  ) : (
    <g className="gh-pet-outfit">
      <path d="M62 104 C 24 128, 28 174, 50 183 L 150 183 C 172 174, 176 128, 138 104 C 124 95, 76 95, 62 104 Z" fill="url(#lw-pet-cape)" />
      <path d="M66 106 C 80 116, 120 116, 134 106" fill="none" stroke="#b9332e" strokeWidth="5" strokeLinecap="round" />
      <circle cx="74" cy="110" r="4.2" fill="#f5c542" stroke="#d4a017" strokeWidth="1.4" />
      <circle cx="126" cy="110" r="4.2" fill="#f5c542" stroke="#d4a017" strokeWidth="1.4" />
    </g>
  )
}

function ScarfBlue() {
  return (
    <g className="gh-pet-outfit">
      {/* 围带（下缘轻微投影）+ 罗纹竖线针织纹理 */}
      <path d="M63 113 Q 100 131 137 113 L 137 133 Q 100 151 63 133 Z" fill="#2f81f7" />
      <path d="M63 133 Q 100 151 137 133 L 137 137 Q 100 155 63 137 Z" fill="#1a5fc8" opacity="0.6" />
      <g stroke="#1f6feb" strokeWidth="2" strokeLinecap="round" opacity="0.7">
        <path d="M72 119 L 72 137" />
        <path d="M83 123 L 83 141" />
        <path d="M94 125 L 94 143" />
        <path d="M105 125 L 105 143" />
        <path d="M116 123 L 116 141" />
        <path d="M127 119 L 127 137" />
      </g>
      {/* 尾端两层布片 */}
      <path d="M116 130 L 138 160 L 114 156 Z" fill="#2f81f7" />
      <path d="M112 132 L 128 156 L 106 150 Z" fill="#1f6feb" />
    </g>
  )
}

function Bowtie() {
  return (
    <g className="gh-pet-outfit">
      {/* 缎面渐变蝶翼（圆角外缘）+ 中心结 + 高光小矩形 */}
      <path d="M98 121 C 90 116, 80 111, 74 109 C 71 108, 70 110, 70 113 L 70 129 C 70 132, 71 134, 74 133 C 80 131, 90 126, 98 121 Z" fill="url(#lw-pet-bowtie)" />
      <path d="M102 121 C 110 116, 120 111, 126 109 C 129 108, 130 110, 130 113 L 130 129 C 130 132, 129 134, 126 133 C 120 131, 110 126, 102 121 Z" fill="url(#lw-pet-bowtie)" />
      <rect x="93" y="114" width="14" height="15" rx="4" fill="#b93a34" />
      <rect x="95" y="116.5" width="4" height="10" rx="2" fill="#ffffff" opacity="0.35" />
    </g>
  )
}

function HatRed() {
  return (
    <g className="gh-pet-outfit">
      {/* 帽筒渐变 + 更宽的折边（带竖褶线）+ 带阴影绒球 */}
      <path d="M68 54 C 68 26, 132 26, 132 54 Z" fill="url(#lw-pet-hat-red)" />
      <rect x="62" y="50" width="76" height="11" rx="5.5" fill="#c93c37" />
      <g stroke="#b5332e" strokeWidth="2" strokeLinecap="round" opacity="0.8">
        <path d="M76 52 V 59" />
        <path d="M100 52.5 V 60" />
        <path d="M124 52 V 59" />
      </g>
      <ellipse cx="100" cy="36.5" rx="5" ry="2" fill="#b5332e" opacity="0.5" />
      <circle cx="100" cy="29" r="9" fill="url(#lw-pet-pom)" />
    </g>
  )
}

function CrownGold() {
  return (
    <g className="gh-pet-outfit">
      <path d="M70 54 L 70 26 L 86 41 L 100 18 L 114 41 L 130 26 L 130 54 Z" fill="url(#lw-pet-crown)" />
      {/* 底边阴影线 */}
      <path d="M70 52 H 130" stroke="#c8931f" strokeWidth="2.5" strokeLinecap="round" />
      {/* 三颗宝石 + 高光 */}
      <circle cx="100" cy="45" r="5.5" fill="#e5534b" stroke="#c93c37" strokeWidth="1.5" />
      <circle cx="98.2" cy="43.2" r="1.6" fill="#ffffff" opacity="0.8" />
      <circle cx="81" cy="49" r="3.2" fill="#5eb0ef" />
      <circle cx="80" cy="48" r="1" fill="#ffffff" opacity="0.8" />
      <circle cx="119" cy="49" r="3.2" fill="#5eb0ef" />
      <circle cx="118" cy="48" r="1" fill="#ffffff" opacity="0.8" />
    </g>
  )
}

function GlassesRound() {
  return (
    <g className="gh-pet-outfit" fill="rgba(255, 255, 255, 0.2)" stroke="#4b4353" strokeWidth="4">
      <circle cx="84" cy="79" r="14" />
      <circle cx="116" cy="79" r="14" />
      {/* 镜片内斜向反光 */}
      <g stroke="rgba(255, 255, 255, 0.5)" strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d="M78 74.5 L 86.5 83" />
        <path d="M81.5 72.5 L 90 81" />
        <path d="M110 74.5 L 118.5 83" />
        <path d="M113.5 72.5 L 122 81" />
      </g>
      <path d="M98 79 L 102 79" fill="none" />
      <path d="M70 76 L 55 70" fill="none" strokeLinecap="round" />
      <path d="M130 76 L 145 70" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Sunglasses() {
  return (
    <g className="gh-pet-outfit">
      {/* 镜片垂直渐变（上亮下暗）+ 斜向高光 */}
      <rect x="68" y="69.5" width="30" height="19" rx="8" fill="url(#lw-pet-sun-lens)" />
      <rect x="102" y="69.5" width="30" height="19" rx="8" fill="url(#lw-pet-sun-lens)" />
      <path d="M98 75.5 L 102 75.5" stroke="#2b2b33" strokeWidth="4" />
      <path d="M68 75 L 54 70" stroke="#2b2b33" strokeWidth="4" strokeLinecap="round" />
      <path d="M132 75 L 146 70" stroke="#2b2b33" strokeWidth="4" strokeLinecap="round" />
      <path d="M74 73.5 L 84 82.5" stroke="rgba(255,255,255,0.4)" strokeWidth="3" strokeLinecap="round" />
      <path d="M108 73.5 L 118 82.5" stroke="rgba(255,255,255,0.4)" strokeWidth="3" strokeLinecap="round" />
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

  // 披风画在身体后面，其余装扮画在身体前面（小鸟传 bird 压低披风上沿）
  const cape = neck === 'cape_hero' ? <CapeHero bird={species === 'bird'} /> : null
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
        <PetDefs />
        {/* 地面投影（柔和淡影） */}
        <ellipse cx="100" cy="184" rx="45" ry="8.5" fill="url(#lw-pet-shadow)" />
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

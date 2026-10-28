/**
 * 表情商店素材生成器（原创 SVG）
 *
 * 用法：node client/scripts/generate-sticker-shop.mjs
 * 产物：client/public/stickers/shop/*.svg（360×360，纯矢量、无外部依赖、无版权问题）
 *
 * 说明：商店里的表情由本脚本生成，风格统一（描边 + 柔和底色）。
 * 新增表情时在下面的 PACKS 里加一项后重新运行即可；前端清单见
 * client/src/lib/stickers.ts（id 必须与文件名一致）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/stickers/shop')

const OUT = '#3F342E'
const CREAM = '#FFFDF8'
const CHEEK = '#FFB4A2'

/** 统一画布：柔和圆角底色 + 少量装饰圆点 */
function frame(bg, dot, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360" width="360" height="360">
  <rect width="360" height="360" rx="30" fill="${bg}"/>
  <circle cx="58" cy="62" r="9" fill="${dot}" opacity="0.75"/>
  <circle cx="304" cy="86" r="6" fill="${dot}" opacity="0.6"/>
  <circle cx="292" cy="300" r="10" fill="${dot}" opacity="0.5"/>
  <circle cx="62" cy="296" r="5" fill="${dot}" opacity="0.6"/>
${inner}
</svg>
`
}

/** 团子（白色圆团子）基础身体 */
function dangoBody(arms) {
  return `  <g stroke="${OUT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="180" cy="216" rx="88" ry="82" fill="${CREAM}"/>
    ${arms || ''}
  </g>
  <ellipse cx="142" cy="244" rx="15" ry="9" fill="${CHEEK}" opacity="0.85"/>
  <ellipse cx="218" cy="244" rx="15" ry="9" fill="${CHEEK}" opacity="0.85"/>`
}

const dangoHappyEyes = `  <g fill="${OUT}">
    <circle cx="152" cy="196" r="9"/>
    <circle cx="208" cy="196" r="9"/>
  </g>`

const dangoSmile = `  <path d="M162 224 Q180 240 198 224" fill="none" stroke="${OUT}" stroke-width="7" stroke-linecap="round"/>`

/** 橘猫基础头部 */
function catHead(extra = '', muzzle = true) {
  return `  <g stroke="${OUT}" stroke-width="7" stroke-linejoin="round">
    <path d="M112 150 L102 82 L162 112 Z" fill="#F6A94A"/>
    <path d="M248 150 L258 82 L198 112 Z" fill="#F6A94A"/>
    <circle cx="180" cy="200" r="86" fill="#F8B65B"/>
    <path d="M112 150 L102 82 L162 112 Z" fill="none"/>
    <path d="M248 150 L258 82 L198 112 Z" fill="none"/>
  </g>
  <path d="M126 128 L120 96 L150 112 Z" fill="#F08B7A"/>
  <path d="M234 128 L240 96 L210 112 Z" fill="#F08B7A"/>
  ${muzzle ? `<ellipse cx="180" cy="234" rx="52" ry="34" fill="#FFF6E8"/>` : ''}
  <ellipse cx="134" cy="238" rx="14" ry="8" fill="${CHEEK}" opacity="0.8"/>
  <ellipse cx="226" cy="238" rx="14" ry="8" fill="${CHEEK}" opacity="0.8"/>
  <g stroke="${OUT}" stroke-width="3.5" stroke-linecap="round">
    <path d="M84 210 L118 214"/>
    <path d="M84 232 L118 228"/>
    <path d="M276 210 L242 214"/>
    <path d="M276 232 L242 228"/>
  </g>
${extra}`
}

const catHappyEyes = `  <g fill="${OUT}">
    <circle cx="150" cy="190" r="9"/>
    <circle cx="210" cy="190" r="9"/>
  </g>`

const catNoseMouth = `  <path d="M172 220 L188 220 L180 230 Z" fill="#E8846B"/>
  <path d="M180 230 Q168 242 158 232 M180 230 Q192 242 202 232" fill="none" stroke="${OUT}" stroke-width="5" stroke-linecap="round"/>`

/** 通用符号（手绘风格图标） */
const ICONS = {
  'shop-thumb': `  <g stroke="${OUT}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round">
    <path d="M150 300 L150 176 Q150 156 170 156 L176 156 Q196 156 196 176 L196 206 L256 206 Q276 206 272 226 L258 288 Q254 300 236 300 Z" fill="${CREAM}"/>
    <path d="M150 300 L108 300 L108 196 Q108 184 120 184 L138 184 Q150 184 150 196 Z" fill="#FFD9A8"/>
  </g>`,
  'shop-ok': `  <g stroke="${OUT}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="180" cy="204" r="96" fill="${CREAM}"/>
    <path d="M124 206 L166 250 L246 156" fill="none" stroke-width="16" stroke="#3CA55C"/>
  </g>`,
  'shop-heart': `  <path d="M180 300 C96 244 68 196 92 158 C116 120 164 128 180 164 C196 128 244 120 268 158 C292 196 264 244 180 300 Z" fill="#F77E88" stroke="${OUT}" stroke-width="8" stroke-linejoin="round"/>
  <path d="M132 172 Q124 194 140 210" fill="none" stroke="#FFD3D7" stroke-width="10" stroke-linecap="round"/>`,
  'shop-cheer': `  <g stroke="${OUT}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M118 288 L118 200 Q118 168 150 168 L176 168 Q196 168 196 188 L196 214 L240 214 Q272 214 272 246 L272 288 Z" fill="#FFD9A8"/>
    <path d="M96 236 L62 200 M282 320 L318 320 M62 320 L96 320 M282 236 L316 200" stroke="#F0A24C"/>
    <path d="M150 244 L182 244" stroke="#E08A3C"/>
  </g>`,
}

const PACKS = [
  {
    id: 'dango-hi',
    svg: frame('#FFE6D2', '#FFC7A8', `${dangoBody(`    <path d="M102 222 C76 204 66 176 78 150" fill="none"/>
    <circle cx="82" cy="140" r="17" fill="${CREAM}"/>
    <path d="M258 228 C278 240 286 258 282 272" fill="none"/>`)}
${dangoHappyEyes}
${dangoSmile}
  <path d="M300 84 L306 100 L322 106 L306 112 L300 128 L294 112 L278 106 L294 100 Z" fill="#FFC46B"/>`),
  },
  {
    id: 'dango-laugh',
    svg: frame('#FFF2C9', '#FFD98E', `${dangoBody(`    <path d="M112 250 C126 272 142 278 158 272" fill="none"/>
    <path d="M248 250 C234 272 218 278 202 272" fill="none"/>`)}
  <path d="M136 194 Q152 178 168 194 M192 194 Q208 178 224 194" fill="none" stroke="${OUT}" stroke-width="8" stroke-linecap="round"/>
  <ellipse cx="180" cy="232" rx="20" ry="15" fill="#E86A5A" stroke="${OUT}" stroke-width="6"/>
  <path d="M92 168 Q80 184 88 196 Q100 200 104 186 Q104 174 92 168 Z" fill="#8FC7E8" stroke="${OUT}" stroke-width="4"/>
  <path d="M268 168 Q280 184 272 196 Q260 200 256 186 Q256 174 268 168 Z" fill="#8FC7E8" stroke="${OUT}" stroke-width="4"/>`),
  },
  {
    id: 'dango-shock',
    svg: frame('#DCEEFF', '#A8CDF0', `${dangoBody(`    <path d="M104 232 C82 214 74 190 82 168" fill="none"/>
    <circle cx="86" cy="158" r="16" fill="${CREAM}"/>
    <path d="M256 232 C278 214 286 190 278 168" fill="none"/>
    <circle cx="274" cy="158" r="16" fill="${CREAM}"/>`)}
  <g fill="${CREAM}" stroke="${OUT}" stroke-width="6">
    <circle cx="152" cy="196" r="16"/>
    <circle cx="208" cy="196" r="16"/>
  </g>
  <g fill="${OUT}">
    <circle cx="152" cy="198" r="6"/>
    <circle cx="208" cy="198" r="6"/>
  </g>
  <ellipse cx="180" cy="238" rx="11" ry="14" fill="#E86A5A" stroke="${OUT}" stroke-width="5"/>
  <path d="M284 118 Q300 134 292 152 Q278 154 274 140 Q274 126 284 118 Z" fill="#8FC7E8" stroke="${OUT}" stroke-width="4"/>`),
  },
  {
    id: 'dango-sleep',
    svg: frame('#EDE6FA', '#C9B8EA', `  <rect x="76" y="264" width="208" height="44" rx="22" fill="#FFF6E8" stroke="${OUT}" stroke-width="6"/>
${dangoBody(`    <path d="M120 250 C134 268 150 272 164 266" fill="none"/>`)}
  <path d="M136 196 Q152 206 168 196 M192 196 Q208 206 224 196" fill="none" stroke="${OUT}" stroke-width="8" stroke-linecap="round"/>
  <path d="M170 226 Q180 232 190 226" fill="none" stroke="${OUT}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="236" cy="212" r="10" fill="#CFE8F7" stroke="${OUT}" stroke-width="5"/>
  <path d="M258 176 Q268 160 258 148 M284 168 Q294 152 284 140" fill="none" stroke="${OUT}" stroke-width="6" stroke-linecap="round" opacity="0.5"/>`),
  },
  {
    id: 'cat-like',
    svg: frame('#FFF0D8', '#FFD08E', `${catHead(`  <g stroke="${OUT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M262 268 C296 262 314 232 304 202" fill="none"/>
    <ellipse cx="300" cy="186" rx="32" ry="27" fill="#F8B65B" transform="rotate(18 300 186)"/>
    <ellipse cx="292" cy="172" rx="7" ry="9" fill="#F08B7A" stroke-width="4"/>
    <ellipse cx="310" cy="180" rx="6" ry="8" fill="#F08B7A" stroke-width="4"/>
    <ellipse cx="302" cy="196" rx="11" ry="8" fill="#F08B7A" stroke-width="4"/>
  </g>`)}
${catHappyEyes}
${catNoseMouth}
  <path d="M262 120 L270 138 L288 146 L270 154 L262 172 L254 154 L236 146 L254 138 Z" fill="#FFC46B"/>`),
  },
  {
    id: 'cat-fish',
    svg: frame('#E1F6F4', '#A9E0DA', `${catHead(`
  <g stroke="${OUT}" stroke-width="6" stroke-linejoin="round">
    <ellipse cx="180" cy="270" rx="46" ry="22" fill="#7FC7D9"/>
    <path d="M226 270 L254 252 L254 288 Z" fill="#7FC7D9"/>
    <path d="M126 270 C144 300 216 300 234 270" fill="none" stroke-width="5"/>
  </g>
  <circle cx="196" cy="262" r="4" fill="${OUT}"/>`)}
  <path d="M140 188 Q156 176 172 188 M188 188 Q204 176 220 188" fill="none" stroke="${OUT}" stroke-width="8" stroke-linecap="round"/>
${catNoseMouth}`),
  },
  {
    id: 'cat-angry',
    svg: frame('#FFE0E0', '#F5A3A3', `${catHead()}
  <path d="M136 172 L168 186 M224 172 L192 186" fill="none" stroke="${OUT}" stroke-width="8" stroke-linecap="round"/>
  <g fill="${OUT}">
    <circle cx="152" cy="200" r="8"/>
    <circle cx="208" cy="200" r="8"/>
  </g>
  <path d="M164 240 L180 232 L196 240" fill="none" stroke="${OUT}" stroke-width="6" stroke-linecap="round"/>
  <path d="M96 108 Q78 94 88 76 M264 108 Q282 94 272 76" fill="none" stroke="#E36B6B" stroke-width="7" stroke-linecap="round"/>`),
  },
  {
    id: 'cat-heart',
    svg: frame('#FFE4EF', '#F5A8C7', `${catHead(`
  <g stroke="${OUT}" stroke-width="6">
    <ellipse cx="116" cy="292" rx="26" ry="18" fill="#F8B65B"/>
    <ellipse cx="244" cy="292" rx="26" ry="18" fill="#F8B65B"/>
  </g>
  <path d="M280 132 C258 112 236 128 246 148 L280 182 L314 148 C324 128 302 112 280 132 Z" fill="#F77E88" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>`)}
  <path d="M134 186 Q150 174 166 186" fill="none" stroke="${OUT}" stroke-width="8" stroke-linecap="round"/>
  <circle cx="212" cy="190" r="9" fill="${OUT}"/>
${catNoseMouth}`),
  },
  { id: 'shop-thumb', svg: frame('#E4F4E8', '#A8D8B4', ICONS['shop-thumb']) },
  { id: 'shop-ok', svg: frame('#FFF2C9', '#F2CF7E', ICONS['shop-ok']) },
  { id: 'shop-heart', svg: frame('#FFE3E6', '#F5A8B0', ICONS['shop-heart']) },
  { id: 'shop-cheer', svg: frame('#FFF0D8', '#FFD08E', ICONS['shop-cheer']) },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const pack of PACKS) {
  writeFileSync(resolve(OUT_DIR, `${pack.id}.svg`), pack.svg, 'utf8')
}
console.log(`✓ 已生成 ${PACKS.length} 个表情素材 → ${OUT_DIR}`)

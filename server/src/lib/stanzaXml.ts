/**
 * 约束型 XMPP stanza XML 解析 / 序列化（自建聊天专用）
 *
 * 帧来自自家前端（lib/xmpp/client.ts 手拼 + DOMParser 解析），词法范围完全可控：
 *   - 无命名空间前缀、无 CDATA、无 PI / DOCTYPE（出现即拒绝该帧）
 *   - 属性一律双引号 / 单引号，文本按五个预定义实体转义
 *
 * 出站帧由 elementOf() 构建后 serialize()；入站帧 parseFrame() 解析，
 * 坏帧返回 []（与前端 parseStanza 的静默丢弃口径一致）。
 */

export interface StanzaElement {
  name: string
  attrs: Record<string, string>
  children: StanzaElement[]
  /** 直接文本（多个文本段拼接；不含子元素的文本） */
  text: string
}

/** XML 转义（属性与文本共用，与前端 escXml 一致） */
export function escXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

function unescapeXml(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      try {
        const code = body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
        if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code)
      } catch {
        // 非法码点按原样保留
      }
      return whole
    }
    return ENTITIES[`&${body};`] ?? whole
  })
}

const NAME_RE = /[A-Za-z_:][A-Za-z0-9_:.-]*/
const TAG_RE = new RegExp(
  `<(/?)(${NAME_RE.source})((?:\\s+${NAME_RE.source}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>"']))*)\\s*(/?)>`,
  'g',
)
const ATTR_RE = new RegExp(`(${NAME_RE.source})\\s*=\\s*("([^"]*)"|'([^']*)')`, 'g')
const SKIP_RE = /<!--[\s\S]*?-->|<[?!][^>]*>/gy

/** 上限保护：深度 / 节点数超限视为坏帧 */
const MAX_DEPTH = 32
const MAX_NODES = 2048

interface ParseResult {
  ok: boolean
  roots: StanzaElement[]
}

function parseDocument(raw: string): ParseResult {
  const roots: StanzaElement[] = []
  const stack: StanzaElement[] = []
  let nodes = 0
  let index = 0

  const pushText = (rawText: string) => {
    if (!rawText) return
    const text = unescapeXml(rawText)
    const top = stack[stack.length - 1]
    if (top) top.text += text
  }

  while (index < raw.length) {
    // 跳过注释 / PI / 声明
    SKIP_RE.lastIndex = index
    const skipMatch = SKIP_RE.exec(raw)
    if (skipMatch && skipMatch.index === index) {
      index = SKIP_RE.lastIndex
      continue
    }
    const nextTag = raw.indexOf('<', index)
    if (nextTag < 0) {
      pushText(raw.slice(index))
      break
    }
    if (nextTag > index) pushText(raw.slice(index, nextTag))

    TAG_RE.lastIndex = nextTag
    const tagMatch = TAG_RE.exec(raw)
    if (!tagMatch || tagMatch.index !== nextTag) {
      return { ok: false, roots: [] }
    }
    index = TAG_RE.lastIndex

    const closing = tagMatch[1] === '/'
    const name = tagMatch[2]
    const selfClosing = tagMatch[4] === '/'

    if (closing) {
      const top = stack.pop()
      if (!top || top.name !== name) return { ok: false, roots: [] }
      if (stack.length === 0) roots.push(top)
      continue
    }

    nodes += 1
    if (nodes > MAX_NODES || stack.length > MAX_DEPTH) return { ok: false, roots: [] }

    const element: StanzaElement = { name, attrs: {}, children: [], text: '' }
    const attrSource = tagMatch[3] || ''
    let attrMatch: RegExpExecArray | null
    ATTR_RE.lastIndex = 0
    while ((attrMatch = ATTR_RE.exec(attrSource)) !== null) {
      element.attrs[attrMatch[1]] = unescapeXml(attrMatch[3] ?? attrMatch[4] ?? '')
    }

    if (stack.length > 0) stack[stack.length - 1].children.push(element)
    if (selfClosing) {
      if (stack.length === 0) roots.push(element)
    } else {
      stack.push(element)
    }
  }

  if (stack.length > 0) return { ok: false, roots: [] }
  return { ok: true, roots }
}

/** 序列化元素（文本与属性全部转义；空元素输出自闭合形式） */
export function serialize(element: StanzaElement): string {
  const attrs = Object.entries(element.attrs)
    .map(([key, value]) => ` ${key}="${escXml(value)}"`)
    .join('')
  if (element.children.length === 0 && element.text === '') {
    return `<${element.name}${attrs}/>`
  }
  const inner = `${escXml(element.text)}${element.children.map(serialize).join('')}`
  return `<${element.name}${attrs}>${inner}</${element.name}>`
}

/** 构建元素（children 与 text 均可省略） */
export function elementOf(
  name: string,
  attrs: Record<string, string | number | boolean | undefined | null> = {},
  children: StanzaElement[] = [],
  text = '',
): StanzaElement {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue
    clean[key] = String(value)
  }
  return { name, attrs: clean, children, text }
}

/**
 * 解析一帧（RFC 7395：每帧一个完整顶层元素）。
 *
 * 与前端一致用 `<wrap>` 包一层：一帧内多个顶层元素也能全部取出；
 * 解析失败返回 []（坏帧静默丢弃）。
 */
export function parseFrame(text: string): StanzaElement[] {
  const raw = String(text || '').trim()
  if (!raw || raw.length > 512 * 1024) return []
  const result = parseDocument(`<wrap>${raw}</wrap>`)
  if (!result.ok) return []
  const wrap = result.roots[0]
  return wrap && wrap.name === 'wrap' ? wrap.children : []
}

/** 取第一个匹配名字的直接子元素 */
export function childOf(element: StanzaElement | undefined, name: string): StanzaElement | null {
  if (!element) return null
  return element.children.find((child) => child.name === name) ?? null
}

/** 便捷：构建元素并同时序列化（入站元素的 xml 形式按需生成） */
export function xmlOf(element: StanzaElement): string {
  return serialize(element)
}

// === XHTML-IM 白名单净化（消息落库前执行） ===

const UPLOAD_SRC_RE = /^\/chat\/uploads\/([0-9a-f]{24})$/
const XHTML_MAX_LENGTH = 16 * 1024


/**
 * 净化客户端发来的 XHTML-IM 片段 → 白名单节点树。
 *
 * 只保留 img（src 限 `/chat/uploads/<24hex>`）、span（data-lw-poke 拍一拍 /
 * data-lw-red 红包私有数字标记）与纯文本；
 * 其余标签剥壳留文本，非法属性丢弃。空片段 / 超长 / 解析失败返回 []。
 * 实时投递直接嵌入节点树（真实元素），落库存 serialize 后的字符串。
 */
export function sanitizeChatXhtmlNodes(html: string): StanzaElement[] {
  const raw = String(html || '')
  if (!raw || raw.length > XHTML_MAX_LENGTH) return []
  const parsed = parseDocument(`<wrap>${raw}</wrap>`)
  if (!parsed.ok) return []
  const nodes: StanzaElement[] = []
  for (const root of parsed.roots[0]?.children ?? []) {
    const sanitized = sanitizeElement(root)
    if (sanitized) nodes.push(sanitized)
  }
  return nodes
}

function sanitizeElement(node: StanzaElement): StanzaElement | null {
  if (node.name === 'br') return elementOf('br')
  if (node.name === 'img') {
    const src = node.attrs.src || ''
    if (!UPLOAD_SRC_RE.test(src)) return null
    const alt = (node.attrs.alt || '').slice(0, 100)
    return elementOf('img', { src, ...(alt ? { alt } : {}) })
  }
  if (node.name === 'span') {
    const poke = node.attrs['data-lw-poke'] || ''
    const red = node.attrs['data-lw-red'] || ''
    const children: StanzaElement[] = []
    for (const child of node.children) {
      const sanitized = sanitizeElement(child)
      if (sanitized) children.push(sanitized)
    }
    // 拍一拍 / 红包私有标记各自独立校验；都非法时保留 span 但不带属性
    const attrs: Record<string, string> = {}
    if (/^\d{1,15}$/.test(poke) && Number(poke) > 0) attrs['data-lw-poke'] = poke
    if (/^\d{1,10}$/.test(red) && Number(red) > 0) attrs['data-lw-red'] = red
    return elementOf('span', attrs, children, node.text.slice(0, 500))
  }
  // 其它标签一律剥壳留文本（前端只发 img / span / 纯文本）
  const children: StanzaElement[] = []
  for (const child of node.children) {
    const sanitized = sanitizeElement(child)
    if (sanitized) children.push(sanitized)
  }
  if (children.length === 0 && !node.text.trim()) return null
  return elementOf('span', {}, children, node.text.slice(0, 500))
}

/** 序列化净化节点（不包 wrapper），作为落库的 xhtml 规范形 */
export function nodesToXhtml(nodes: StanzaElement[]): string {
  return nodes.map(serialize).join('').slice(0, XHTML_MAX_LENGTH)
}

/** 从落库的规范形还原节点树（写入前已净化；解析失败返回 []） */
export function xhtmlToNodes(xhtml: string | null | undefined): StanzaElement[] {
  const raw = String(xhtml || '')
  if (!raw || raw.length > XHTML_MAX_LENGTH) return []
  const parsed = parseDocument(`<wrap>${raw}</wrap>`)
  if (!parsed.ok) return []
  return parsed.roots[0]?.children ?? []
}

/** 序列化节点的「内部」标记（不含自身标签；重组客户端发来的 html>body 内容用） */
export function innerXmlOf(element: StanzaElement): string {
  return `${escXml(element.text)}${element.children.map(serialize).join('')}`
}

/**
 * 净化客户端发来的 XHTML-IM 片段，返回规范字符串（落库用）。
 * 空片段 / 超长 / 解析失败返回空串。
 */
export function sanitizeChatXhtml(html: string): string {
  return nodesToXhtml(sanitizeChatXhtmlNodes(html))
}

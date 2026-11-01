/**
 * 听书：浏览器 Web Speech API（speechSynthesis）的薄封装（纯前端，无依赖）。
 *
 * 设计口径：
 *   - 逐段排队朗读（段落内再按句子切成 ≤160 字的小段），既能有「当前段」高亮，
 *     也避开 Chrome 对超长 utterance 的截断问题；
 *   - 只把正文文本交给引擎，绝不朗读 UI 文案；
 *   - 优雅降级：不支持 speechSynthesis 时 start() 返回 false 并回调 onError，
 *     页面据此隐藏听书入口；
 *   - 切换章节 / 书 / 路由时必须 stop()，否则语音会在其他页面继续。
 */

export interface SpeechChunk {
  /** 高亮 / 跳段分组键（同一段落拆成的多个小段共用） */
  group: string
  /** 交给 speechSynthesis 的纯文本 */
  text: string
}

export interface SpeechSource {
  key: string
  text: string
  /** 朗读专用文本（TXT 硬换行在该字段里合并，避免逐行停顿） */
  speech?: string
}

export interface SpeechCallbacks {
  onStart?: () => void
  onChunk?: (index: number) => void
  onEnd?: () => void
  onError?: (message: string) => void
}

/** 单句上限：太长会被部分浏览器截断，太短则停顿频繁 */
const MAX_CHUNK_CHARS = 100

export const SPEECH_RATES = [0.8, 1, 1.2, 1.5] as const

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/
const SENTENCE_RE = /[^。！？!?；;….\n]+[。！？!?；;….]*/g

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function'
}

/** 把一段正文切成适合朗读的句子块 */
export function splitSpeechText(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const sentences = (normalized.match(SENTENCE_RE) ?? [normalized])
    .map(sentence => sentence.trim())
    .filter(Boolean)
  const pieces: string[] = []
  let buffer = ''
  for (const sentence of sentences) {
    if (sentence.length > MAX_CHUNK_CHARS) {
      if (buffer) {
        pieces.push(buffer)
        buffer = ''
      }
      for (let index = 0; index < sentence.length; index += MAX_CHUNK_CHARS) {
        pieces.push(sentence.slice(index, index + MAX_CHUNK_CHARS))
      }
      continue
    }
    if (!buffer) {
      buffer = sentence
    } else if (buffer.length + sentence.length <= MAX_CHUNK_CHARS) {
      buffer += sentence
    } else {
      pieces.push(buffer)
      buffer = sentence
    }
  }
  if (buffer) pieces.push(buffer)
  return pieces
}

/**
 * 把段落数组转成朗读队列。
 * 同一段的多个句子块共用 group，页面按 group 做段落级高亮。
 */
export function buildSpeechChunks(sources: SpeechSource[]): SpeechChunk[] {
  const chunks: SpeechChunk[] = []
  for (const source of sources) {
    const text = source.speech ?? source.text
    for (const piece of splitSpeechText(text)) chunks.push({ group: source.key, text: piece })
  }
  return chunks
}

/** 中文（尤其多行硬换行）在朗读时不该被换行符切成一句一顿 */
export function joinSpeechLines(lines: string[]): string {
  return lines.reduce((acc, line) => {
    const current = line.trim()
    if (!current) return acc
    if (!acc) return current
    const head = acc.slice(-1)
    const tail = current.slice(0, 1)
    return CJK_RE.test(head) || CJK_RE.test(tail) ? acc + current : `${acc} ${current}`
  }, '')
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (!isSpeechSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const prefix = lang.slice(0, 2).toLowerCase()
  return voices.find(voice => voice.lang.toLowerCase().startsWith(prefix) && voice.localService)
    ?? voices.find(voice => voice.lang.toLowerCase().startsWith(prefix))
    ?? null
}

/** 中文为主用 zh-CN，其余回落到 en-US（避免英文书被中文音色读） */
function detectLanguage(text: string): string {
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  if (cjkCount < 2) return 'en-US'
  return cjkCount / Math.max(text.length, 1) > 0.2 ? 'zh-CN' : 'en-US'
}

function clampRate(rate: number): number {
  const allowed: readonly number[] = SPEECH_RATES
  return allowed.includes(rate) ? rate : 1
}

/**
 * 一个可暂停 / 续播 / 跳段 / 变速的朗读队列。
 * 注意：speechSynthesis 是全局单例，同一时刻只应有一个 ReaderSpeech 工作。
 */
export class ReaderSpeech {
  #chunks: SpeechChunk[] = []
  #index = -1
  #rate = 1
  #paused = false
  #active = false
  #generation = 0
  #startTimer: number | null = null
  #callbacks: SpeechCallbacks

  constructor(callbacks: SpeechCallbacks = {}) {
    this.#callbacks = callbacks
  }

  get supported(): boolean {
    return isSpeechSupported()
  }

  get active(): boolean {
    return this.#active
  }

  get paused(): boolean {
    return this.#paused
  }

  get rate(): number {
    return this.#rate
  }

  get index(): number {
    return this.#index
  }

  get total(): number {
    return this.#chunks.length
  }

  /** 从 startIndex 开始朗读一组 chunk；返回是否成功入队 */
  start(chunks: SpeechChunk[], startIndex = 0, rate = this.#rate): boolean {
    if (!this.supported) {
      this.#callbacks.onError?.('当前浏览器不支持语音朗读')
      return false
    }
    if (!chunks.length) return false
    this.#cancelUtterance()
    this.#chunks = chunks
    this.#index = Math.min(Math.max(startIndex, 0), chunks.length - 1)
    this.#rate = clampRate(rate)
    this.#active = true
    this.#paused = false
    this.#speakCurrent()
    return true
  }

  pause(): void {
    if (!this.#active || this.#paused) return
    this.#paused = true
    try {
      window.speechSynthesis.pause()
    } catch {
      /* 个别内核不支持 pause，保留 paused 状态，resume 时会重播当前段 */
    }
  }

  resume(): void {
    if (!this.#active || !this.#paused) return
    this.#paused = false
    try {
      window.speechSynthesis.resume()
    } catch {
      /* 回落：下面按引擎状态决定是否重播当前段 */
    }
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
      this.#speakCurrent()
    }
  }

  /** 手动停止：不触发 onEnd，避免被当成「读完自动续章」 */
  stop(): void {
    this.#active = false
    this.#paused = false
    this.#generation += 1
    this.#chunks = []
    this.#index = -1
    this.#clearStartTimer()
    try {
      const synth = window.speechSynthesis
      if (synth.speaking || synth.pending) synth.cancel()
    } catch {
      /* 引擎不存在时忽略 */
    }
  }

  /** 上一段 / 下一段（按 group 跳，不按句子块跳） */
  skip(direction: 1 | -1): void {
    if (!this.#active) return
    const current = this.#chunks[this.#index]
    if (!current) return
    let target = -1
    if (direction > 0) {
      let cursor = this.#index + 1
      while (cursor < this.#chunks.length && this.#chunks[cursor].group === current.group) cursor += 1
      target = cursor < this.#chunks.length ? cursor : -1
    } else {
      let groupStart = this.#index
      while (groupStart > 0 && this.#chunks[groupStart - 1].group === current.group) groupStart -= 1
      if (groupStart <= 0) {
        target = 0
      } else {
        let previousStart = groupStart - 1
        while (previousStart > 0 && this.#chunks[previousStart - 1].group === this.#chunks[previousStart].group) {
          previousStart -= 1
        }
        target = previousStart
      }
    }
    if (target < 0) {
      this.#finish()
      return
    }
    this.#index = target
    this.#paused = false
    this.#cancelUtterance()
    this.#speakCurrent()
  }

  /** 变速：朗读中会从当前段落块重新开始（浏览器不支持中途改 rate） */
  setRate(rate: number): void {
    const next = clampRate(rate)
    if (next === this.#rate) return
    this.#rate = next
    if (!this.#active || this.#paused) return
    this.#cancelUtterance()
    this.#speakCurrent()
  }

  #cancelUtterance(): void {
    this.#generation += 1
    this.#clearStartTimer()
    try {
      const synth = window.speechSynthesis
      if (synth.speaking || synth.pending) synth.cancel()
    } catch {
      /* 忽略 */
    }
  }

  #clearStartTimer(): void {
    if (this.#startTimer !== null) {
      window.clearTimeout(this.#startTimer)
      this.#startTimer = null
    }
  }

  #speakCurrent(): void {
    if (!this.#active) return
    const chunk = this.#chunks[this.#index]
    if (!chunk) {
      this.#finish()
      return
    }
    const generation = ++this.#generation
    this.#clearStartTimer()
    const utterance = new SpeechSynthesisUtterance(chunk.text)
    const lang = detectLanguage(chunk.text)
    utterance.lang = lang
    utterance.rate = this.#rate
    utterance.pitch = 1
    utterance.volume = 1
    const voice = pickVoice(lang)
    if (voice) utterance.voice = voice

    utterance.onstart = () => {
      if (generation !== this.#generation || !this.#active) return
      this.#clearStartTimer()
      this.#callbacks.onStart?.()
      this.#callbacks.onChunk?.(this.#index)
    }
    utterance.onend = () => {
      if (generation !== this.#generation || !this.#active || this.#paused) return
      this.#clearStartTimer()
      if (this.#index + 1 >= this.#chunks.length) {
        this.#finish()
        return
      }
      this.#index += 1
      this.#speakCurrent()
    }
    utterance.onerror = (event) => {
      if (generation !== this.#generation || !this.#active) return
      const reason = (event as SpeechSynthesisErrorEvent).error
      if (reason === 'interrupted' || reason === 'canceled') return
      this.#clearStartTimer()
      this.#active = false
      this.#paused = false
      this.#callbacks.onError?.('语音朗读中断，已停止')
    }

    // 初始播放必须在用户手势内同步调用 speak（移动端自动播放策略）
    try {
      const synth = window.speechSynthesis
      synth.speak(utterance)
      if (synth.paused) synth.resume()
    } catch {
      this.#active = false
      this.#paused = false
      this.#callbacks.onError?.('无法启动语音朗读')
      return
    }

    // 看门狗：浏览器偶尔会静默丢弃 utterance（尤其自动续段），4s 未开播就报错退出
    this.#startTimer = window.setTimeout(() => {
      this.#startTimer = null
      if (generation !== this.#generation || !this.#active || this.#paused) return
      const synth = window.speechSynthesis
      if (synth.speaking || synth.pending) return
      this.#active = false
      this.#paused = false
      this.#callbacks.onError?.('语音未能启动，已停止')
    }, 4000)
  }

  #finish(): void {
    this.#clearStartTimer()
    this.#active = false
    this.#paused = false
    this.#callbacks.onEnd?.()
  }
}

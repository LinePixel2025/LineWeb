import { describe, expect, it } from 'vitest'
import {
  extractImageSrc,
  linewebIdOfUsername,
  parseHistoryMessages,
  parseLiveMessage,
  parseStanza,
  uploadIdOf,
  xhtmlTextOf,
} from '../protocol'

const DOMAIN = 'wlxx'
const MUC = 'muc.wlxx'
const CONTEXT = {
  selfUsername: 'lw_2',
  mucDomain: MUC,
  key: 'u1000000000001',
  roomId: null as number | null,
}

const ID_A = '0123456789abcdef01234567'
const ID_B = '89abcdef0123456789abcdef'

function first(text: string) {
  const frames = parseStanza(text)
  expect(frames.length).toBeGreaterThan(0)
  return frames[0]
}

describe('uploadIdOf', () => {
  it('只接受 /chat/uploads/<24hex>', () => {
    expect(uploadIdOf(`/chat/uploads/${ID_A}`)).toBe(ID_A)
    expect(uploadIdOf(`/chat/uploads/${ID_A}?token=x`)).toBe(ID_A)
    expect(uploadIdOf('/chat/uploads/../../etc/passwd')).toBeNull()
    expect(uploadIdOf('https://evil.example/a.png')).toBeNull()
    expect(uploadIdOf(`/static/${ID_A}`)).toBeNull()
  })
})

describe('extractImageSrc', () => {
  it('识别真实 XHTML img 元素', () => {
    expect(extractImageSrc(`<html><body><img src="/chat/uploads/${ID_A}"/></body></html>`)).toBe(
      `/chat/uploads/${ID_A}`,
    )
  })

  it('忽略外部图片与非法上传 id', () => {
    expect(extractImageSrc('<img src="https://evil.example/pixel.gif"/>')).toBeNull()
    expect(extractImageSrc('<img src="/chat/uploads/abc"/>')).toBeNull()
  })
})

describe('parseHistoryMessages', () => {
  it('历史行里的转义 XHTML（图片）能被还原', () => {
    // neko 历史查询把 XHTML 当文本塞进 <html>，落盘形态是转义后的字符串
    const xml = `<query complete="1" read="0"><msg id="7" mine="0" from="alice@${DOMAIN}" ts="1700000000000"><body>[图片]</body><html>&lt;body xmlns="http://www.w3.org/1999/xhtml"&gt;&lt;img src="/chat/uploads/${ID_A}" alt="图片"/&gt;&lt;/body&gt;</html></msg></query>`
    const query = first(xml)
    const row = query.children.find((child) => child.name === 'msg')
    expect(row).toBeTruthy()
    expect(xhtmlTextOf(row!)).toContain(`/chat/uploads/${ID_A}`)
    const parsed = parseHistoryMessages(query, CONTEXT)
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].image).toBe(`/chat/uploads/${ID_A}`)
    expect(parsed.messages[0].body).toBe('[图片]')
  })

  it('历史表情包同样能取回图片', () => {
    const xml = `<query complete="1"><msg id="8" mine="0" from="alice@${DOMAIN}" ts="1700000000001"><body>[表情]</body><html>&lt;body&gt;&lt;img src="/chat/uploads/${ID_B}" alt="表情"/&gt;&lt;/body&gt;</html></msg></query>`
    const parsed = parseHistoryMessages(first(xml), CONTEXT)
    expect(parsed.messages[0].image).toBe(`/chat/uploads/${ID_B}`)
  })

  it('正文里手写的 img 文本不会被当成图片', () => {
    const xml = `<query complete="1"><msg id="9" mine="0" from="alice@${DOMAIN}" ts="1700000000002"><body>&lt;img src="/chat/uploads/${ID_A}"/&gt;</body></msg></query>`
    const parsed = parseHistoryMessages(first(xml), CONTEXT)
    expect(parsed.messages[0].image).toBeNull()
  })

  it('撤回的历史图片不再返回', () => {
    const xml = `<query complete="1"><msg id="10" mine="0" recalled="1" from="alice@${DOMAIN}" ts="1700000000003"><body>[图片]</body><html>&lt;img src="/chat/uploads/${ID_A}"/&gt;</html></msg></query>`
    const parsed = parseHistoryMessages(first(xml), CONTEXT)
    expect(parsed.messages[0].recalled).toBe(true)
    expect(parsed.messages[0].image).toBeNull()
  })
})

describe('parseLiveMessage', () => {
  it('实时 XHTML 元素结构照常出图', () => {
    const xml = `<message type="chat" from="alice@${DOMAIN}" to="lw_2@${DOMAIN}" id="11"><body>[图片]</body><html xmlns="http://jabber.org/protocol/xhtml-im"><body xmlns="http://www.w3.org/1999/xhtml"><img src="/chat/uploads/${ID_A}" alt="图片"/></body></html></message>`
    const parsed = parseLiveMessage(first(xml), CONTEXT)
    expect(parsed?.image).toBe(`/chat/uploads/${ID_A}`)
  })
})

describe('linewebIdOfUsername', () => {
  it('拒绝前导零', () => {
    expect(linewebIdOfUsername('lw_12')).toBe(12)
    expect(linewebIdOfUsername('lw_012')).toBeNull()
    expect(linewebIdOfUsername('alice')).toBeNull()
  })
})

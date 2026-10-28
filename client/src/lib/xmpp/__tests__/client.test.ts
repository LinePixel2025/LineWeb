import { describe, expect, it, vi } from 'vitest'
import { XmppClient } from '../client'

/**
 * 发送帧的扩展协议（urn:wlxx:chat）：
 *   - reply 引用消息 id
 *   - forward 合并转发的源消息 id 列表
 *   - mention 被 @ 的 neko 用户 id
 * 这里只测序列化，不建立真实连接。
 */
function sendOf(build: (client: XmppClient) => void): string {
  const client = new XmppClient()
  const spy = vi.spyOn(client, 'send').mockImplementation(() => {})
  build(client)
  expect(spy).toHaveBeenCalledTimes(1)
  return String(spy.mock.calls[0][0])
}

describe('XmppClient.sendMessage', () => {
  it('普通消息不带 urn:wlxx:chat 扩展', () => {
    const xml = sendOf((client) => {
      client.sendMessage({ to: 'lw_2@wlxx', body: '你好' })
    })
    expect(xml).toBe('<message type="chat" to="lw_2@wlxx"><body>你好</body></message>')
    expect(xml).not.toContain('urn:wlxx:chat')
  })

  it('引用消息带 reply 属性', () => {
    const xml = sendOf((client) => {
      client.sendMessage({ to: 'lw_2@wlxx', body: '回复', reply: 42 })
    })
    expect(xml).toContain('<x xmlns="urn:wlxx:chat" reply="42"/>')
  })

  it('合并转发带 forward 列表并去重、限制 30 条', () => {
    const xml = sendOf((client) => {
      client.sendMessage({
        to: 'lw_2@wlxx',
        body: '[聊天记录]',
        forward: [3, 1, 3, 2],
      })
    })
    expect(xml).toContain('forward="3,1,2"')
  })

  it('mention 子元素与 reply/forward 可同时存在', () => {
    const xml = sendOf((client) => {
      client.sendMessage({
        to: 'room-7@muc.wlxx',
        type: 'groupchat',
        body: '集合',
        reply: 9,
        forward: [11, 12],
        mentions: [0, 1000000000002, 1000000000002],
      })
    })
    expect(xml).toContain('reply="9"')
    expect(xml).toContain('forward="11,12"')
    expect(xml).toContain('<mention user="0"/><mention user="1000000000002"/>')
    expect(xml).toMatch(/<\/x><\/message>$/)
  })

  it('xhtml 图片帧保持 XML 结构', () => {
    const xml = sendOf((client) => {
      client.sendMessage({
        to: 'lw_2@wlxx',
        body: '[图片]',
        xhtml: '<img src="/chat/uploads/0123456789abcdef01234567" alt="图片"/>',
      })
    })
    expect(xml).toContain(
      '<html xmlns="http://jabber.org/protocol/xhtml-im"><body xmlns="http://www.w3.org/1999/xhtml"><img src="/chat/uploads/0123456789abcdef01234567" alt="图片"/></body></html>',
    )
  })
})

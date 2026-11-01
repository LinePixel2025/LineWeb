import { beforeEach, describe, expect, it } from 'vitest'
import {
  MUSIC_STREAM_PROXY_KEY,
  buildMusicImageUrl,
  buildMusicStreamUrl,
  readMusicStreamProxyPreference,
  resolveMusicImageSrc,
  writeMusicStreamProxyPreference,
} from '../stream'

describe('buildMusicStreamUrl', () => {
  it('相对基址 + token（token 做 URL 编码）', () => {
    expect(buildMusicStreamUrl('/api', 347230, 'exhigh', 'a.b-c_d'))
      .toBe('/api/music/stream?id=347230&level=exhigh&token=a.b-c_d')
  })

  it('绝对基址去尾斜杠；无 token 时不带 token 参数', () => {
    expect(buildMusicStreamUrl('https://web.example.com/api/', '9', 'standard', null))
      .toBe('https://web.example.com/api/music/stream?id=9&level=standard')
  })
})

describe('buildMusicImageUrl', () => {
  it('网易 CDN 的 http 地址升级为 https 并改走中转', () => {
    expect(buildMusicImageUrl('/api', 'http://p1.music.126.net/abc.jpg', 'tk'))
      .toBe(`/api/music/image?u=${encodeURIComponent('https://p1.music.126.net/abc.jpg')}&token=tk`)
  })

  it('非网易 CDN 地址原样返回（不代理外链）', () => {
    expect(buildMusicImageUrl('/api', 'https://example.com/a.png', 'tk'))
      .toBe('https://example.com/a.png')
  })

  it('空地址返回 null', () => {
    expect(buildMusicImageUrl('/api', null, 'tk')).toBeNull()
    expect(buildMusicImageUrl('/api', '', 'tk')).toBeNull()
  })
})

describe('resolveMusicImageSrc', () => {
  it('直连模式用升级后的原地址', () => {
    expect(resolveMusicImageSrc('http://p2.music.126.net/x.jpg', false, 'tk', '/api'))
      .toBe('https://p2.music.126.net/x.jpg')
  })

  it('中转模式用 /music/image', () => {
    expect(resolveMusicImageSrc('https://p2.music.126.net/x.jpg', true, 'tk', '/api'))
      .toContain('/api/music/image?u=')
  })
})

describe('中转偏好记忆', () => {
  beforeEach(() => localStorage.clear())

  it('默认关闭', () => {
    expect(readMusicStreamProxyPreference()).toBe(false)
  })

  it('写入后可读回，关闭会写 0', () => {
    writeMusicStreamProxyPreference(true)
    expect(localStorage.getItem(MUSIC_STREAM_PROXY_KEY)).toBe('1')
    expect(readMusicStreamProxyPreference()).toBe(true)
    writeMusicStreamProxyPreference(false)
    expect(readMusicStreamProxyPreference()).toBe(false)
    expect(localStorage.getItem(MUSIC_STREAM_PROXY_KEY)).toBe('0')
  })
})

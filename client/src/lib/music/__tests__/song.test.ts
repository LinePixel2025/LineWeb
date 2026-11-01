import { describe, expect, it } from 'vitest'
import { findLrcIndex, formatSongDuration, normalizeSong, normalizeSongList, parseLrc } from '../song'

describe('normalizeSong', () => {
  it('新字段（ar/al/dt）', () => {
    const song = normalizeSong({
      id: 1,
      name: '晴天',
      ar: [{ name: '周杰伦' }],
      al: { name: '叶惠美', picUrl: 'https://p.example/cover.jpg' },
      dt: 269013,
      fee: 8,
    })
    expect(song).toMatchObject({
      id: 1,
      name: '晴天',
      artists: '周杰伦',
      albumName: '叶惠美',
      picUrl: 'https://p.example/cover.jpg',
      durationMs: 269013,
      fee: 8,
    })
  })

  it('旧字段（artists/album/duration）与多作者拼接', () => {
    const song = normalizeSong({
      id: 2,
      name: '合唱',
      artists: [{ name: '甲' }, { name: '乙' }],
      album: { name: '专辑' },
      duration: 100000,
    })
    expect(song?.artists).toBe('甲 / 乙')
    expect(song?.durationMs).toBe(100000)
  })

  it('无效行被过滤', () => {
    expect(normalizeSong({ id: 3 })).toBeNull()
    expect(normalizeSongList([null, { id: 4, name: 'ok' }, {}])).toHaveLength(1)
    expect(normalizeSongList('not-array')).toEqual([])
  })

  it('已归一化的 SongView（localStorage 队列）可原样读回', () => {
    // 排行榜播放过的队列会按 SongView 形态落到 localStorage，重载后必须能恢复，
    // 否则 http 封面/歌手/时长都会丢（artists 是字符串时曾直接抛错导致队列被清空）
    const song = normalizeSong({
      id: 5,
      name: '无意',
      artists: '加木 / Demxntia',
      albumName: '无意',
      picUrl: 'http://p1.music.126.net/a==/1.jpg',
      durationMs: 176767,
      fee: 1,
    })
    expect(song).toEqual({
      id: 5,
      name: '无意',
      artists: '加木 / Demxntia',
      albumName: '无意',
      // 持久化的 http 封面在这里也被升级为 https
      picUrl: 'https://p1.music.126.net/a==/1.jpg',
      durationMs: 176767,
      fee: 1,
    })
  })
})

describe('formatSongDuration', () => {
  it('毫秒转 m:ss', () => {
    expect(formatSongDuration(269013)).toBe('4:29')
    expect(formatSongDuration(0)).toBe('--:--')
    expect(formatSongDuration(Number.NaN)).toBe('--:--')
  })
})

describe('parseLrc', () => {
  it('基础解析与排序', () => {
    const lines = parseLrc('[ti:标题]\n[00:01.50]第二行\n[00:00.10]第一行')
    expect(lines).toEqual([
      { time: 0.1, line: '第一行' },
      { time: 1.5, line: '第二行' },
    ])
  })

  it('一行多时间标签', () => {
    const lines = parseLrc('[00:01.00][01:30.00]副歌')
    expect(lines).toHaveLength(2)
    expect(lines[0].time).toBe(1)
    expect(lines[1].time).toBe(90)
  })

  it('丢弃无时间标签的行', () => {
    expect(parseLrc('[by:x]\n纯文本\n[00:02.00]有时间的')).toEqual([{ time: 2, line: '有时间的' }])
  })

  it('空输入', () => {
    expect(parseLrc(null)).toEqual([])
    expect(parseLrc('')).toEqual([])
  })
})

describe('findLrcIndex', () => {
  const lines = [
    { time: 0, line: 'a' },
    { time: 10, line: 'b' },
    { time: 20, line: 'c' },
  ]

  it('命中与边界', () => {
    expect(findLrcIndex(lines, -1)).toBe(-1) // 不可能（time 0 ≤ -1 为假）但按语义返回 -1 前应处理
    expect(findLrcIndex(lines, 0)).toBe(0)
    expect(findLrcIndex(lines, 9.99)).toBe(0)
    expect(findLrcIndex(lines, 10)).toBe(1)
    expect(findLrcIndex(lines, 999)).toBe(2)
  })

  it('空歌词', () => {
    expect(findLrcIndex([], 5)).toBe(-1)
  })
})

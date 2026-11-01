import { describe, expect, it } from 'vitest'
import { MediaPlaybackError, playAudioSource } from '../MusicPlayerContext'

/**
 * 播放看门狗：老设备/受限网络里音频 CDN 不可达时 audio.play() 可能永远不 resolve，
 * 旧实现会让「加载中」无限转圈。这里保证三种结局都有确定结果：
 * 正常出声 / 媒体错误 / 超时。
 */
class FakeAudio extends EventTarget {
  src = ''
  loadCalls = 0
  load(): void {
    this.loadCalls += 1
  }
  play(): Promise<void> {
    return new Promise<void>(() => {
      // 默认永不 resolve：模拟 CDN 无响应
    })
  }
}

function asAudio(fake: FakeAudio): HTMLAudioElement {
  return fake as unknown as HTMLAudioElement
}

describe('playAudioSource', () => {
  it('play() 成功即 resolve，并把地址写进 src', async () => {
    const fake = new FakeAudio()
    fake.play = () => Promise.resolve()
    await expect(playAudioSource(asAudio(fake), 'https://cdn.example.com/a.mp3', 50)).resolves.toBeUndefined()
    expect(fake.src).toBe('https://cdn.example.com/a.mp3')
    expect(fake.loadCalls).toBe(1)
  })

  it('媒体 error 事件立即 reject（不等超时）', async () => {
    const fake = new FakeAudio()
    const pending = playAudioSource(asAudio(fake), 'https://cdn.example.com/broken.mp3', 10_000)
    queueMicrotask(() => fake.dispatchEvent(new Event('error')))
    await expect(pending).rejects.toBeInstanceOf(MediaPlaybackError)
  })

  it('play() 永远不 resolve 时由超时兜底 reject（不再无限转圈）', async () => {
    const fake = new FakeAudio()
    await expect(playAudioSource(asAudio(fake), 'https://cdn.example.com/hang.mp3', 30))
      .rejects.toMatchObject({ name: 'MediaPlaybackError', reason: 'timeout' })
  })
})

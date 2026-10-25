import { describe, expect, it } from 'vitest'
import { MARKDOWN_PREVIEW_MAX_BYTES, resolvePreviewKind, TEXT_PREVIEW_MAX_BYTES } from '../drivePreview'
import type { DriveItem } from '../../types/drive'

function makeItem(overrides: Partial<DriveItem> = {}): DriveItem {
  return {
    id: 1,
    name: 'file.txt',
    isFolder: false,
    parentId: null,
    size: '100',
    mimeType: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolvePreviewKind', () => {
  it('按扩展名判定图片/视频/音频/PDF', () => {
    expect(resolvePreviewKind(makeItem({ name: 'a.JPG', mimeType: null }))).toBe('image')
    expect(resolvePreviewKind(makeItem({ name: 'a.png', mimeType: 'application/octet-stream' }))).toBe('image')
    expect(resolvePreviewKind(makeItem({ name: 'a.mp4' }))).toBe('video')
    expect(resolvePreviewKind(makeItem({ name: 'a.mkv' }))).toBe('video')
    expect(resolvePreviewKind(makeItem({ name: 'a.flac' }))).toBe('audio')
    expect(resolvePreviewKind(makeItem({ name: 'a.pdf' }))).toBe('pdf')
  })

  it('按 mimeType 优先判定（扩展名缺失或大小写混杂）', () => {
    expect(resolvePreviewKind(makeItem({ name: 'noext', mimeType: 'image/WEBP' }))).toBe('image')
    expect(resolvePreviewKind(makeItem({ name: 'noext', mimeType: 'Video/MP4' }))).toBe('video')
    expect(resolvePreviewKind(makeItem({ name: 'weird.unknown', mimeType: 'application/pdf' }))).toBe('pdf')
    expect(resolvePreviewKind(makeItem({ name: 'noext', mimeType: 'audio/ogg' }))).toBe('audio')
  })

  it('txt/log/csv 等纯文本可预览', () => {
    expect(resolvePreviewKind(makeItem({ name: 'notes.txt' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'server.log' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'data.csv', mimeType: 'text/csv' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'app.conf' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'noext', mimeType: 'text/plain' }))).toBe('text')
  })

  it('代码类扩展名走文本预览', () => {
    expect(resolvePreviewKind(makeItem({ name: 'index.ts' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'main.py' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'dockerfile' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'data.json' }))).toBe('text')
  })

  it('markdown 单独成类', () => {
    expect(resolvePreviewKind(makeItem({ name: 'README.md' }))).toBe('markdown')
    expect(resolvePreviewKind(makeItem({ name: 'noext', mimeType: 'text/markdown' }))).toBe('markdown')
  })

  it('超过大小上限的文本不预览（回落下载），小文本不受影响', () => {
    const big = String(TEXT_PREVIEW_MAX_BYTES + 1)
    expect(resolvePreviewKind(makeItem({ name: 'big.txt', size: big }))).toBeNull()
    expect(resolvePreviewKind(makeItem({ name: 'big.md', size: big }))).toBeNull()
    expect(resolvePreviewKind(makeItem({ name: 'ok.txt', size: String(TEXT_PREVIEW_MAX_BYTES) }))).toBe('text')
  })

  it('双上限：文本/代码 20MB、markdown 2MB', () => {
    const betweenLimits = String(5 * 1024 * 1024) // 5MB：文本可预览，markdown 超限
    expect(resolvePreviewKind(makeItem({ name: 'big-source.ts', size: betweenLimits }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'big-doc.md', size: betweenLimits }))).toBeNull()
    expect(resolvePreviewKind(makeItem({ name: 'md-ok.md', size: String(MARKDOWN_PREVIEW_MAX_BYTES) }))).toBe('markdown')
  })

  it('媒体类型不受文本大小上限约束', () => {
    const huge = String(10 * 1024 * 1024 * 1024)
    expect(resolvePreviewKind(makeItem({ name: 'movie.mp4', size: huge }))).toBe('video')
    expect(resolvePreviewKind(makeItem({ name: 'doc.pdf', size: huge }))).toBe('pdf')
  })

  it('未知类型返回 null', () => {
    expect(resolvePreviewKind(makeItem({ name: 'archive.zip' }))).toBeNull()
    expect(resolvePreviewKind(makeItem({ name: 'noext', mimeType: 'application/octet-stream' }))).toBeNull()
    expect(resolvePreviewKind(makeItem({ name: 'noext', mimeType: null }))).toBeNull()
  })

  it('text/html 按源码文本预览（api.text 转义渲染，无脚本执行面），svg 走图片预览', () => {
    expect(resolvePreviewKind(makeItem({ name: 'noext', mimeType: 'text/html' }))).toBe('text')
    // svg 走图片预览（<img> 渲染，脚本不执行），而非文本
    expect(resolvePreviewKind(makeItem({ name: 'icon.svg' }))).toBe('image')
  })

  it('无点文件名（dockerfile/gitignore）整体匹配', () => {
    expect(resolvePreviewKind(makeItem({ name: 'dockerfile' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: 'Dockerfile' }))).toBe('text')
    expect(resolvePreviewKind(makeItem({ name: '.gitignore' }))).toBe('text')
  })
})

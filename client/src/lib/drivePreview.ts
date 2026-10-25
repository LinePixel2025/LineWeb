import type { DriveItem } from '../types/drive'

/**
 * 预览类型判定 — 唯一真相源。
 * DrivePreview 的组件路由、DrivePage.handlePreview、MobileDriveShell 与
 * DriveDetailPanel 的「预览」入口显隐都从这里取判定，避免多处白名单漂移。
 */

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text'

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv']
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']
const MARKDOWN_EXTS = ['md', 'markdown']
const CODE_EXTS = [
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs',
  'rb', 'php', 'swift', 'kt', 'scala', 'html', 'css', 'scss', 'less', 'json', 'xml',
  'yaml', 'yml', 'toml', 'sql', 'sh', 'bash', 'zsh', 'dockerfile', 'gitignore',
  'lua', 'r', 'pl', 'dart', 'vue', 'svelte',
]
const PLAINTEXT_EXTS = ['txt', 'log', 'csv', 'tsv', 'ini', 'conf', 'cfg', 'env', 'properties', 'bat', 'cmd', 'ps1', 'diff', 'patch']

/**
 * 文本类预览的大小上限：
 * - 文本/代码走 CodeMirror 虚拟化渲染（GitHub 同款方案），只渲染可视区域，可放宽到 50MB；
 * - markdown 是整篇正则渲染成 HTML，撑不了大文件，维持 2MB。
 * 超限不预览，调用方回落为下载。
 */
export const TEXT_PREVIEW_MAX_BYTES = 50 * 1024 * 1024
export const MARKDOWN_PREVIEW_MAX_BYTES = 2 * 1024 * 1024

function extOf(name: string): string {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  // dockerfile / gitignore / makefile 这类无点文件名整体参与匹配
  if (dot === -1) return lower
  return lower.slice(dot + 1)
}

export function resolvePreviewKind(item: Pick<DriveItem, 'name' | 'mimeType' | 'size'>): PreviewKind | null {
  const mime = (item.mimeType || '').toLowerCase()
  const ext = extOf(item.name)
  const size = Number(item.size)

  if (mime.startsWith('image/') || IMAGE_EXTS.includes(ext)) return 'image'
  if (mime.startsWith('video/') || VIDEO_EXTS.includes(ext)) return 'video'
  if (mime.startsWith('audio/') || AUDIO_EXTS.includes(ext)) return 'audio'
  if (mime.includes('pdf') || ext === 'pdf') return 'pdf'

  const isTextLike = mime.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/javascript'
    || MARKDOWN_EXTS.includes(ext)
    || CODE_EXTS.includes(ext)
    || PLAINTEXT_EXTS.includes(ext)
  if (!isTextLike) return null
  const isMarkdown = MARKDOWN_EXTS.includes(ext) || mime.includes('markdown')
  const limit = isMarkdown ? MARKDOWN_PREVIEW_MAX_BYTES : TEXT_PREVIEW_MAX_BYTES
  if (Number.isFinite(size) && size > limit) return null
  return isMarkdown ? 'markdown' : 'text'
}

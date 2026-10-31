import Icon, { type IconName } from '../ui/Icon'
import type { DriveItem } from '../../types/drive'

/**
 * 网盘图标出口（2026-11 重绘）
 *
 * 统一走 ui/Icon 的 24×24 duotone 体系：文件夹/文件类型保留可识别轮廓，
 * 操作类图标与全站 chrome 使用同一套圆角、描边粗细和留白。
 * 这里只做语义映射，避免每个调用点各自写 SVG。
 */
function driveIcon(name: IconName, size: number) {
  return <Icon name={name} size={size} strokeWidth={1.7} />
}

export function FolderIcon({ size = 20 }: { size?: number }) { return driveIcon('folder', size) }
export function FileIcon({ size = 20 }: { size?: number }) { return driveIcon('file', size) }
export function ImageIcon({ size = 20 }: { size?: number }) { return driveIcon('image', size) }
export function VideoIcon({ size = 20 }: { size?: number }) { return driveIcon('video', size) }
export function AudioIcon({ size = 20 }: { size?: number }) { return driveIcon('audio', size) }
export function PdfIcon({ size = 20 }: { size?: number }) { return driveIcon('pdf', size) }
export function CodeIcon({ size = 20 }: { size?: number }) { return driveIcon('code', size) }
export function ArchiveIcon({ size = 20 }: { size?: number }) { return driveIcon('archive', size) }
export function StarIcon({ size = 18, filled = false }: { size?: number; filled?: boolean }) {
  return <Icon name="star" size={size} strokeWidth={1.7} filled={filled} />
}
export function DownloadIcon({ size = 18 }: { size?: number }) { return driveIcon('download', size) }
export function CheckIcon({ size = 16 }: { size?: number }) { return driveIcon('check', size) }
export function CloseIcon({ size = 16 }: { size?: number }) { return driveIcon('close', size) }
export function UploadIcon({ size = 18 }: { size?: number }) { return driveIcon('upload', size) }
export function DeleteIcon({ size = 18 }: { size?: number }) { return driveIcon('trash', size) }
export function RenameIcon({ size = 18 }: { size?: number }) { return driveIcon('edit', size) }
export function NewFolderIcon({ size = 18 }: { size?: number }) { return driveIcon('folder-plus', size) }
export function RefreshIcon({ size = 18 }: { size?: number }) { return driveIcon('refresh', size) }
export function SearchIcon({ size = 18 }: { size?: number }) { return driveIcon('search', size) }
export function FilterIcon({ size = 16 }: { size?: number }) { return driveIcon('filter', size) }
export function MoreIcon({ size = 18 }: { size?: number }) { return driveIcon('more', size) }
export function PanelIcon({ size = 18 }: { size?: number }) { return driveIcon('panel', size) }
export function GridViewIcon({ size = 18 }: { size?: number }) { return driveIcon('grid', size) }
export function ListViewIcon({ size = 18 }: { size?: number }) { return driveIcon('list', size) }
export function ChevronRight({ size = 14 }: { size?: number }) { return driveIcon('chevron-right', size) }
export function ChevronDown({ size = 14 }: { size?: number }) { return driveIcon('chevron-down', size) }
export function HomeIcon({ size = 18 }: { size?: number }) { return driveIcon('home', size) }
export function ClockIcon({ size = 18 }: { size?: number }) { return driveIcon('clock', size) }
export function CopyIcon({ size = 18 }: { size?: number }) { return driveIcon('copy', size) }
export function SelectAllIcon({ size = 18 }: { size?: number }) { return driveIcon('select-all', size) }
export function MoveIcon({ size = 18 }: { size?: number }) { return driveIcon('move', size) }

export function getDriveIcon(item: DriveItem, size = 20) {
  if (item.isFolder) return <FolderIcon size={size} />
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
  const mime = (item.mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return <ImageIcon size={size} />
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) return <VideoIcon size={size} />
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return <AudioIcon size={size} />
  if (mime.includes('pdf') || ext === 'pdf') return <PdfIcon size={size} />
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <ArchiveIcon size={size} />
  if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) return <CodeIcon size={size} />
  return <FileIcon size={size} />
}

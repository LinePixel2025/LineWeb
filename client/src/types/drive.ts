export interface DriveItem {
  id: number
  name: string
  isFolder: boolean
  parentId: number | null
  size: string  // BigInt 序列化为字符串，避免精度丢失；显示时用 Number() 转换
  mimeType: string | null
  createdAt: string
  updatedAt: string
  uploadedBy?: { id: number; username: string }
}

export interface Breadcrumb {
  id: number | null
  name: string
}

export type SortField = 'name' | 'size' | 'updatedAt' | 'createdAt' | 'type'
export type SortDirection = 'asc' | 'desc'

export interface SortOption {
  field: SortField
  direction: SortDirection
}

export type CategoryFilter = 'all' | 'images' | 'videos' | 'audio' | 'documents' | 'archives' | 'code'

export type ViewMode = 'list' | 'grid'

export interface SidebarNavItem {
  id: string
  label: string
  icon: string
  filter?: CategoryFilter
  count?: number
}

export function getFileIcon(item: DriveItem): string {
  if (item.isFolder) return '📁'
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
  const mime = (item.mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️'
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) return '🎬'
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎵'
  if (mime.includes('pdf') || ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx'].includes(ext)) return '📊'
  if (['ppt', 'pptx'].includes(ext)) return '📑'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️'
  if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) return '💻'
  return '📄'
}

export function getFileCategory(item: DriveItem): CategoryFilter {
  if (item.isFolder) return 'all'
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
  const mime = (item.mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'images'
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) return 'videos'
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archives'
  if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) return 'code'
  return 'documents'
}

export function getFileTypeLabel(item: DriveItem): string {
  if (item.isFolder) return '文件夹'
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
  const mime = (item.mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '图片'
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) return '视频'
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '音频'
  if (mime.includes('pdf') || ext === 'pdf') return 'PDF 文档'
  if (['doc', 'docx'].includes(ext)) return 'Word 文档'
  if (['xls', 'xlsx'].includes(ext)) return 'Excel 表格'
  if (['ppt', 'pptx'].includes(ext)) return 'PPT 演示'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '压缩包'
  if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) return '代码文件'
  return '文件'
}

export interface DriveListResponse {
  data: DriveItem[]
  total: number
  page: number
  pageCount: number
}

export interface TransferProgress {
  /** 当前文件已传输字节 */
  loaded: number
  /** 当前文件总字节 */
  total: number
  /** 实时速度 bytes/s */
  speed: number
  /** 预估剩余时间秒 */
  eta: number
  /** 当前文件名 */
  fileName: string
  /** 文件队列中的索引 */
  fileIndex: number
  /** 总文件数 */
  totalFiles: number
}

export interface DownloadTask {
  id: string
  fileName: string
  loaded: number
  total: number
  speed: number
  status: 'downloading' | 'complete' | 'cancelled' | 'error'
  error?: string
}

export interface TabItem {
  id: string
  folderId: number | null
  folderName: string
  path: Breadcrumb[]
}

export interface FavoriteItem {
  id: string
  folderId: number
  folderName: string
  groupId?: string
  order: number
}

export interface DriveContextState {
  currentPath: Breadcrumb[]
  tabs: TabItem[]
  activeTabId: string | null
  selectedFiles: number[]
  favorites: FavoriteItem[]
  viewMode: ViewMode
  sort: SortOption
  categoryFilter: CategoryFilter
  searchQuery: string
  searchResults: DriveItem[] | null
  searching: boolean
}

export interface DriveContextType {
  state: DriveContextState
  navigateTo: (path: Breadcrumb[]) => void
  navigateToFolder: (folderId: number | null, folderName: string) => void
  navigateToBreadcrumb: (index: number) => void
  openTab: (folderId: number | null, folderName: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  selectFile: (fileId: number, multiSelect?: boolean) => void
  selectAll: (fileIds: number[]) => void
  clearSelection: () => void
  addFavorite: (folderId: number, folderName: string) => void
  removeFavorite: (folderId: number) => void
  reorderFavorites: (favorites: FavoriteItem[]) => void
  setViewMode: (mode: ViewMode) => void
  setSort: (sort: SortOption) => void
  setCategoryFilter: (filter: CategoryFilter) => void
  setSearchQuery: (query: string) => void
  refreshFiles: () => void
}

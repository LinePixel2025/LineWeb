import { useReducer, useEffect, useCallback, useRef, useMemo, useState } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'
import DriveToolbar from '../components/drive/DriveToolbar'

import DriveNavigation from '../components/drive/DriveNavigation'
import MobileNav from '../components/drive/MobileNav'
import DriveDetailPanel from '../components/drive/DriveDetailPanel'
import DriveListView from '../components/drive/DriveListView'
import DriveGridView from '../components/drive/DriveGridView'
import UploadZone from '../components/drive/UploadZone'
import DrivePreview from '../components/drive/DrivePreview'
import BatchActions from '../components/drive/BatchActions'
import { NewFolderDialog, RenameDialog, DeleteDialog } from '../components/drive/DriveDialogs'
import Pagination from '../components/Pagination'
import api, { ApiError } from '../lib/api'
import { useDownload } from '../contexts/DownloadContext'
import { useResponsive } from '../hooks/useResponsive'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { DriveProvider, useDrive } from '../contexts/DriveContext'
import type { DriveItem, Breadcrumb, DriveListResponse, SortOption, CategoryFilter, ViewMode } from '../types/drive'
import { getFileCategory } from '../types/drive'
import { FolderIcon } from '../components/drive/DriveIcons'

// === 状态类型定义 ===
interface DriveState {
  items: DriveItem[]
  loading: boolean
  error: string
  page: number
  totalPages: number
  total: number
  searchQuery: string
  searchResults: DriveItem[] | null
  searching: boolean
  breadcrumbs: Breadcrumb[]
  viewMode: ViewMode
  showUpload: boolean
  showNewFolder: boolean
  previewItem: DriveItem | null
  deleteItem: DriveItem | null
  renameItem: DriveItem | null
  syncing: boolean
  syncMessage: string
  selectedId: number | null
  categoryFilter: CategoryFilter
  sort: SortOption
}

// === Action 类型定义 ===
type DriveAction =
  | { type: 'SET_ITEMS'; payload: { items: DriveItem[]; total: number; page: number; totalPages: number } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'SET_SEARCH_QUERY'; payload: string }
  | { type: 'SET_SEARCH_RESULTS'; payload: { results: DriveItem[] | null; searching: boolean } }
  | { type: 'NAVIGATE_TO_FOLDER'; payload: Breadcrumb }
  | { type: 'NAVIGATE_TO_BREADCRUMB'; payload: number }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'TOGGLE_UPLOAD'; payload: boolean }
  | { type: 'TOGGLE_NEW_FOLDER'; payload: boolean }
  | { type: 'SET_PREVIEW_ITEM'; payload: DriveItem | null }
  | { type: 'SET_DELETE_ITEM'; payload: DriveItem | null }
  | { type: 'SET_RENAME_ITEM'; payload: DriveItem | null }
  | { type: 'SET_SYNCING'; payload: boolean }
  | { type: 'SET_SYNC_MESSAGE'; payload: string }
  | { type: 'SET_SELECTED'; payload: number | null }
  | { type: 'SET_CATEGORY_FILTER'; payload: CategoryFilter }
  | { type: 'SET_SORT'; payload: SortOption }
  | { type: 'SET_BREADCRUMBS'; payload: Breadcrumb[] }

// === 初始状态 ===
const initialState: DriveState = {
  items: [],
  loading: true,
  error: '',
  page: 1,
  totalPages: 1,
  total: 0,
  searchQuery: '',
  searchResults: null,
  searching: false,
  breadcrumbs: [{ id: null, name: '根目录' }],
  viewMode: 'list',
  showUpload: false,
  showNewFolder: false,
  previewItem: null,
  deleteItem: null,
  renameItem: null,
  syncing: false,
  syncMessage: '',
  selectedId: null,
  categoryFilter: 'all',
  sort: { field: 'name', direction: 'asc' },
}

// === Reducer 函数 ===
function driveReducer(state: DriveState, action: DriveAction): DriveState {
  switch (action.type) {
    case 'SET_ITEMS':
      return {
        ...state,
        items: action.payload.items,
        total: action.payload.total,
        page: action.payload.page,
        totalPages: action.payload.totalPages,
        loading: false,
        error: '',
      }
    case 'SET_LOADING':
      return { ...state, loading: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false }
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.payload }
    case 'SET_SEARCH_RESULTS':
      return { ...state, searchResults: action.payload.results, searching: action.payload.searching }
    case 'NAVIGATE_TO_FOLDER':
      return {
        ...state,
        breadcrumbs: [...state.breadcrumbs, action.payload],
        searchQuery: '',
        searchResults: null,
        selectedId: null,
        categoryFilter: 'all',
      }
    case 'NAVIGATE_TO_BREADCRUMB':
      return {
        ...state,
        breadcrumbs: state.breadcrumbs.slice(0, action.payload + 1),
        searchQuery: '',
        searchResults: null,
        selectedId: null,
        categoryFilter: 'all',
      }
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload }
    case 'TOGGLE_UPLOAD':
      return { ...state, showUpload: action.payload }
    case 'TOGGLE_NEW_FOLDER':
      return { ...state, showNewFolder: action.payload }
    case 'SET_PREVIEW_ITEM':
      return { ...state, previewItem: action.payload }
    case 'SET_DELETE_ITEM':
      return { ...state, deleteItem: action.payload }
    case 'SET_RENAME_ITEM':
      return { ...state, renameItem: action.payload }
    case 'SET_SYNCING':
      return { ...state, syncing: action.payload }
    case 'SET_SYNC_MESSAGE':
      return { ...state, syncMessage: action.payload }
    case 'SET_SELECTED':
      return { ...state, selectedId: action.payload }
    case 'SET_CATEGORY_FILTER':
      return { ...state, categoryFilter: action.payload }
    case 'SET_SORT':
      return { ...state, sort: action.payload }
    case 'SET_BREADCRUMBS':
      return { ...state, breadcrumbs: action.payload, searchQuery: '', searchResults: null, selectedId: null, categoryFilter: 'all' }
    default:
      return state
  }
}

interface BatchActionsBridgeProps {
  items: DriveItem[]
  onRefresh: () => void
  onStartDownload: (item: DriveItem) => void
  onDeleteItem: (item: DriveItem) => void
}

function BatchActionsBridge({ items, onRefresh, onStartDownload, onDeleteItem }: BatchActionsBridgeProps) {
  const { state, clearSelection } = useDrive()

  const handleBatchDownload = useCallback(() => {
    const selectedItems = items.filter(item => state.selectedFiles.includes(item.id))
    selectedItems.forEach(item => {
      if (!item.isFolder) onStartDownload(item)
    })
  }, [items, state.selectedFiles, onStartDownload])

  const handleBatchDelete = useCallback(async () => {
    const selectedItems = items.filter(item => state.selectedFiles.includes(item.id))
    if (selectedItems.length === 0) return
    if (!confirm(`确定删除选中的 ${selectedItems.length} 个文件？`)) return
    try {
      await Promise.all(selectedItems.map(item => api.delete(`/drive/files/${item.id}`)))
      clearSelection()
      onRefresh()
    } catch {
      // errors handled silently
    }
  }, [items, state.selectedFiles, clearSelection, onRefresh])

  const handleBatchFavorite = useCallback(() => {
    const selectedFolders = items.filter(item => state.selectedFiles.includes(item.id) && item.isFolder)
    selectedFolders.forEach(item => {
      const key = 'lineweb_favorites'
      try {
        const raw = localStorage.getItem(key)
        const favorites = raw ? JSON.parse(raw) : []
        if (!favorites.some((f: { folderId: number }) => f.folderId === item.id)) {
          favorites.push({ id: `fav-${item.id}`, folderId: item.id, folderName: item.name, order: Date.now() })
          localStorage.setItem(key, JSON.stringify(favorites))
        }
      } catch {
        // ignore
      }
    })
    clearSelection()
  }, [items, state.selectedFiles, clearSelection])

  const handleBatchMove = useCallback(() => {
    // TODO: implement folder picker dialog
    alert('移动功能即将上线')
  }, [])

  return (
    <BatchActions
      onBatchDownload={handleBatchDownload}
      onBatchMove={handleBatchMove}
      onBatchDelete={handleBatchDelete}
      onBatchFavorite={handleBatchFavorite}
      onClearSelection={clearSelection}
    />
  )
}

function DriveSyncBridge({ onNavigate }: { onNavigate: (path: Breadcrumb[]) => void }) {
  const driveContext = useDrive()
  const prevPathRef = useRef<string>('')

  useEffect(() => {
    const pathKey = JSON.stringify(driveContext.state.currentPath)
    if (pathKey !== prevPathRef.current) {
      prevPathRef.current = pathKey
      onNavigate(driveContext.state.currentPath)
    }
  }, [driveContext.state.currentPath, onNavigate])

  return null
}

export default function DrivePage() {
  const [state, dispatch] = useReducer(driveReducer, initialState)
  const { startDownload } = useDownload()
  const { isDesktop, isMobile } = useResponsive()
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [mobileTab, setMobileTab] = useState<'files' | 'favorites' | 'search' | 'settings'>('files')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const handleContextNavigate = useCallback((path: Breadcrumb[]) => {
    dispatch({ type: 'SET_BREADCRUMBS', payload: path })
  }, [])

  // 计算当前父文件夹 ID
  const currentParentId = state.breadcrumbs[state.breadcrumbs.length - 1]?.id ?? null

  // 获取文件列表
  const fetchItems = useCallback(async (parentId: number | null, targetPage?: number) => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'SET_ERROR', payload: '' })
    try {
      const p = targetPage ?? 1
      const params = new URLSearchParams()
      if (parentId !== null) params.set('parentId', String(parentId))
      params.set('page', String(p))
      params.set('limit', '15')
      const res = await api.get<DriveListResponse>(`/drive/files?${params}`)
      // 基于 id 去重（防御性 — 确保不会因后端数据问题导致重复渲染）
      const seen = new Set<number>()
      const deduped = res.data.filter(item => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      dispatch({
        type: 'SET_ITEMS',
        payload: { items: deduped, total: res.total, page: res.page, totalPages: res.pageCount },
      })
    } catch (err: unknown) {
      dispatch({ type: 'SET_ERROR', payload: err instanceof ApiError ? err.message : '加载失败' })
      dispatch({ type: 'SET_ITEMS', payload: { items: [], total: 0, page: 1, totalPages: 1 } })
    }
  }, [])

  // 初始加载和文件夹切换时获取数据
  useEffect(() => {
    fetchItems(currentParentId, 1)
  }, [currentParentId, fetchItems])

  // 搜索防抖
  useEffect(() => {
    if (!state.searchQuery.trim()) {
      dispatch({ type: 'SET_SEARCH_RESULTS', payload: { results: null, searching: false } })
      return
    }

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      dispatch({ type: 'SET_SEARCH_RESULTS', payload: { results: null, searching: true } })
      try {
        const data = await api.get<DriveItem[]>(`/drive/search?q=${encodeURIComponent(state.searchQuery)}`)
        dispatch({ type: 'SET_SEARCH_RESULTS', payload: { results: data, searching: false } })
      } catch {
        dispatch({ type: 'SET_SEARCH_RESULTS', payload: { results: [], searching: false } })
      }
    }, 300)

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [state.searchQuery])

  // 导航到文件夹
  const navigateToFolder = useCallback((item: DriveItem) => {
    if (!item.isFolder) return
    dispatch({ type: 'NAVIGATE_TO_FOLDER', payload: { id: item.id, name: item.name } })
  }, [])

  // 导航到面包屑
  const navigateToBreadcrumb = useCallback((index: number) => {
    dispatch({ type: 'NAVIGATE_TO_BREADCRUMB', payload: index })
  }, [])

  // 预览文件
  const handlePreview = useCallback((item: DriveItem) => {
    if (item.isFolder) return
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ||
        mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
      dispatch({ type: 'SET_PREVIEW_ITEM', payload: item })
    } else {
      startDownload(item)
    }
  }, [startDownload])

  // 刷新当前页面
  const refresh = useCallback(() => {
    fetchItems(currentParentId, state.page)
  }, [currentParentId, state.page, fetchItems])

  // 同步文件
  const handleSync = useCallback(async () => {
    dispatch({ type: 'SET_SYNCING', payload: true })
    dispatch({ type: 'SET_SYNC_MESSAGE', payload: '' })
    try {
      const report = await api.post<{ missingCreated: number; errors: string[]; scanned: number }>('/drive/sync')
      if (report.errors && report.errors.length > 0) {
        dispatch({ type: 'SET_SYNC_MESSAGE', payload: `同步完成，${report.errors.length} 个错误: ${report.errors.slice(0, 2).join('; ')}` })
      } else if (report.missingCreated > 0) {
        dispatch({ type: 'SET_SYNC_MESSAGE', payload: `同步完成，发现 ${report.missingCreated} 个新文件` })
      } else {
        dispatch({ type: 'SET_SYNC_MESSAGE', payload: '同步完成，没有新文件' })
      }
      refresh()
    } catch {
      dispatch({ type: 'SET_SYNC_MESSAGE', payload: '同步失败，请检查存储节点连接' })
    } finally {
      dispatch({ type: 'SET_SYNCING', payload: false })
    }
  }, [refresh])



  // 打开新建文件夹对话框
  const openNewFolder = useCallback(() => {
    dispatch({ type: 'TOGGLE_NEW_FOLDER', payload: true })
  }, [])

  // 打开上传区域
  const openUpload = useCallback(() => {
    dispatch({ type: 'TOGGLE_UPLOAD', payload: true })
  }, [])

  // 上传完成处理
  const handleUploaded = useCallback(() => {
    refresh()
    dispatch({ type: 'TOGGLE_UPLOAD', payload: false })
  }, [refresh])

  // 选择文件
  const handleSelect = useCallback((item: DriveItem | null) => {
    dispatch({ type: 'SET_SELECTED', payload: item?.id ?? null })
  }, [])

  // 计算显示的文件列表
  const displayItems = useMemo(() => {
    let items = state.searchResults !== null ? state.searchResults : state.items

    // 分类过滤
    if (state.categoryFilter !== 'all') {
      items = items.filter(item => {
        if (item.isFolder) return true
        return getFileCategory(item) === state.categoryFilter
      })
    }

    // 排序
    items = [...items].sort((a, b) => {
      // 文件夹始终排在前面
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1

      const { field, direction } = state.sort
      const multiplier = direction === 'asc' ? 1 : -1

      switch (field) {
        case 'name':
          return multiplier * a.name.localeCompare(b.name, 'zh-CN')
        case 'size':
          return multiplier * (Number(a.size) - Number(b.size))
        case 'updatedAt':
          return multiplier * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
        case 'createdAt':
          return multiplier * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        case 'type': {
          const extA = a.name.split('.').pop()?.toLowerCase() || ''
          const extB = b.name.split('.').pop()?.toLowerCase() || ''
          return multiplier * extA.localeCompare(extB)
        }
        default:
          return 0
      }
    })

    return items
  }, [state.searchResults, state.items, state.categoryFilter, state.sort])

  // 快捷键支持
  useKeyboardShortcuts({
    selectedFileIds: state.selectedId ? [state.selectedId] : [],
    currentPathLength: state.breadcrumbs.length,
    onDelete: state.selectedId
      ? () => {
          const item = displayItems.find((i) => i.id === state.selectedId)
          if (item) dispatch({ type: 'SET_DELETE_ITEM', payload: item })
        }
      : undefined,
    onRename: state.selectedId
      ? () => {
          const item = displayItems.find((i) => i.id === state.selectedId)
          if (item) dispatch({ type: 'SET_RENAME_ITEM', payload: item })
        }
      : undefined,
    onNewFolder: openNewFolder,
    onUpload: openUpload,
    onRefresh: refresh,
    onClearSelection: () => handleSelect(null),
    onNavigateBack: () => navigateToBreadcrumb(state.breadcrumbs.length - 2),
    onSelectAll: () => {
      if (displayItems.length > 0) handleSelect(displayItems[0])
    },
  })

  const isSearching = state.searchResults !== null

  // 计算分类计数
  const fileCounts = useMemo(() => {
    const allItems = state.items
    return {
      all: allItems.length,
      images: allItems.filter(i => !i.isFolder && getFileCategory(i) === 'images').length,
      videos: allItems.filter(i => !i.isFolder && getFileCategory(i) === 'videos').length,
      audio: allItems.filter(i => !i.isFolder && getFileCategory(i) === 'audio').length,
      documents: allItems.filter(i => !i.isFolder && getFileCategory(i) === 'documents').length,
      archives: allItems.filter(i => !i.isFolder && getFileCategory(i) === 'archives').length,
      code: allItems.filter(i => !i.isFolder && getFileCategory(i) === 'code').length,
    }
  }, [state.items])

  // 获取选中的文件
  const selectedItem = useMemo(() => {
    if (!state.selectedId) return null
    return displayItems.find(item => item.id === state.selectedId) || null
  }, [state.selectedId, displayItems])

  return (
    <DriveProvider>
      <DriveSyncBridge onNavigate={handleContextNavigate} />
      <div className="page drive-page">
        {/* Desktop/Tablet Navigation Sidebar */}
        {isDesktop && (
          <DriveNavigation
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        )}

        {/* Main Content */}
        <div className="drive-main">
          <LiquidGlass variant="blur" interactive={false} className="page-card drive-content-card">
            <DriveToolbar
              breadcrumbs={state.breadcrumbs}
              searchQuery={state.searchQuery}
              searching={state.searching}
              searchResultCount={state.searchResults?.length ?? null}
              onSearch={(query) => dispatch({ type: 'SET_SEARCH_QUERY', payload: query })}
              onNavigate={navigateToBreadcrumb}
              onNewFolder={openNewFolder}
              onUpload={openUpload}
              onSync={handleSync}
              syncing={state.syncing}
              onParentFolder={() => navigateToBreadcrumb(state.breadcrumbs.length - 2)}
            />

            {state.syncMessage && (
              <div className="drive-sync-message" style={{
                padding: '8px 16px',
                fontSize: '0.85rem',
                color: state.syncMessage.includes('失败') || state.syncMessage.includes('错误') ? 'var(--lg-text-danger)' : 'var(--lg-text-secondary)',
                background: 'var(--lg-surface)',
                borderRadius: '8px',
                marginBottom: '8px',
              }}>
                {state.syncMessage}
              </div>
            )}

            <BatchActionsBridge
              items={displayItems}
              onRefresh={refresh}
              onStartDownload={startDownload}
              onDeleteItem={(item) => dispatch({ type: 'SET_DELETE_ITEM', payload: item })}
            />

            {/* Upload Zone */}
            {state.showUpload && (
              <UploadZone
                parentId={currentParentId}
                onUploaded={handleUploaded}
                onClose={() => dispatch({ type: 'TOGGLE_UPLOAD', payload: false })}
              />
            )}

            {/* Content */}
            {state.loading ? (
              <div className="drive-loading">
                <div className="spinner" />
                <p style={{ marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
                  正在加载...
                </p>
              </div>
            ) : state.error ? (
              <LiquidGlass variant="blur" className="drive-state-card">
                <p className="drive-state-text">⚠️ {state.error}</p>
                <LiquidButton size="sm" variant="glass" onClick={refresh}>重试</LiquidButton>
              </LiquidGlass>
            ) : displayItems.length === 0 ? (
              <LiquidGlass variant="blur" interactive={false} className="drive-state-card">
                <span className="drive-state-icon"><FolderIcon size={40} /></span>
                <p className="drive-state-text">
                  {isSearching ? '未找到匹配的文件' : '网盘为空，点击上方按钮上传文件'}
                </p>
              </LiquidGlass>
            ) : state.viewMode === 'list' ? (
              <DriveListView
                items={displayItems}
                selectedId={state.selectedId}
                sortField={state.sort.field}
                sortDirection={state.sort.direction}
                onSortChange={(field) => {
                  const direction = state.sort.field === field && state.sort.direction === 'asc' ? 'desc' : 'asc'
                  dispatch({ type: 'SET_SORT', payload: { field, direction } })
                }}
                onFolderClick={navigateToFolder}
                onPreview={handlePreview}
                onDownload={startDownload}
                onRename={(item) => dispatch({ type: 'SET_RENAME_ITEM', payload: item })}
                onDelete={(item) => dispatch({ type: 'SET_DELETE_ITEM', payload: item })}
                onSelect={handleSelect}
                onNewFolder={openNewFolder}
                onUpload={openUpload}
                onRefresh={refresh}
                onSelectAll={() => {
                  if (displayItems.length > 0) {
                    handleSelect(displayItems[0])
                  }
                }}
              />
            ) : (
              <DriveGridView
                items={displayItems}
                selectedId={state.selectedId}
                onFolderClick={navigateToFolder}
                onPreview={handlePreview}
                onDownload={startDownload}
                onRename={(item) => dispatch({ type: 'SET_RENAME_ITEM', payload: item })}
                onDelete={(item) => dispatch({ type: 'SET_DELETE_ITEM', payload: item })}
                onSelect={handleSelect}
                onNewFolder={openNewFolder}
                onUpload={openUpload}
                onRefresh={refresh}
                onSelectAll={() => {
                  if (displayItems.length > 0) {
                    handleSelect(displayItems[0])
                  }
                }}
              />
            )}

            {/* 翻页控件 */}
            {!isSearching && (
              <>
                <Pagination
                  page={state.page}
                  totalPages={state.totalPages}
                  onPageChange={(p) => fetchItems(currentParentId, p)}
                />
                <div style={{ textAlign: 'center', marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
                  第 {state.page}/{state.totalPages} 页，共 {state.total} 项
                </div>
              </>
            )}
          </LiquidGlass>
        </div>

        {/* Detail Panel — Desktop only */}
        {isDesktop && (
          <DriveDetailPanel
            item={selectedItem}
            onClose={() => handleSelect(null)}
            onDownload={startDownload}
            onRename={(item) => dispatch({ type: 'SET_RENAME_ITEM', payload: item })}
            onDelete={(item) => dispatch({ type: 'SET_DELETE_ITEM', payload: item })}
            onPreview={handlePreview}
          />
        )}

        {/* Mobile Bottom Navigation */}
        {isMobile && (
          <MobileNav activeTab={mobileTab} onTabChange={setMobileTab} />
        )}

        {/* Modal overlays */}
        {state.previewItem && (
          <DrivePreview
            item={state.previewItem}
            onClose={() => dispatch({ type: 'SET_PREVIEW_ITEM', payload: null })}
          />
        )}
        {state.showNewFolder && (
          <NewFolderDialog
            parentId={currentParentId}
            onCreated={() => { refresh(); dispatch({ type: 'TOGGLE_NEW_FOLDER', payload: false }) }}
            onClose={() => dispatch({ type: 'TOGGLE_NEW_FOLDER', payload: false })}
          />
        )}
        {state.renameItem && (
          <RenameDialog
            item={state.renameItem}
            onRenamed={() => { dispatch({ type: 'SET_RENAME_ITEM', payload: null }); refresh() }}
            onClose={() => dispatch({ type: 'SET_RENAME_ITEM', payload: null })}
          />
        )}
        {state.deleteItem && (
          <DeleteDialog
            item={state.deleteItem}
            onDeleted={() => { dispatch({ type: 'SET_DELETE_ITEM', payload: null }); refresh() }}
            onClose={() => dispatch({ type: 'SET_DELETE_ITEM', payload: null })}
          />
        )}
      </div>
    </DriveProvider>
  )
}

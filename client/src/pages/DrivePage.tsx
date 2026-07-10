import { useReducer, useEffect, useCallback, useRef } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'
import DriveToolbar from '../components/drive/DriveToolbar'
import DriveListView from '../components/drive/DriveListView'
import DriveGridView from '../components/drive/DriveGridView'
import UploadZone from '../components/drive/UploadZone'
import DrivePreview from '../components/drive/DrivePreview'
import { NewFolderDialog, RenameDialog, DeleteDialog } from '../components/drive/DriveDialogs'
import Pagination from '../components/Pagination'
import api, { ApiError } from '../lib/api'
import { useDownload } from '../contexts/DownloadContext'
import type { DriveItem, Breadcrumb, DriveListResponse } from '../types/drive'

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
  viewMode: 'list' | 'grid'
  showUpload: boolean
  showNewFolder: boolean
  previewItem: DriveItem | null
  deleteItem: DriveItem | null
  renameItem: DriveItem | null
  syncing: boolean
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
  | { type: 'SET_VIEW_MODE'; payload: 'list' | 'grid' }
  | { type: 'TOGGLE_UPLOAD'; payload: boolean }
  | { type: 'TOGGLE_NEW_FOLDER'; payload: boolean }
  | { type: 'SET_PREVIEW_ITEM'; payload: DriveItem | null }
  | { type: 'SET_DELETE_ITEM'; payload: DriveItem | null }
  | { type: 'SET_RENAME_ITEM'; payload: DriveItem | null }
  | { type: 'SET_SYNCING'; payload: boolean }

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
      }
    case 'NAVIGATE_TO_BREADCRUMB':
      return {
        ...state,
        breadcrumbs: state.breadcrumbs.slice(0, action.payload + 1),
        searchQuery: '',
        searchResults: null,
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
    default:
      return state
  }
}

export default function DrivePage() {
  const [state, dispatch] = useReducer(driveReducer, initialState)
  const { startDownload } = useDownload()
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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
    try {
      await api.post('/drive/sync')
      refresh()
    } catch {
      // ignore sync errors silently
    } finally {
      dispatch({ type: 'SET_SYNCING', payload: false })
    }
  }, [refresh])

  // 切换视图模式
  const toggleView = useCallback(() => {
    dispatch({ type: 'SET_VIEW_MODE', payload: state.viewMode === 'list' ? 'grid' : 'list' })
  }, [state.viewMode])

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

  // 计算显示的文件列表
  const displayItems = state.searchResults !== null ? state.searchResults : state.items
  const isSearching = state.searchResults !== null

  return (
    <div className="page container drive-page">
      <LiquidGlass variant="blur" className="page-card" style={{ padding: '24px' }}>
        <DriveToolbar
          breadcrumbs={state.breadcrumbs}
          searchQuery={state.searchQuery}
          searching={state.searching}
          searchResultCount={state.searchResults?.length ?? null}
          viewMode={state.viewMode}
          onSearch={(query) => dispatch({ type: 'SET_SEARCH_QUERY', payload: query })}
          onNavigate={navigateToBreadcrumb}
          onToggleView={toggleView}
          onNewFolder={openNewFolder}
          onUpload={openUpload}
          onSync={handleSync}
          syncing={state.syncing}
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
          <LiquidGlass variant="blur" className="drive-state-card">
            <span className="drive-state-icon">☁️</span>
            <p className="drive-state-text">
              {isSearching ? '未找到匹配的文件' : '网盘为空，点击上方按钮上传文件'}
            </p>
          </LiquidGlass>
        ) : state.viewMode === 'list' ? (
          <DriveListView
            items={displayItems}
            onFolderClick={navigateToFolder}
            onPreview={handlePreview}
            onDownload={startDownload}
            onRename={(item) => dispatch({ type: 'SET_RENAME_ITEM', payload: item })}
            onDelete={(item) => dispatch({ type: 'SET_DELETE_ITEM', payload: item })}
          />
        ) : (
          <DriveGridView
            items={displayItems}
            onFolderClick={navigateToFolder}
            onPreview={handlePreview}
            onDownload={startDownload}
            onRename={(item) => dispatch({ type: 'SET_RENAME_ITEM', payload: item })}
            onDelete={(item) => dispatch({ type: 'SET_DELETE_ITEM', payload: item })}
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
  )
}

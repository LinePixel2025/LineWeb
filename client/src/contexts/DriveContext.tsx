import { createContext, useContext, useReducer, useCallback, useMemo, type ReactNode } from 'react'
import type {
  Breadcrumb,
  TabItem,
  FavoriteItem,
  DriveContextState,
  DriveContextType,
  ViewMode,
  SortOption,
  CategoryFilter,
  DriveItem,
} from '../types/drive'

const FAVORITES_KEY = 'lineweb_favorites'

type DriveAction =
  | { type: 'NAVIGATE_TO'; path: Breadcrumb[] }
  | { type: 'NAVIGATE_TO_FOLDER'; folderId: number | null; folderName: string }
  | { type: 'NAVIGATE_TO_BREADCRUMB'; index: number }
  | { type: 'OPEN_TAB'; tab: TabItem }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SET_ACTIVE_TAB'; tabId: string }
  | { type: 'SELECT_FILE'; fileId: number; multiSelect: boolean }
  | { type: 'SELECT_ALL'; fileIds: number[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_FAVORITES'; favorites: FavoriteItem[] }
  | { type: 'ADD_FAVORITE'; favorite: FavoriteItem }
  | { type: 'REMOVE_FAVORITE'; folderId: number }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'SET_SORT'; sort: SortOption }
  | { type: 'SET_CATEGORY_FILTER'; filter: CategoryFilter }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'SET_SEARCH_RESULTS'; results: DriveItem[] | null }
  | { type: 'SET_SEARCHING'; searching: boolean }
  | { type: 'REFRESH_FILES' }

let tabCounter = 0

function loadFavorites(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveFavorites(favorites: FavoriteItem[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
}

function createTab(folderId: number | null, folderName: string, path: Breadcrumb[]): TabItem {
  return {
    id: `tab-${++tabCounter}`,
    folderId,
    folderName,
    path,
  }
}

const defaultTab = createTab(null, '根目录', [{ id: null, name: '根目录' }])

const initialState: DriveContextState = {
  currentPath: [{ id: null, name: '根目录' }],
  tabs: [defaultTab],
  activeTabId: defaultTab.id,
  selectedFiles: [],
  favorites: loadFavorites(),
  viewMode: 'list',
  sort: { field: 'name', direction: 'asc' },
  categoryFilter: 'all',
  searchQuery: '',
  searchResults: null,
  searching: false,
}

function driveReducer(state: DriveContextState, action: DriveAction): DriveContextState {
  switch (action.type) {
    case 'NAVIGATE_TO':
      return {
        ...state,
        currentPath: action.path,
        selectedFiles: [],
        searchResults: null,
        searchQuery: '',
      }

    case 'NAVIGATE_TO_FOLDER': {
      const newPath = action.folderId === null
        ? [{ id: null, name: '根目录' }]
        : [...state.currentPath, { id: action.folderId, name: action.folderName }]
      return {
        ...state,
        currentPath: newPath,
        selectedFiles: [],
        searchResults: null,
        searchQuery: '',
      }
    }

    case 'NAVIGATE_TO_BREADCRUMB': {
      const newPath = state.currentPath.slice(0, action.index + 1)
      return {
        ...state,
        currentPath: newPath,
        selectedFiles: [],
        searchResults: null,
        searchQuery: '',
      }
    }

    case 'OPEN_TAB': {
      const exists = state.tabs.find(t => t.id === action.tab.id)
      if (exists) {
        return { ...state, activeTabId: action.tab.id }
      }
      return {
        ...state,
        tabs: [...state.tabs, action.tab],
        activeTabId: action.tab.id,
        currentPath: action.tab.path,
        selectedFiles: [],
      }
    }

    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex(t => t.id === action.tabId)
      if (idx === -1) return state
      const newTabs = state.tabs.filter(t => t.id !== action.tabId)
      if (newTabs.length === 0) {
        const fallback = createTab(null, '根目录', [{ id: null, name: '根目录' }])
        return {
          ...state,
          tabs: [fallback],
          activeTabId: fallback.id,
          currentPath: fallback.path,
          selectedFiles: [],
        }
      }
      const newActiveId = state.activeTabId === action.tabId
        ? newTabs[Math.min(idx, newTabs.length - 1)].id
        : state.activeTabId
      const activeTab = newTabs.find(t => t.id === newActiveId)!
      return {
        ...state,
        tabs: newTabs,
        activeTabId: newActiveId,
        currentPath: activeTab.path,
        selectedFiles: [],
      }
    }

    case 'SET_ACTIVE_TAB': {
      const tab = state.tabs.find(t => t.id === action.tabId)
      if (!tab) return state
      return {
        ...state,
        activeTabId: action.tabId,
        currentPath: tab.path,
        selectedFiles: [],
      }
    }

    case 'SELECT_FILE': {
      if (action.multiSelect) {
        const exists = state.selectedFiles.includes(action.fileId)
        return {
          ...state,
          selectedFiles: exists
            ? state.selectedFiles.filter(id => id !== action.fileId)
            : [...state.selectedFiles, action.fileId],
        }
      }
      return {
        ...state,
        selectedFiles: [action.fileId],
      }
    }

    case 'SELECT_ALL':
      return { ...state, selectedFiles: action.fileIds }

    case 'CLEAR_SELECTION':
      return { ...state, selectedFiles: [] }

    case 'SET_FAVORITES':
      return { ...state, favorites: action.favorites }

    case 'ADD_FAVORITE': {
      if (state.favorites.some(f => f.folderId === action.favorite.folderId)) {
        return state
      }
      const newFavorites = [...state.favorites, action.favorite]
      saveFavorites(newFavorites)
      return { ...state, favorites: newFavorites }
    }

    case 'REMOVE_FAVORITE': {
      const newFavorites = state.favorites.filter(f => f.folderId !== action.folderId)
      saveFavorites(newFavorites)
      return { ...state, favorites: newFavorites }
    }

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode }

    case 'SET_SORT':
      return { ...state, sort: action.sort }

    case 'SET_CATEGORY_FILTER':
      return { ...state, categoryFilter: action.filter }

    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.query }

    case 'SET_SEARCH_RESULTS':
      return { ...state, searchResults: action.results }

    case 'SET_SEARCHING':
      return { ...state, searching: action.searching }

    case 'REFRESH_FILES':
      return { ...state }

    default:
      return state
  }
}

const DriveContext = createContext<DriveContextType | null>(null)

export function DriveProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(driveReducer, initialState)

  const navigateTo = useCallback((path: Breadcrumb[]) => {
    dispatch({ type: 'NAVIGATE_TO', path })
  }, [])

  const navigateToFolder = useCallback((folderId: number | null, folderName: string) => {
    dispatch({ type: 'NAVIGATE_TO_FOLDER', folderId, folderName })
  }, [])

  const navigateToBreadcrumb = useCallback((index: number) => {
    dispatch({ type: 'NAVIGATE_TO_BREADCRUMB', index })
  }, [])

  const openTab = useCallback((folderId: number | null, folderName: string) => {
    const path = folderId === null
      ? [{ id: null, name: '根目录' }]
      : [...[{ id: null, name: '根目录' } as Breadcrumb], { id: folderId, name: folderName }]
    const tab = createTab(folderId, folderName, path)
    dispatch({ type: 'OPEN_TAB', tab })
  }, [])

  const closeTab = useCallback((tabId: string) => {
    dispatch({ type: 'CLOSE_TAB', tabId })
  }, [])

  const setActiveTab = useCallback((tabId: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', tabId })
  }, [])

  const selectFile = useCallback((fileId: number, multiSelect = false) => {
    dispatch({ type: 'SELECT_FILE', fileId, multiSelect })
  }, [])

  const selectAll = useCallback((fileIds: number[]) => {
    dispatch({ type: 'SELECT_ALL', fileIds })
  }, [])

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' })
  }, [])

  const addFavorite = useCallback((folderId: number, folderName: string) => {
    const favorite: FavoriteItem = {
      id: `fav-${folderId}`,
      folderId,
      folderName,
      order: Date.now(),
    }
    dispatch({ type: 'ADD_FAVORITE', favorite })
  }, [])

  const removeFavorite = useCallback((folderId: number) => {
    dispatch({ type: 'REMOVE_FAVORITE', folderId })
  }, [])

  const reorderFavorites = useCallback((favorites: FavoriteItem[]) => {
    saveFavorites(favorites)
    dispatch({ type: 'SET_FAVORITES', favorites })
  }, [])

  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_VIEW_MODE', mode })
  }, [])

  const setSort = useCallback((sort: SortOption) => {
    dispatch({ type: 'SET_SORT', sort })
  }, [])

  const setCategoryFilter = useCallback((filter: CategoryFilter) => {
    dispatch({ type: 'SET_CATEGORY_FILTER', filter })
  }, [])

  const setSearchQuery = useCallback((query: string) => {
    dispatch({ type: 'SET_SEARCH_QUERY', query })
  }, [])

  const refreshFiles = useCallback(() => {
    dispatch({ type: 'REFRESH_FILES' })
  }, [])

  const value = useMemo<DriveContextType>(() => ({
    state,
    navigateTo,
    navigateToFolder,
    navigateToBreadcrumb,
    openTab,
    closeTab,
    setActiveTab,
    selectFile,
    selectAll,
    clearSelection,
    addFavorite,
    removeFavorite,
    reorderFavorites,
    setViewMode,
    setSort,
    setCategoryFilter,
    setSearchQuery,
    refreshFiles,
  }), [
    state,
    navigateTo,
    navigateToFolder,
    navigateToBreadcrumb,
    openTab,
    closeTab,
    setActiveTab,
    selectFile,
    selectAll,
    clearSelection,
    addFavorite,
    removeFavorite,
    reorderFavorites,
    setViewMode,
    setSort,
    setCategoryFilter,
    setSearchQuery,
    refreshFiles,
  ])

  return (
    <DriveContext.Provider value={value}>
      {children}
    </DriveContext.Provider>
  )
}

export function useDrive() {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDrive must be used within DriveProvider')
  return ctx
}

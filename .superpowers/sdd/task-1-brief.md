# Task 1: 创建DriveContext状态管理

## 项目上下文
这是网盘前端界面重构项目的第一步。项目采用React 19 + TypeScript + Vite技术栈，使用Liquid Glass设计语言。

## 任务目标
创建DriveContext状态管理Context，用于管理网盘的全局状态，包括路径、标签页、选择、收藏夹、视图模式等。

## 文件列表
- Create: `client/src/contexts/DriveContext.tsx`
- Modify: `client/src/types/drive.ts`
- Test: `client/src/contexts/__tests__/DriveContext.test.tsx`

## 接口定义
Produces: `DriveContextType` - 包含状态和操作方法的Context类型

## 详细步骤

### Step 1: 扩展drive.ts类型定义

在 `client/src/types/drive.ts` 文件末尾新增以下类型定义：

```typescript
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
  // 路径操作
  navigateTo: (path: Breadcrumb[]) => void
  navigateToFolder: (folderId: number | null, folderName: string) => void
  navigateToBreadcrumb: (index: number) => void
  // 标签操作
  openTab: (folderId: number | null, folderName: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  // 选择操作
  selectFile: (fileId: number, multiSelect?: boolean) => void
  selectAll: () => void
  clearSelection: () => void
  // 收藏操作
  addFavorite: (folderId: number, folderName: string) => void
  removeFavorite: (folderId: number) => void
  reorderFavorites: (favorites: FavoriteItem[]) => void
  // 视图操作
  setViewMode: (mode: ViewMode) => void
  setSort: (sort: SortOption) => void
  setCategoryFilter: (filter: CategoryFilter) => void
  setSearchQuery: (query: string) => void
  // 文件操作
  refreshFiles: () => void
}
```

### Step 2: 创建DriveContext.tsx

创建完整的 `client/src/contexts/DriveContext.tsx` 文件，包含：
- DriveAction类型定义
- initialState初始状态
- driveReducer reducer函数
- DriveContext Context创建
- DriveProvider Provider组件
- useDrive Hook

### Step 3: 创建测试文件

创建 `client/src/contexts/__tests__/DriveContext.test.tsx` 文件，包含以下测试用例：
- 初始化默认状态
- 导航到文件夹
- 打开新标签页
- 多选文件
- 添加和删除收藏

### Step 4: 运行测试验证

Run: `cd client && npm test -- --watchAll=false DriveContext.test.tsx`
Expected: 所有测试通过

### Step 5: 提交代码

```bash
git add client/src/contexts/DriveContext.tsx client/src/types/drive.ts client/src/contexts/__tests__/DriveContext.test.tsx
git commit -m "feat(drive): add DriveContext state management"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 支持亮色/暗色/跟随系统三种主题模式
- 响应式断点：桌面端≥1024px、平板端768-1023px、移动端<768px
- 所有现有功能必须正常工作
- 新增功能按设计文档实现

## 注意事项
- 使用React Context + useReducer模式
- 收藏夹数据需要持久化到localStorage
- 所有操作方法需要使用useCallback包装
- 测试需要使用@testing-library/react
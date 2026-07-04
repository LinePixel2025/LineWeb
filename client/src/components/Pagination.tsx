import { memo } from 'react'

export interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

/**
 * 通用分页组件 — 显示带省略号的翻页按钮
 * 默认显示当前页前后各 2 页 + 首尾页，中间用 … 省略
 */
const Pagination = memo(function Pagination({
  page,
  totalPages,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null

  const pages: (number | 0)[] = []
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, page + 2)

  if (start > 1) {
    pages.push(1)
    if (start > 2) pages.push(0)
  }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push(0)
    pages.push(totalPages)
  }

  return (
    <div className="admin-pagination">
      {pages.map((p, i) =>
        p === 0 ? (
          <span key={`ellipsis-${i}`} className="admin-ellipsis">…</span>
        ) : (
          <button
            key={p}
            className={`admin-page-btn${p === page ? ' admin-page-btn--active' : ''}`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        )
      )}
    </div>
  )
})

export default Pagination

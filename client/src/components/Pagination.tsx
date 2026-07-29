import { memo } from 'react'

export interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

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
    <div className="gh-pagination">
      {pages.map((p, i) =>
        p === 0 ? (
          <span key={`ellipsis-${i}`} style={{ padding: '0 4px', color: 'var(--gh-text-tertiary)' }}>…</span>
        ) : (
          <button
            key={p}
            className={`gh-pagination-btn${p === page ? ' gh-pagination-btn--active' : ''}`}
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

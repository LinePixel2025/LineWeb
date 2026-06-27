export function parsePagination(query: qs.ParsedQs) {
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(query.limit as string) || 10))
  const skip = (page - 1) * limit
  return { page, limit, skip }
}

export function parseId(idStr: string): number | null {
  const id = parseInt(idStr)
  return isNaN(id) ? null : id
}

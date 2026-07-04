export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(query.limit as string) || 10))
  const skip = (page - 1) * limit
  return { page, limit, skip }
}

export function parseId(idStr: string): number | null {
  const id = parseInt(idStr)
  return isNaN(id) ? null : id
}

/** 从 catch 子句中安全提取错误消息 */
export function getErrorMessage(err: unknown, fallback = '未知错误'): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return fallback
}

/** 从 catch 子句中安全提取错误状态码 */
export function getErrorStatus(err: unknown, fallback = 500): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: unknown }).status
    if (typeof s === 'number') return s
  }
  return fallback
}

/**
 * 统一错误处理工具
 * 用于异步操作的错误日志记录
 */

/**
 * 处理异步错误并记录日志
 * @param err 捕获的错误
 * @param context 错误上下文描述
 */
export function handleAsyncError(err: unknown, context: string): void {
  if (err instanceof Error) {
    console.error(`[${context}]`, err.message)
  } else {
    console.error(`[${context}]`, String(err))
  }
}

/**
 * 安全地执行异步操作并记录错误
 * @param fn 异步操作函数
 * @param context 错误上下文描述
 * @param fallback 操作失败时的返回值
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  context: string,
  fallback?: T,
): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    handleAsyncError(err, context)
    return fallback
  }
}

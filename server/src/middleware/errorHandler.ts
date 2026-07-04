import { Request, Response, NextFunction } from 'express'

/**
 * 自定义应用错误 — 携带 HTTP 状态码
 */
export class AppError extends Error {
  status: number
  constructor(message: string, status: number = 500) {
    super(message)
    this.name = 'AppError'
    this.status = status
  }
}

/**
 * 全局错误处理中间件
 * 捕获所有未被路由 try-catch 捕获的异常
 * 避免重复的 res.status(500).json() 模板代码
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  // 已知的应用错误
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message })
    return
  }

  // Zod 校验错误（未捕获的）
  if (err.name === 'ZodError') {
    res.status(400).json({ error: '输入数据无效' })
    return
  }

  // Prisma 错误
  if (err.name === 'PrismaClientKnownRequestError') {
    res.status(400).json({ error: '数据库操作失败' })
    return
  }

  // 未知错误 — 生产环境不暴露详情
  console.error('[ErrorHandler]', err)
  res.status(500).json({ error: '服务器内部错误' })
}

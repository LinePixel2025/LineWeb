import { Request, Response, NextFunction } from 'express'

/**
 * 包裹 async Express 路由处理器，将 Promise 拒绝自动转发给 next(err)。
 * Express 4 不会自动捕获 async 函数中的异常，使用此函数确保错误被 errorHandler 正确处理。
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

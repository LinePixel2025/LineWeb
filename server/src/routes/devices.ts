import { Router, Request, Response } from 'express'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { getDevices, getAllDevices, getOnlineCount, getTotalCount } from '../services/deviceTracker.js'

const router = Router()

router.use(authenticate, requireAdmin)

router.get('/', (_req: Request, res: Response) => {
  const devices = getDevices()
  const all = getAllDevices()
  res.json({
    online: devices,
    onlineCount: getOnlineCount(),
    totalCount: getTotalCount(),
    allTime: all,
  })
})

export default router

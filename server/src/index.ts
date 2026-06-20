import express from 'express'
import cors from 'cors'
import { config } from './config/index.js'
import authRoutes from './routes/auth.js'
import postRoutes from './routes/posts.js'
import bingRoutes from './routes/bing.js'

const app = express()

app.use(cors({ origin: config.corsOrigin, credentials: true }))
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/posts', postRoutes)
app.use('/api/bing-wallpaper', bingRoutes)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(config.port, () => {
  console.log(`✦ LineWeb Server running on http://localhost:${config.port}`)
})

export default app

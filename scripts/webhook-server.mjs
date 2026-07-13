import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const PORT = process.env.WEBHOOK_PORT || 9000
const SECRET = process.env.WEBHOOK_SECRET

if (!SECRET) {
  console.error('[webhook] 错误: WEBHOOK_SECRET 未设置')
  process.exit(1)
}

let deploying = false

function verifySignature(payload, signature) {
  const hmac = crypto.createHmac('sha256', SECRET)
  hmac.update(payload)
  const digest = 'sha256=' + hmac.digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
  } catch {
    return false
  }
}

function runDeploy() {
  if (deploying) {
    console.log('[webhook] 已有部署进行中，跳过')
    return
  }
  deploying = true
  console.log('[webhook] 开始执行 deploy.sh...')

  const proc = spawn('/bin/bash', ['/opt/lineweb/scripts/deploy.sh'], {
    detached: true,
    stdio: 'inherit',
  })

  proc.on('close', (code) => {
    deploying = false
    console.log(`[webhook] deploy.sh 退出，code=${code}`)
  })

  proc.on('error', (err) => {
    deploying = false
    console.error(`[webhook] deploy.sh 执行失败: ${err.message}`)
  })
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/github-webhook') {
    res.writeHead(404)
    res.end()
    return
  }

  const signature = req.headers['x-hub-signature-256'] || ''
  let body = ''

  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    if (!verifySignature(body, signature)) {
      console.log('[webhook] 签名验证失败')
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    console.log('[webhook] 收到 GitHub push 事件')
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('OK')
    runDeploy()
  })
})

server.listen(PORT, () => {
  console.log(`[webhook] 监听端口 ${PORT}`)
})

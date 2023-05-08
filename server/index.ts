import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import { config } from './config.js'
import { join } from 'path'
import compression from 'compression'
import { debugLog } from './debug.js'
import { listenWSSConnection } from './ws/wss-lite.js'
import { appRouter, onWsMessage } from './app/app.js'
import { startSession, closeSession } from './app/session.js'
import open from 'open'
import { print } from 'listening-on'

const log = debugLog('index.ts')
log.enabled = true

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })
listenWSSConnection({
  wss,
  onConnection: ws => {
    log('attach ws:', ws.ws.protocol)
    startSession(ws)
  },
  onClose: (ws, code, reason) => {
    log('close ws:', ws.ws.protocol, code, String(reason))
    closeSession(ws)
  },
  onMessage: onWsMessage,
})

if (!config.behind_proxy) {
  app.use(compression())
}
if (config.development) {
  app.use('/js', express.static(join('dist', 'client')))
} else {
  app.use('/js', express.static('build'))
}
app.use(express.static('public'))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(appRouter)

const port = config.port
server.listen(port, () => {
  print({ port })
  if (config.auto_open) {
    open(`http://localhost:${port}`)
  }
})

import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { loadConfig } from './config.js'
import { SessionManager } from './session.js'
import { registerWebhook } from './webhook.js'
import { startScheduler } from './scheduler.js'

const cfg = loadConfig()
const app = Fastify({ logger: true })

await app.register(cors, { origin: true })

app.get('/health', async () => ({
  status: 'ok',
  agent: 'sol-adm',
  timestamp: new Date().toISOString(),
}))

const session = new SessionManager(cfg.supabaseUrl, cfg.supabaseServiceKey, cfg.solCaixaId, cfg.masterPhone)
await registerWebhook(app, session, cfg)
await startScheduler(cfg)

await app.listen({ port: cfg.port, host: '0.0.0.0' })
console.log(`Sol rodando na porta ${cfg.port}`)

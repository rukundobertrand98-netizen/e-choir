import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { config as loadEnv } from 'dotenv'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from './db.js'
import { errorHandler, AppError } from './errors.js'
import { requireAuth, requirePlatformAdmin } from './auth.js'
import { authRouter } from './routes/auth.js'
import { choirRouter } from './routes/choirs.js'
import { directorRouter } from './routes/director.js'
import { financeRouter } from './routes/finance.js'
import { platformRouter } from './routes/platform.js'
import { choirAnnouncementRouter, supportRouter } from './routes/support.js'

const envPath = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
].find(existsSync)
if (envPath) loadEnv({ path: envPath })
process.env.NODE_ENV ??= 'development'

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .parse(process.env)

const app = express()
app.disable('x-powered-by')
app.use(helmet())
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === env.CLIENT_ORIGIN) {
        callback(null, true)
        return
      }
      callback(new AppError('Request origin is not allowed.', 403))
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use((req, res, next) => {
  const startedAt = Date.now()
  res.on('finish', () => {
    console.info('http_request', {
      method: req.method,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    })
  })
  next()
})

app.get('/api/v1/health', async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
})
const api = express.Router()
api.use('/auth/login', authLimiter)
api.use('/auth/register', authLimiter)
api.use('/auth', authRouter)
api.use('/platform', requireAuth, requirePlatformAdmin, platformRouter)
api.use('/support', requireAuth, supportRouter)
api.use('/choirs/:choirId', requireAuth, choirRouter)
api.use('/choirs/:choirId/director', requireAuth, directorRouter)
api.use('/choirs/:choirId/finance', requireAuth, financeRouter)
api.use('/choirs/:choirId/announcements', requireAuth, choirAnnouncementRouter)
app.use('/api/v1', api)
app.use((_req, _res, next) => next(new AppError('Route not found.', 404)))
app.use(errorHandler)

const server = app.listen(env.PORT, () => {
  console.info(`E-Choir API listening on port ${env.PORT}`)
})

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

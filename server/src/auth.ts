import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { prisma } from './db.js'
import { AppError } from './errors.js'

export interface AuthContext {
  userId: string
  sessionId: string
}

declare global {
  namespace Express {
    interface Locals {
      auth: AuthContext
    }
  }
}

const cookieName = 'echoir_session'
const configuredTtl = Number(process.env.SESSION_TTL_DAYS ?? 7)
const sessionTtlDays =
  Number.isFinite(configuredTtl) && configuredTtl >= 1 && configuredTtl <= 30
    ? configuredTtl
    : 7

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: sessionTtlDays * 24 * 60 * 60 * 1000,
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string, res: Response) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000)
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  })
  res.cookie(cookieName, token, cookieOptions())
}

export async function revokeSession(req: Request, res: Response) {
  const token = req.cookies?.[cookieName]
  if (typeof token === 'string') {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    })
  }
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.cookies?.[cookieName]
    if (typeof token !== 'string') {
      throw new AppError('Authentication required.', 401)
    }

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        status: true,
        user: { select: { accountStatus: true, mustChangePassword: true } },
      },
    })

    if (
      !session ||
      session.status !== 'ACTIVE' ||
      session.user.accountStatus !== 'ACTIVE' ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new AppError('Your session has expired. Please sign in again.', 401)
    }
    if (
      session.user.mustChangePassword &&
      !['/auth/me', '/auth/password', '/auth/logout'].some((suffix) =>
        req.originalUrl.split('?')[0]?.endsWith(suffix),
      )
    ) {
      throw new AppError('Change your temporary password before continuing.', 403)
    }

    res.locals.auth = { userId: session.userId, sessionId: session.id }
    next()
  } catch (error) {
    next(error)
  }
}

export async function requirePlatformAdmin(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: res.locals.auth.userId },
      select: { platformRole: true, accountStatus: true },
    })
    if (!user || user.accountStatus !== 'ACTIVE') {
      throw new AppError('This account is inactive.', 403)
    }
    if (user.platformRole !== 'SUPER_ADMIN') {
      throw new AppError('Platform administrator access is required.', 403)
    }
    next()
  } catch (error) {
    next(error)
  }
}

export async function rotateSession(req: Request, res: Response) {
  const token = req.cookies?.[cookieName]
  if (typeof token !== 'string') {
    throw new AppError('Authentication required.', 401)
  }
  const oldHash = hashToken(token)
  const oldSession = await prisma.session.findUnique({
    where: { tokenHash: oldHash },
  })
  if (
    !oldSession ||
    oldSession.status !== 'ACTIVE' ||
    oldSession.expiresAt.getTime() <= Date.now()
  ) {
    throw new AppError('Your session has expired. Please sign in again.', 401)
  }

  const newToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000)
  await prisma.$transaction([
    prisma.session.update({
      where: { id: oldSession.id },
      data: { status: 'REVOKED' },
    }),
    prisma.session.create({
      data: {
        userId: oldSession.userId,
        tokenHash: hashToken(newToken),
        expiresAt,
      },
    }),
  ])
  res.cookie(cookieName, newToken, cookieOptions())
  return oldSession.userId
}

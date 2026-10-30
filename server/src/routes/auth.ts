import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { ChoirRole, Language } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db.js'
import { AppError } from '../errors.js'
import { createSession, requireAuth, revokeSession, rotateSession } from '../auth.js'
import { normalizeChoirName, normalizeLoginName } from '../identity.js'

export const authRouter = Router()

const passwordSchema = z.string().min(10).max(128)
const nameSchema = z.string().trim().min(2).max(100).transform((value) => value.replace(/\s+/g, ' '))

authRouter.post('/register', async (req, res, next) => {
  try {
    const input = z
      .object({
        name: nameSchema,
        choirName: z.string().trim().min(2).max(120).transform((value) => value.replace(/\s+/g, ' ')),
        password: passwordSchema,
        language: z.nativeEnum(Language).default(Language.EN),
      })
      .parse(req.body)
    const settings = await prisma.systemSetting.findMany({
      where: { key: { in: ['defaultCurrency', 'defaultTimezone', 'supportedLanguages', 'approvalEnabled'] } },
      select: { key: true, value: true },
    })
    const preferences = new Map(settings.map((setting) => [setting.key, setting.value]))
    const languages = preferences.get('supportedLanguages')
    if (Array.isArray(languages) && !languages.includes(input.language)) {
      throw new AppError('The selected language is not currently supported.', 400)
    }
    const defaultTimezone = preferences.get('defaultTimezone')
    const defaultCurrency = preferences.get('defaultCurrency')
    const passwordHash = await bcrypt.hash(input.password, 12)
    const user = await prisma.$transaction(async (tx) => {
      const choir = await tx.choir.create({
        data: {
          name: input.choirName,
          nameKey: normalizeChoirName(input.choirName),
          timezone: typeof defaultTimezone === 'string' ? defaultTimezone : 'Africa/Kigali',
          currency: typeof defaultCurrency === 'string' ? defaultCurrency : 'RWF',
          status: preferences.get('approvalEnabled') === true ? 'PENDING_APPROVAL' : 'ACTIVE',
        },
      })
      const createdUser = await tx.user.create({
        data: {
          name: input.name,
          passwordHash,
          language: input.language,
        },
      })
      await tx.choirMembership.create({
        data: {
          userId: createdUser.id,
          choirId: choir.id,
          loginName: normalizeLoginName(input.name),
          role: ChoirRole.ADMIN,
        },
      })
      await tx.vocalSection.createMany({
        data: ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name) => ({
          choirId: choir.id,
          name,
        })),
      })
      return createdUser
    })
    await createSession(user.id, res)
    await prisma.securityEvent.create({ data: { userId: user.id, event: 'ACCOUNT_REGISTERED' } })
    res.status(201).json({
      user: { id: user.id, name: user.name, language: user.language, platformRole: user.platformRole },
    })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const input = z
      .object({
        choirName: z.string().trim().min(2).max(120),
        name: nameSchema,
        password: passwordSchema,
      })
      .parse(req.body)
    const choir = await prisma.choir.findUnique({
      where: { nameKey: normalizeChoirName(input.choirName) },
      select: { id: true, status: true },
    })
    const membership = choir
      ? await prisma.choirMembership.findUnique({
          where: {
            choirId_loginName: {
              choirId: choir.id,
              loginName: normalizeLoginName(input.name),
            },
          },
          include: { user: true },
        })
      : null
    const passwordMatches = membership
      ? await bcrypt.compare(input.password, membership.user.passwordHash)
      : false
    const activeChoirMember = choir?.status === 'ACTIVE' && membership?.status === 'ACTIVE'
    const platformAdministrator = membership?.user.platformRole === 'SUPER_ADMIN'
    if (!membership || (!activeChoirMember && !platformAdministrator) || !passwordMatches || membership.user.accountStatus !== 'ACTIVE') {
      await prisma.securityEvent.create({
        data: { userId: membership?.user.id ?? null, event: 'LOGIN_FAILED' },
      })
      throw new AppError('Choir name, full name, or password is incorrect.', 401)
    }
    await createSession(membership.user.id, res)
    await prisma.securityEvent.create({ data: { userId: membership.user.id, event: 'LOGIN_SUCCEEDED' } })
    res.json({
      user: {
        id: membership.user.id,
        name: membership.user.name,
        language: membership.user.language,
        platformRole: membership.user.platformRole,
        mustChangePassword: membership.user.mustChangePassword,
      },
    })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/refresh', async (req, res, next) => {
  try {
    await rotateSession(req, res)
    res.json({ refreshed: true })
  } catch (error) {
    next(error)
  }
})

authRouter.patch('/preferences', requireAuth, async (req, res, next) => {
  try {
    const { language } = z.object({ language: z.nativeEnum(Language) }).parse(req.body)
    const supported = await prisma.systemSetting.findUnique({ where: { key: 'supportedLanguages' }, select: { value: true } })
    if (Array.isArray(supported?.value) && !supported.value.includes(language)) {
      throw new AppError('The selected language is not currently supported.', 400)
    }
    const user = await prisma.user.update({
      where: { id: res.locals.auth.userId },
      data: { language },
      select: { id: true, language: true },
    })
    res.json({ user })
  } catch (error) {
    next(error)
  }
})

authRouter.patch('/password', requireAuth, async (req, res, next) => {
  try {
    const input = z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: passwordSchema,
      })
      .parse(req.body)
    const user = await prisma.user.findUnique({
      where: { id: res.locals.auth.userId },
      select: { id: true, passwordHash: true },
    })
    if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      await prisma.securityEvent.create({
        data: { userId: res.locals.auth.userId, event: 'PASSWORD_CHANGE_FAILED' },
      })
      throw new AppError('Current password is incorrect.', 403)
    }
    const passwordHash = await bcrypt.hash(input.newPassword, 12)
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
      prisma.session.updateMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          NOT: { id: res.locals.auth.sessionId },
        },
        data: { status: 'REVOKED' },
      }),
    ])
    await prisma.securityEvent.create({ data: { userId: user.id, event: 'PASSWORD_CHANGED' } })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await revokeSession(req, res)
    await prisma.securityEvent.create({ data: { userId: res.locals.auth.userId, event: 'LOGOUT' } })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

authRouter.get('/me', requireAuth, async (_req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: res.locals.auth.userId },
      select: {
        id: true,
        name: true,
        language: true,
        platformRole: true,
        mustChangePassword: true,
        memberships: {
          where: { status: 'ACTIVE' },
          include: { choir: true, section: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    })
    if (!user) throw new AppError('User account no longer exists.', 401)
    res.json({ user })
  } catch (error) {
    next(error)
  }
})

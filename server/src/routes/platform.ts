import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { AccountStatus, ChoirStatus, PlatformRole, Prisma, TicketPriority, TicketStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db.js'
import { AppError } from '../errors.js'
import { csvCell } from '../csv.js'

export const platformRouter = Router()

const pageQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
const financeFilter = z.object({
  choirId: z.string().uuid().optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  status: z.enum(['PAID', 'PENDING', 'PARTIALLY_PAID']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, 'The start date must be before the end date.')
const choirFilter = pageQuery.extend({ status: z.nativeEnum(ChoirStatus).optional() })
const dateFilter = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })

function financeWhere(input: z.infer<typeof financeFilter>): Prisma.FinancialRecordWhereInput {
  return {
    ...(input.choirId ? { choirId: input.choirId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.from || input.to ? { transactionDate: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
  }
}

platformRouter.get('/dashboard', async (_req, res, next) => {
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const [
      totalChoirs, activeChoirs, suspendedChoirs, pendingChoirs, totalUsers, newUsers, memberships,
      songCount, rehearsalCount, financeTotals, recentActivity,
      choirGrowth, userGrowth,
    ] = await Promise.all([
      prisma.choir.count(),
      prisma.choir.count({ where: { status: 'ACTIVE' } }),
      prisma.choir.count({ where: { status: 'SUSPENDED' } }),
      prisma.choir.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.choirMembership.count({ where: { status: 'ACTIVE' } }),
      prisma.song.count(),
      prisma.rehearsal.count(),
      prisma.financialRecord.groupBy({
        by: ['currency', 'type', 'status'],
        _sum: { amount: true },
        orderBy: { currency: 'asc' },
      }),
      prisma.platformAudit.findMany({
        take: 12,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, name: true } } },
      }),
      prisma.$queryRaw<Array<{ month: Date; total: bigint }>>`
        SELECT date_trunc('month', "createdAt") AS month, count(*)::bigint AS total
        FROM "Choir" WHERE "createdAt" >= now() - interval '12 months'
        GROUP BY date_trunc('month', "createdAt") ORDER BY month`,
      prisma.$queryRaw<Array<{ month: Date; total: bigint }>>`
        SELECT date_trunc('month', "createdAt") AS month, count(*)::bigint AS total
        FROM "User" WHERE "createdAt" >= now() - interval '12 months'
        GROUP BY date_trunc('month', "createdAt") ORDER BY month`,
    ])
    res.json({
      stats: {
        totalChoirs, activeChoirs, suspendedChoirs, pendingChoirs, totalUsers, newUsers,
        activeMemberships: memberships, songs: songCount, rehearsals: rehearsalCount,
        financeTotals: financeTotals.map((row) => ({
          currency: row.currency,
          type: row.type,
          status: row.status,
          amount: Number(row._sum.amount ?? 0),
        })),
      },
      activity: recentActivity,
      choirGrowth: choirGrowth.map((row) => ({ month: row.month.toISOString(), total: Number(row.total) })),
      userGrowth: userGrowth.map((row) => ({ month: row.month.toISOString(), total: Number(row.total) })),
      health: { api: 'ok', database: 'ok', uptimeSeconds: Math.floor(process.uptime()), backups: 'not-configured', storage: 'not-configured' },
    })
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/choirs', async (req, res, next) => {
  try {
    const { search, page, pageSize, status } = choirFilter.parse(req.query)
    const where: Prisma.ChoirWhereInput = {
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, ...(z.string().uuid().safeParse(search).success ? [{ id: search }] : [])] } : {}),
      ...(status ? { status } : {}),
    }
    const [total, choirs] = await Promise.all([
      prisma.choir.count({ where }),
      prisma.choir.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { memberships: true } },
          memberships: {
            where: { role: 'ADMIN', status: 'ACTIVE' },
            take: 5,
            include: { user: { select: { id: true, name: true } } },
          },
        },
      }),
    ])
    res.json({ choirs: choirs.map(({ memberships, _count, ...choir }) => ({
      ...choir,
      membershipCount: _count.memberships,
      administrators: memberships.map((item) => item.user),
    })), pagination: { page, pageSize, total } })
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/choirs/:choirId', async (req, res, next) => {
  try {
    const choirId = z.string().uuid().parse(req.params.choirId)
    const input = z.object({
      status: z.nativeEnum(ChoirStatus),
      reason: z.string().trim().min(5).max(1000),
    }).parse(req.body)
    const choir = await prisma.$transaction(async (tx) => {
      const existing = await tx.choir.findUnique({ where: { id: choirId }, select: { id: true } })
      if (!existing) throw new AppError('Choir not found.', 404)
      const updated = await tx.choir.update({
        where: { id: choirId },
        data: { status: input.status, statusReason: input.reason, statusChangedAt: new Date() },
        select: { id: true, name: true, status: true, statusReason: true, statusChangedAt: true },
      })
      await tx.platformAudit.create({
        data: { actorId: res.locals.auth.userId, action: `CHOIR_${input.status}`, entityType: 'Choir', entityId: choirId, reason: input.reason },
      })
      return updated
    })
    res.json({ choir })
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/users', async (req, res, next) => {
  try {
    const { search, page, pageSize } = pageQuery.parse(req.query)
    const where: Prisma.UserWhereInput = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        ...(z.string().uuid().safeParse(search).success ? [{ id: search }] : []),
        { memberships: { some: { choir: { name: { contains: search, mode: 'insensitive' } } } } },
      ],
    } : {}
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, name: true, language: true, platformRole: true, accountStatus: true, createdAt: true,
          memberships: { select: { role: true, status: true, choir: { select: { id: true, name: true, status: true } } } },
        },
      }),
    ])
    res.json({ users, pagination: { page, pageSize, total } })
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/users/:userId', async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId)
    const input = z.object({
      accountStatus: z.nativeEnum(AccountStatus).optional(),
      platformRole: z.nativeEnum(PlatformRole).optional(),
      reason: z.string().trim().min(5).max(1000),
    }).refine((value) => value.accountStatus !== undefined || value.platformRole !== undefined).parse(req.body)
    if (userId === res.locals.auth.userId && (input.accountStatus === 'SUSPENDED' || input.platformRole === 'USER')) {
      throw new AppError('You cannot deactivate or demote your own administrator account.', 400)
    }
    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id: userId }, select: { platformRole: true, accountStatus: true } })
      if (!existing) throw new AppError('User not found.', 404)
      if (existing.platformRole === 'SUPER_ADMIN' && existing.accountStatus === 'ACTIVE' && (input.platformRole === 'USER' || input.accountStatus === 'SUSPENDED')) {
        const activeAdmins = await tx.user.count({ where: { platformRole: 'SUPER_ADMIN', accountStatus: 'ACTIVE' } })
        if (activeAdmins <= 1) throw new AppError('The platform must retain at least one active super administrator.', 409)
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { ...(input.accountStatus ? { accountStatus: input.accountStatus } : {}), ...(input.platformRole ? { platformRole: input.platformRole } : {}) },
        select: { id: true, name: true, platformRole: true, accountStatus: true },
      })
      if (input.accountStatus === 'SUSPENDED') {
        await tx.session.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'REVOKED' } })
      }
      await tx.platformAudit.create({
        data: {
          actorId: res.locals.auth.userId,
          action: 'USER_ACCESS_UPDATED',
          entityType: 'User',
          entityId: userId,
          reason: input.reason,
          details: { accountStatus: input.accountStatus ?? null, platformRole: input.platformRole ?? null },
        },
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    res.json({ user })
  } catch (error) {
    next(error)
  }
})

platformRouter.post('/users/:userId/password-reset', async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId)
    if (userId === res.locals.auth.userId) throw new AppError('Use your own password settings to change your password.', 400)
    const input = z.object({
      temporaryPassword: z.string().min(10).max(128),
      reason: z.string().trim().min(5).max(1000),
    }).parse(req.body)
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!existing) throw new AppError('User not found.', 404)
    const passwordHash = await bcrypt.hash(input.temporaryPassword, 12)
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true },
      })
      await tx.session.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'REVOKED' } })
      await tx.platformAudit.create({
        data: {
          actorId: res.locals.auth.userId, action: 'USER_PASSWORD_RESET',
          entityType: 'User', entityId: userId, reason: input.reason,
        },
      })
      await tx.securityEvent.create({ data: { userId, event: 'ADMIN_PASSWORD_RESET' } })
    })
    res.status(204).end()
  } catch (error) { next(error) }
})

platformRouter.get('/audit', async (req, res, next) => {
  try {
    const { page, pageSize } = pageQuery.parse(req.query)
    const [total, entries] = await Promise.all([
      prisma.platformAudit.count(),
      prisma.platformAudit.findMany({
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { actor: { select: { id: true, name: true } } },
      }),
    ])
    res.json({ entries, pagination: { page, pageSize, total } })
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/security-events', async (req, res, next) => {
  try {
    const { page, pageSize } = pageQuery.parse(req.query)
    const [total, events] = await Promise.all([
      prisma.securityEvent.count(),
      prisma.securityEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, name: true } } },
      }),
    ])
    res.json({ events, pagination: { page, pageSize, total } })
  } catch (error) { next(error) }
})

platformRouter.get('/staff', async (_req, res, next) => {
  try {
    const staff = await prisma.user.findMany({
      where: { platformRole: 'SUPER_ADMIN', accountStatus: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    res.json({ staff })
  } catch (error) { next(error) }
})

platformRouter.get('/announcements', async (_req, res, next) => {
  try {
    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } }, choirs: { include: { choir: { select: { id: true, name: true } } } } },
    })
    res.json({ announcements })
  } catch (error) { next(error) }
})

platformRouter.post('/announcements', async (req, res, next) => {
  try {
    const input = z.object({
      title: z.string().trim().min(3).max(160),
      body: z.string().trim().min(1).max(10000),
      maintenance: z.boolean().default(false),
      choirIds: z.array(z.string().uuid()).max(500).default([]),
      publish: z.boolean().default(true),
    }).parse(req.body)
    const announcement = await prisma.$transaction(async (tx) => {
      const choirCount = input.choirIds.length ? await tx.choir.count({ where: { id: { in: input.choirIds } } }) : 0
      if (choirCount !== input.choirIds.length) throw new AppError('One or more selected choirs do not exist.', 400)
      const created = await tx.announcement.create({
        data: {
          title: input.title, body: input.body, maintenance: input.maintenance,
          publishedAt: input.publish ? new Date() : null,
          createdById: res.locals.auth.userId,
          choirs: { create: input.choirIds.map((choirId) => ({ choirId })) },
        },
        include: { choirs: { include: { choir: { select: { id: true, name: true } } } } },
      })
      await tx.platformAudit.create({ data: {
        actorId: res.locals.auth.userId, action: 'ANNOUNCEMENT_CREATED', entityType: 'Announcement',
        entityId: created.id, details: { maintenance: input.maintenance, choirIds: input.choirIds },
      } })
      return created
    })
    res.status(201).json({ announcement })
  } catch (error) { next(error) }
})

platformRouter.patch('/announcements/:announcementId', async (req, res, next) => {
  try {
    const announcementId = z.string().uuid().parse(req.params.announcementId)
    const input = z.object({
      title: z.string().trim().min(3).max(160).optional(),
      body: z.string().trim().min(1).max(10000).optional(),
      maintenance: z.boolean().optional(),
      published: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0).parse(req.body)
    const { published, ...changes } = input
    const announcement = await prisma.$transaction(async (tx) => {
      const existing = await tx.announcement.findUnique({ where: { id: announcementId }, select: { id: true } })
      if (!existing) throw new AppError('Announcement not found.', 404)
      const result = await tx.announcement.update({
        where: { id: announcementId },
        data: {
          ...changes,
          ...(published === undefined ? {} : { publishedAt: published ? new Date() : null }),
        },
      })
      await tx.platformAudit.create({ data: {
        actorId: res.locals.auth.userId, action: 'ANNOUNCEMENT_UPDATED', entityType: 'Announcement',
        entityId: announcementId, details: { published: published ?? null },
      } })
      return result
    })
    res.json({ announcement })
  } catch (error) { next(error) }
})

platformRouter.get('/settings', async (_req, res, next) => {
  try {
    const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' }, select: { key: true, value: true, updatedAt: true } })
    res.json({ settings })
  } catch (error) { next(error) }
})

platformRouter.patch('/settings', async (req, res, next) => {
  try {
    const input = z.object({
      defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
      defaultTimezone: z.string().min(1).max(100).optional(),
      supportedLanguages: z.array(z.enum(['EN', 'RW', 'FR'])).min(1).max(3).optional(),
      approvalEnabled: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0).parse(req.body)
    if (input.defaultTimezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: input.defaultTimezone }) }
      catch { throw new AppError('Invalid timezone.', 400) }
    }
    const settings = await prisma.$transaction(async (tx) => {
      const updated = await Promise.all(Object.entries(input).map(([key, value]) => tx.systemSetting.upsert({
        where: { key },
        create: { key, value, updatedById: res.locals.auth.userId },
        update: { value, updatedById: res.locals.auth.userId },
        select: { key: true, value: true, updatedAt: true },
      })))
      await tx.platformAudit.create({ data: {
        actorId: res.locals.auth.userId, action: 'PLATFORM_SETTINGS_UPDATED', entityType: 'SystemSetting',
        entityId: 'platform', details: input,
      } })
      return updated
    })
    res.json({ settings })
  } catch (error) { next(error) }
})

platformRouter.get('/tickets', async (req, res, next) => {
  try {
    const { page, pageSize } = pageQuery.parse(req.query)
    const [total, tickets] = await Promise.all([
      prisma.supportTicket.count(),
      prisma.supportTicket.findMany({
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize,
        include: {
          choir: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          replies: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true } } } },
        },
      }),
    ])
    res.json({ tickets, pagination: { page, pageSize, total } })
  } catch (error) { next(error) }
})

platformRouter.patch('/tickets/:ticketId', async (req, res, next) => {
  try {
    const ticketId = z.string().uuid().parse(req.params.ticketId)
    const input = z.object({
      status: z.nativeEnum(TicketStatus).optional(),
      priority: z.nativeEnum(TicketPriority).optional(),
      assignedToId: z.string().uuid().nullable().optional(),
    }).refine((value) => Object.keys(value).length > 0).parse(req.body)
    if (input.assignedToId) {
      const assignee = await prisma.user.findFirst({ where: { id: input.assignedToId, platformRole: 'SUPER_ADMIN', accountStatus: 'ACTIVE' } })
      if (!assignee) throw new AppError('Assigned staff member must be an active super administrator.', 400)
    }
    const ticket = await prisma.$transaction(async (tx) => {
      const existing = await tx.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true } })
      if (!existing) throw new AppError('Support ticket not found.', 404)
      const result = await tx.supportTicket.update({
        where: { id: ticketId }, data: input,
        include: { choir: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } }, replies: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } } },
      })
      await tx.platformAudit.create({ data: {
        actorId: res.locals.auth.userId, action: 'SUPPORT_TICKET_UPDATED', entityType: 'SupportTicket', entityId: ticketId, details: input,
      } })
      return result
    })
    res.json({ ticket })
  } catch (error) { next(error) }
})

platformRouter.post('/tickets/:ticketId/replies', async (req, res, next) => {
  try {
    const ticketId = z.string().uuid().parse(req.params.ticketId)
    const { body } = z.object({ body: z.string().trim().min(1).max(10000) }).parse(req.body)
    const reply = await prisma.$transaction(async (tx) => {
      const existing = await tx.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true } })
      if (!existing) throw new AppError('Support ticket not found.', 404)
      const created = await tx.supportReply.create({ data: { ticketId, authorId: res.locals.auth.userId, body } })
      await tx.supportTicket.update({ where: { id: ticketId }, data: { status: 'IN_PROGRESS' } })
      await tx.platformAudit.create({ data: { actorId: res.locals.auth.userId, action: 'SUPPORT_REPLY_CREATED', entityType: 'SupportTicket', entityId: ticketId } })
      return created
    })
    res.status(201).json({ reply })
  } catch (error) { next(error) }
})

platformRouter.get('/finance', async (req, res, next) => {
  try {
    const input = financeFilter.parse(req.query)
    const records = await prisma.financialRecord.findMany({
      where: financeWhere(input), orderBy: { transactionDate: 'desc' }, take: 5000,
      include: { choir: { select: { id: true, name: true } }, recordedBy: { select: { id: true, name: true } } },
    })
    res.json({ records })
  } catch (error) { next(error) }
})

platformRouter.get('/finance/export.csv', async (req, res, next) => {
  try {
    const input = financeFilter.parse(req.query)
    const rows = await prisma.financialRecord.findMany({
      where: financeWhere(input), orderBy: { transactionDate: 'desc' }, take: 5000,
      include: { choir: { select: { name: true } }, recordedBy: { select: { name: true } } },
    })

    platformRouter.get('/analytics/registrations.csv', async (req, res, next) => {
      try {
        const input = dateFilter.refine((value) => !value.from || !value.to || value.from <= value.to, 'The start date must be before the end date.').parse(req.query)
        const from = input.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        const to = input.to ?? new Date()
        if (from > to) throw new AppError('The start date must be before the end date.', 400)
        const rows = await prisma.$queryRaw<Array<{ entity: string; date: Date; registrations: bigint }>>`
          SELECT 'choir'::text AS entity, date_trunc('day', "createdAt") AS date, count(*)::bigint AS registrations
          FROM "Choir" WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY date_trunc('day', "createdAt")
          UNION ALL
          SELECT 'user'::text AS entity, date_trunc('day', "createdAt") AS date, count(*)::bigint AS registrations
          FROM "User" WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY date_trunc('day', "createdAt")
          ORDER BY date, entity`
        const csv = [['Entity', 'Date', 'Registrations'], ...rows.map((row) => [row.entity, row.date, Number(row.registrations)])]
          .map((row) => row.map(csvCell).join(',')).join('\r\n')
        res.type('text/csv').attachment('echoir-registration-analytics.csv').send(csv)
      } catch (error) { next(error) }
    })
    const header = ['Date', 'Choir', 'Type', 'Status', 'Amount', 'Currency', 'Category', 'Payment method', 'Reference', 'Description', 'Recorded by']
    const csv = [header, ...rows.map((row) => [row.transactionDate, row.choir.name, row.type, row.status, row.amount, row.currency, row.category, row.paymentMethod, row.referenceNumber, row.description, row.recordedBy.name])]
      .map((row) => row.map(csvCell).join(',')).join('\r\n')
    res.type('text/csv').attachment('echoir-financial-records.csv').send(csv)
  } catch (error) { next(error) }
})

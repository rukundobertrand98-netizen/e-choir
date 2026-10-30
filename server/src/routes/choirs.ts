import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { ChoirRole, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db.js'
import { AppError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { normalizeLoginName } from '../identity.js'
import { rehearsalChangesSchema, rehearsalSchema, songSchema } from '../schemas.js'
import { getMembership, managementRoles, memberVisibilityFilter, requireRole } from '../tenant.js'

export const choirRouter = Router({ mergeParams: true })

async function authorize(req: Request, res: Response) {
  const choirId = z.string().uuid().parse(req.params.choirId)
  const membership = await getMembership(choirId, res.locals.auth.userId, res)
  return { choirId, membership }
}

choirRouter.get('/dashboard', async (req, res, next) => {
  try {
    const { choirId } = await authorize(req, res)
    const now = new Date()
    const [activeMembers, songs, upcomingRehearsalCount, upcomingRehearsals, sections, recentSongs] =
      await Promise.all([
        prisma.choirMembership.count({
          where: { choirId, status: 'ACTIVE' },
        }),
        prisma.song.count({ where: { choirId, status: 'PUBLISHED' } }),
        prisma.rehearsal.count({
          where: { choirId, startsAt: { gte: now }, cancelledAt: null },
        }),
        prisma.rehearsal.findMany({
          where: { choirId, startsAt: { gte: now }, cancelledAt: null },
          orderBy: { startsAt: 'asc' },
          take: 4,
        }),
        prisma.vocalSection.findMany({
          where: { choirId },
          select: {
            id: true,
            name: true,
            _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
          },
          orderBy: { name: 'asc' },
        }),
        prisma.song.findMany({
          where: { choirId, status: 'PUBLISHED' },
          orderBy: { createdAt: 'desc' },
          take: 4,
          select: { id: true, title: true, composer: true, musicalKey: true },
        }),
      ])
    res.json({
      stats: {
        activeMembers,
        publishedSongs: songs,
        upcomingRehearsals: upcomingRehearsalCount,
      },
      upcomingRehearsals,
      sections: sections.map((section) => ({
        id: section.id,
        name: section.name,
        members: section._count.memberships,
      })),
      recentSongs,
    })
  } catch (error) {
    next(error)
  }
})

choirRouter.get('/members', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    const query = z
      .object({
        search: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(req.query)
    const visibility = memberVisibilityFilter(
      membership.role,
      membership.userId,
      membership.sectionId,
    )
    if (!visibility) {
      res.json({
        members: [],
        pagination: { page: query.page, pageSize: query.pageSize, total: 0 },
      })
      return
    }
    const where: Prisma.ChoirMembershipWhereInput = {
      choirId,
      status: { in: ['ACTIVE', 'INACTIVE'] },
      ...visibility,
      ...(query.search
        ? {
            loginName: { contains: normalizeLoginName(query.search) },
          }
        : {}),
    }
    const [total, members] = await Promise.all([
      prisma.choirMembership.count({ where }),
      prisma.choirMembership.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, language: true } },
          section: { select: { id: true, name: true } },
        },
        orderBy: { user: { name: 'asc' } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    res.json({
      members: members.map(({ id, role, status, joinedAt, user, section }) => ({
        id,
        role,
        status,
        joinedAt,
        user,
        section,
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    })
  } catch (error) {
    next(error)
  }
})

choirRouter.post('/members', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, [ChoirRole.ADMIN])
    const input = z
      .object({
        name: z.string().trim().min(2).max(100).transform((value) => value.replace(/\s+/g, ' ')),
        password: z.string().min(10).max(128),
        role: z.nativeEnum(ChoirRole),
        sectionId: z.string().uuid().nullable().optional(),
      })
      .parse(req.body)
    if (input.sectionId) {
      const section = await prisma.vocalSection.findFirst({
        where: { id: input.sectionId, choirId },
      })
      if (!section) throw new AppError('Section not found in this choir.', 404)
    }
    const passwordHash = await bcrypt.hash(input.password, 12)
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name, passwordHash },
      })
      const member = await tx.choirMembership.create({
        data: {
          choirId,
          userId: user.id,
          loginName: normalizeLoginName(input.name),
          role: input.role,
          sectionId: input.sectionId,
        },
        include: {
          user: { select: { id: true, name: true, language: true } },
          section: { select: { id: true, name: true } },
        },
      })
      await recordAudit(tx, {
        choirId,
        actorId: res.locals.auth.userId,
        action: 'MEMBER_CREATED',
        entityType: 'ChoirMembership',
        entityId: member.id,
        details: { role: input.role, sectionId: input.sectionId ?? null },
      })
      return member
    })
    res.status(201).json({ member: created })
  } catch (error) {
    next(error)
  }
})

choirRouter.patch('/members/:membershipId', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, [ChoirRole.ADMIN])
    const membershipId = z.string().uuid().parse(req.params.membershipId)
    const input = z
      .object({
        role: z.nativeEnum(ChoirRole).optional(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
        sectionId: z.string().uuid().nullable().optional(),
      })
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required.')
      .parse(req.body)
    if (membershipId === membership.id && input.status === 'INACTIVE') {
      throw new AppError('You cannot deactivate your own membership.', 400)
    }
    if (input.sectionId) {
      const section = await prisma.vocalSection.findFirst({
        where: { id: input.sectionId, choirId },
      })
      if (!section) throw new AppError('Section not found in this choir.', 404)
    }
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.choirMembership.findFirst({
        where: { id: membershipId, choirId },
        select: { id: true, role: true, status: true },
      })
      if (!target) throw new AppError('Member not found.', 404)
      if (
        target.role === ChoirRole.ADMIN &&
        target.status === 'ACTIVE' &&
        (input.status === 'INACTIVE' || (input.role && input.role !== ChoirRole.ADMIN))
      ) {
        const activeAdmins = await tx.choirMembership.count({
          where: { choirId, role: ChoirRole.ADMIN, status: 'ACTIVE' },
        })
        if (activeAdmins <= 1) {
          throw new AppError('A choir must retain at least one active administrator.', 409)
        }
      }
      await tx.choirMembership.update({
        where: { id: membershipId },
        data: input,
      })
      await recordAudit(tx, {
        choirId,
        actorId: res.locals.auth.userId,
        action: 'MEMBERSHIP_UPDATED',
        entityType: 'ChoirMembership',
        entityId: membershipId,
        details: {
          role: input.role ?? null,
          status: input.status ?? null,
          sectionId: input.sectionId ?? null,
        },
      })
      return tx.choirMembership.findUnique({
        where: { id: membershipId },
        include: {
          user: { select: { id: true, name: true, language: true } },
          section: { select: { id: true, name: true } },
        },
      })
    }, { isolationLevel: 'Serializable' })
    res.json({ member: result })
  } catch (error) {
    next(error)
  }
})

choirRouter.patch('/members/:membershipId/section', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const membershipId = z.string().uuid().parse(req.params.membershipId)
    const { sectionId } = z.object({ sectionId: z.string().uuid().nullable() }).parse(req.body)
    if (sectionId && !await prisma.vocalSection.findFirst({ where: { id: sectionId, choirId } })) {
      throw new AppError('Section not found in this choir.', 404)
    }
    const updated = await prisma.choirMembership.updateMany({
      where: { id: membershipId, choirId },
      data: { sectionId },
    })
    if (!updated.count) throw new AppError('Member not found.', 404)
    const member = await prisma.choirMembership.findUnique({
      where: { id: membershipId },
      include: {
        user: { select: { id: true, name: true, language: true } },
        section: { select: { id: true, name: true } },
      },
    })
    res.json({ member })
  } catch (error) {
    next(error)
  }
})

choirRouter.get('/sections', async (req, res, next) => {
  try {
    const { choirId } = await authorize(req, res)
    const sections = await prisma.vocalSection.findMany({
      where: { choirId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { memberships: true } } },
    })
    res.json({
      sections: sections.map(({ _count, ...section }) => ({
        ...section,
        memberCount: _count.memberships,
      })),
    })
  } catch (error) {
    next(error)
  }
})

choirRouter.get('/audit-logs', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, [ChoirRole.ADMIN])
    const pagination = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query)
    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where: { choirId } }),
      prisma.auditLog.findMany({
        where: { choirId },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
    ])
    res.json({
      entries,
      pagination: { ...pagination, total },
    })
  } catch (error) {
    next(error)
  }
})

choirRouter.get('/songs', async (req, res, next) => {
  try {
    const { choirId } = await authorize(req, res)
    const query = z
      .object({
        search: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(req.query)
    const where = {
      choirId,
      status: 'PUBLISHED' as const,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { composer: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }
    const [total, songs] = await Promise.all([
      prisma.song.count({ where }),
      prisma.song.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    res.json({
      songs,
      pagination: { page: query.page, pageSize: query.pageSize, total },
    })
  } catch (error) {
    next(error)
  }
})

choirRouter.post('/songs', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const song = await prisma.song.create({
      data: { ...songSchema.parse(req.body), choirId },
    })
    res.status(201).json({ song })
  } catch (error) {
    next(error)
  }
})

choirRouter.patch('/songs/:songId', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const songId = z.string().uuid().parse(req.params.songId)
    const input = songSchema.partial().parse(req.body)
    if (!Object.keys(input).length) throw new AppError('No changes provided.', 400)
    const result = await prisma.song.updateMany({
      where: { id: songId, choirId },
      data: input,
    })
    if (!result.count) throw new AppError('Song not found.', 404)
    const song = await prisma.song.findUnique({ where: { id: songId } })
    res.json({ song })
  } catch (error) {
    next(error)
  }
})

choirRouter.delete('/songs/:songId', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const songId = z.string().uuid().parse(req.params.songId)
    const result = await prisma.song.updateMany({
      where: { id: songId, choirId, status: { not: 'ARCHIVED' } },
      data: { status: 'ARCHIVED' },
    })
    if (!result.count) throw new AppError('Song not found.', 404)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

choirRouter.get('/rehearsals', async (req, res, next) => {
  try {
    const { choirId } = await authorize(req, res)
    const rehearsals = await prisma.rehearsal.findMany({
      where: { choirId, cancelledAt: null },
      include: {
        songs: { orderBy: { sortOrder: 'asc' }, include: { song: { select: { id: true, title: true } } } },
      },
      orderBy: { startsAt: 'asc' },
      take: 100,
    })
    res.json({ rehearsals })
  } catch (error) {
    next(error)
  }
})

choirRouter.post('/rehearsals', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const rehearsal = await prisma.rehearsal.create({
      data: { ...rehearsalSchema.parse(req.body), choirId },
    })
    res.status(201).json({ rehearsal })
  } catch (error) {
    next(error)
  }
})

choirRouter.patch('/rehearsals/:rehearsalId', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const rehearsalId = z.string().uuid().parse(req.params.rehearsalId)
    const changes = rehearsalChangesSchema.parse(req.body)
    if (!Object.keys(changes).length) throw new AppError('No changes provided.', 400)
    const rehearsal = await prisma.rehearsal.findFirst({
      where: { id: rehearsalId, choirId, cancelledAt: null },
    })
    if (!rehearsal) throw new AppError('Rehearsal not found.', 404)
    const startsAt = changes.startsAt ?? rehearsal.startsAt
    const endsAt = changes.endsAt ?? rehearsal.endsAt
    if (endsAt <= startsAt) {
      throw new AppError('End time must be after the start time.', 400)
    }
    const updated = await prisma.rehearsal.updateMany({
      where: { id: rehearsalId, choirId, cancelledAt: null },
      data: changes,
    })
    if (!updated.count) throw new AppError('Rehearsal not found.', 404)
    res.json({ rehearsal: await prisma.rehearsal.findUnique({ where: { id: rehearsalId } }) })
  } catch (error) {
    next(error)
  }
})

choirRouter.patch('/rehearsals/:rehearsalId/cancel', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const rehearsalId = z.string().uuid().parse(req.params.rehearsalId)
    const result = await prisma.rehearsal.updateMany({
      where: { id: rehearsalId, choirId, cancelledAt: null },
      data: { cancelledAt: new Date() },
    })
    if (!result.count) throw new AppError('Rehearsal not found.', 404)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

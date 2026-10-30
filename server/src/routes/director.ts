import express from 'express'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { ChoirRole, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db.js'
import { AppError } from '../errors.js'
import {
  announcementSchema,
  attendanceSchema,
  eventSchema,
  noteSchema,
  practiceSchema,
  resourceSchema,
  taskSchema,
} from '../schemas.js'
import { canUpdateDirectorTask, managementRoles, requireRole } from '../tenant.js'

export const directorRouter = Router({ mergeParams: true })

async function authorize(req: Request, res: Response) {
  const choirId = z.string().uuid().parse(req.params.choirId)
  const membership = await prisma.choirMembership.findFirst({
    where: {
      choirId,
      userId: res.locals.auth.userId,
      status: 'ACTIVE',
      choir: { status: 'ACTIVE' },
    },
  })
  if (!membership) throw new AppError('You do not have access to this choir.', 403)
  return { choirId, membership }
}

function requireLeadership(role: ChoirRole) {
  requireRole(role, [...managementRoles, ChoirRole.SECTION_LEADER])
}

function requireSectionScope(
  role: ChoirRole,
  ownSectionId: string | null,
  sectionId: string | null | undefined,
) {
  requireLeadership(role)
  if (role === ChoirRole.SECTION_LEADER && (!ownSectionId || sectionId !== ownSectionId)) {
    throw new AppError('Section leaders can only manage their assigned section.', 403)
  }
}

const uploadExtensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
}
const uploadRoot = resolve(process.cwd(), 'uploads', 'choir-resources')

directorRouter.get('/overview', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    const now = new Date()
    const sectionFilter = membership.role === ChoirRole.SECTION_LEADER
      ? { sectionId: membership.sectionId ?? '__none__' }
      : {}
    const [totalMembers, activeMembers, upcomingRehearsalCount, upcomingEventCount, upcomingRehearsals, upcomingEvents, recentAttendance,
      songs, practices, announcements, tasks, sections, notes, recentActivity] = await Promise.all([
      prisma.choirMembership.count({ where: { choirId } }),
      prisma.choirMembership.count({ where: { choirId, status: 'ACTIVE' } }),
      prisma.rehearsal.count({ where: { choirId, startsAt: { gte: now }, cancelledAt: null } }),
      prisma.choirEvent.count({ where: { choirId, startsAt: { gte: now } } }),
      prisma.rehearsal.findMany({
        where: { choirId, startsAt: { gte: now }, cancelledAt: null },
        include: { songs: { orderBy: { sortOrder: 'asc' }, include: { song: { select: { id: true, title: true } } } } },
        orderBy: { startsAt: 'asc' }, take: 5,
      }),
      prisma.choirEvent.findMany({
        where: { choirId, startsAt: { gte: now } },
        include: { songs: { orderBy: { sortOrder: 'asc' }, include: { song: { select: { id: true, title: true } } } },
          participants: { select: { membershipId: true } } },
        orderBy: { startsAt: 'asc' }, take: 10,
      }),
      prisma.attendance.findMany({
        where: {
          choirId,
          ...(membership.role === ChoirRole.SECTION_LEADER ? { membership: { sectionId: membership.sectionId } } : {}),
          ...(membership.role === ChoirRole.MEMBER ? { membershipId: membership.id } : {}),
        },
        include: { membership: { include: { user: { select: { name: true } }, section: { select: { name: true } } } },
          rehearsal: { select: { title: true, startsAt: true } } },
        orderBy: { recordedAt: 'desc' }, take: 8,
      }),
      prisma.song.findMany({
        where: { choirId, status: 'PUBLISHED' }, orderBy: { updatedAt: 'desc' }, take: 50,
        include: { resources: { orderBy: { createdAt: 'desc' } } },
      }),
      prisma.practiceAssignment.findMany({
        where: {
          choirId,
          ...(membership.role === ChoirRole.SECTION_LEADER ? sectionFilter : {}),
          ...(membership.role === ChoirRole.MEMBER ? { OR: [
            { membershipId: membership.id },
            ...(membership.sectionId ? [{ sectionId: membership.sectionId }] : []),
            { sectionId: null, membershipId: null },
          ] } : {}),
        },
        include: { song: { select: { id: true, title: true, composer: true } },
          section: { select: { id: true, name: true } },
          membership: { select: { id: true, user: { select: { name: true } } } } },
        orderBy: { updatedAt: 'desc' }, take: 50,
      }),
      prisma.directorAnnouncement.findMany({
        where: { choirId, ...(membership.role === ChoirRole.SECTION_LEADER ? { OR: [{ targetSectionId: null }, { targetSectionId: membership.sectionId }] } : {}) },
        include: { targetSection: { select: { name: true } } },
        orderBy: { publishedAt: 'desc' }, take: 10,
      }),
      prisma.directorTask.findMany({
        where: { choirId, ...(membership.role === ChoirRole.SECTION_LEADER
          ? { OR: [{ targetSectionId: membership.sectionId }, { targetSectionId: null, assignedToId: null }] }
          : membership.role === ChoirRole.MEMBER ? { OR: [
            { assignedToId: membership.id },
            ...(membership.sectionId ? [{ targetSectionId: membership.sectionId }] : []),
            { targetSectionId: null, assignedToId: null },
          ] } : {}) },
        include: { targetSection: { select: { name: true } }, assignedTo: { select: { user: { select: { name: true } } } } },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 25,
      }),
      prisma.vocalSection.findMany({
        where: { choirId, ...(membership.role === ChoirRole.SECTION_LEADER ? { id: membership.sectionId ?? '__none__' } : {}) },
        include: { _count: { select: { memberships: { where: { status: 'ACTIVE' } } } } }, orderBy: { name: 'asc' },
      }),
      membership.role === ChoirRole.ADMIN || membership.role === ChoirRole.DIRECTOR
        ? prisma.directorNote.findMany({ where: { choirId }, orderBy: { createdAt: 'desc' }, take: 8 })
        : membership.role === ChoirRole.SECTION_LEADER
          ? prisma.directorNote.findMany({ where: { choirId, authorId: res.locals.auth.userId }, orderBy: { createdAt: 'desc' }, take: 8 })
          : Promise.resolve([]),
      membership.role === ChoirRole.ADMIN
        ? prisma.auditLog.findMany({ where: { choirId }, orderBy: { createdAt: 'desc' }, take: 8,
          select: { id: true, action: true, entityType: true, createdAt: true } })
        : Promise.resolve([]),
    ])
    const [ready, learning, needsPractice, notStarted] = await Promise.all([
      prisma.practiceAssignment.count({ where: { choirId, status: 'READY', ...sectionFilter } }),
      prisma.practiceAssignment.count({ where: { choirId, status: 'LEARNING', ...sectionFilter } }),
      prisma.practiceAssignment.count({ where: { choirId, status: 'NEEDS_PRACTICE', ...sectionFilter } }),
      prisma.practiceAssignment.count({ where: { choirId, status: 'NOT_STARTED', ...sectionFilter } }),
    ])
    const activityFeed = [
      ...recentActivity,
      ...announcements.map((item) => ({ id: item.id, action: 'ANNOUNCEMENT_PUBLISHED', entityType: 'Announcement', createdAt: item.createdAt })),
      ...tasks.map((item) => ({ id: item.id, action: 'TASK_ASSIGNED', entityType: 'Task', createdAt: item.createdAt })),
      ...practices.map((item) => ({ id: item.id, action: 'PRACTICE_ASSIGNED', entityType: 'Practice', createdAt: item.assignedAt })),
      ...notes.map((item) => ({ id: item.id, action: 'DIRECTOR_NOTE_ADDED', entityType: 'Note', createdAt: item.createdAt })),
      ...upcomingEvents.map((item) => ({ id: item.id, action: 'EVENT_PLANNED', entityType: 'Event', createdAt: item.createdAt })),
      ...songs.slice(0, 5).map((item) => ({ id: item.id, action: 'SONG_ADDED', entityType: 'Song', createdAt: item.createdAt })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 8)
    res.json({
      stats: {
        totalMembers, activeMembers, upcomingRehearsals: upcomingRehearsalCount,
        upcomingEvents: upcomingEventCount, songReadiness: { ready, learning, needsPractice, notStarted },
      },
      upcomingRehearsals, upcomingEvents, recentAttendance,
      songs: songs.map((song) => ({ ...song, resources: song.resources.map((resource) => ({
        ...resource,
        url: resource.url ?? `/api/v1/choirs/${choirId}/director/resources/${resource.id}/download`,
      })) })),
      practices, announcements, tasks, sections, notes,
      recentActivity: activityFeed,
    })
  } catch (error) { next(error) }
})

directorRouter.post('/announcements', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    const input = announcementSchema.parse(req.body)
    requireSectionScope(membership.role, membership.sectionId, input.targetSectionId ?? null)
    if (input.targetSectionId && !await prisma.vocalSection.findFirst({ where: { id: input.targetSectionId, choirId } })) {
      throw new AppError('Section not found in this choir.', 404)
    }
    const announcement = await prisma.directorAnnouncement.create({
      data: { choirId, createdById: membership.userId, ...input },
      include: { targetSection: { select: { name: true } } },
    })
    res.status(201).json({ announcement })
  } catch (error) { next(error) }
})

directorRouter.post('/tasks', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    const input = taskSchema.parse(req.body)
    requireSectionScope(membership.role, membership.sectionId, input.targetSectionId ?? null)
    if (membership.role === ChoirRole.SECTION_LEADER && !input.targetSectionId) {
      throw new AppError('Choose your section for this task.', 400)
    }
    if (input.targetSectionId && !await prisma.vocalSection.findFirst({ where: { id: input.targetSectionId, choirId } })) {
      throw new AppError('Section not found in this choir.', 404)
    }
    if (input.assignedToId && !await prisma.choirMembership.findFirst({ where: { id: input.assignedToId, choirId, status: 'ACTIVE' } })) {
      throw new AppError('Assigned member not found in this choir.', 404)
    }
    if (input.assignedToId && input.targetSectionId) {
      const target = await prisma.choirMembership.findFirst({
        where: { id: input.assignedToId, choirId, sectionId: input.targetSectionId, status: 'ACTIVE' },
      })
      if (!target) throw new AppError('Assigned member must belong to the selected section.', 400)
    }
    const task = await prisma.directorTask.create({ data: { choirId, createdById: membership.userId, ...input },
      include: { targetSection: { select: { name: true } }, assignedTo: { select: { user: { select: { name: true } } } } } })
    res.status(201).json({ task })
  } catch (error) { next(error) }
})

directorRouter.patch('/tasks/:taskId', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    const taskId = z.string().uuid().parse(req.params.taskId)
    const status = z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).parse(req.body.status)
    const task = await prisma.directorTask.findFirst({ where: { id: taskId, choirId } })
    if (!task) throw new AppError('Task not found.', 404)
    if (!canUpdateDirectorTask(membership.role, membership.id, membership.sectionId, task)) {
      throw new AppError('You cannot update this task.', 403)
    }
    const result = await prisma.directorTask.updateMany({ where: { id: taskId, choirId }, data: { status } })
    if (!result.count) throw new AppError('Task not found.', 404)
    res.json({ task: await prisma.directorTask.findUnique({ where: { id: taskId } }) })
  } catch (error) { next(error) }
})

directorRouter.post('/practice', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    const input = practiceSchema.parse(req.body)
    requireSectionScope(membership.role, membership.sectionId, input.sectionId ?? null)
    if (membership.role === ChoirRole.SECTION_LEADER && !input.sectionId) {
      throw new AppError('Section leaders must assign practice to their section.', 400)
    }
    if (!await prisma.song.findFirst({ where: { id: input.songId, choirId, status: 'PUBLISHED' } })) {
      throw new AppError('Song not found in this choir.', 404)
    }
    if (input.sectionId && !await prisma.vocalSection.findFirst({ where: { id: input.sectionId, choirId } })) {
      throw new AppError('Section not found in this choir.', 404)
    }
    if (input.membershipId && !await prisma.choirMembership.findFirst({ where: { id: input.membershipId, choirId, status: 'ACTIVE' } })) {
      throw new AppError('Member not found in this choir.', 404)
    }
    const assignment = await prisma.practiceAssignment.create({ data: { choirId, ...input },
      include: { song: { select: { title: true } }, section: { select: { name: true } },
        membership: { select: { user: { select: { name: true } } } } } })
    res.status(201).json({ assignment })
  } catch (error) { next(error) }
})

directorRouter.patch('/practice/:assignmentId', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    const assignmentId = z.string().uuid().parse(req.params.assignmentId)
    const input = z.object({
      status: z.enum(['NOT_STARTED', 'LEARNING', 'NEEDS_PRACTICE', 'READY']).optional(),
      note: z.string().trim().max(2000).nullable().optional(),
    }).refine((value) => Object.keys(value).length > 0).parse(req.body)
    const assignment = await prisma.practiceAssignment.findFirst({ where: { id: assignmentId, choirId } })
    if (!assignment) throw new AppError('Practice assignment not found.', 404)
    if (membership.role === ChoirRole.MEMBER) {
      if (assignment.membershipId !== membership.id) throw new AppError('You cannot update this assignment.', 403)
    } else if (membership.role === ChoirRole.SECTION_LEADER) {
      requireSectionScope(membership.role, membership.sectionId, assignment.sectionId)
    } else requireRole(membership.role, managementRoles)
    await prisma.practiceAssignment.updateMany({ where: { id: assignmentId, choirId }, data: input })
    res.json({ assignment: await prisma.practiceAssignment.findUnique({ where: { id: assignmentId } }) })
  } catch (error) { next(error) }
})

directorRouter.post('/events', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const input = eventSchema.parse(req.body)
    await validateEventRelations(choirId, input.songIds, input.participantIds)
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.choirEvent.create({
        data: {
          choirId, title: input.title, type: input.type, startsAt: input.startsAt, endsAt: input.endsAt,
          deadlineAt: input.deadlineAt, venue: input.venue, description: input.description,
          songs: { create: input.songIds.map((songId, sortOrder) => ({ songId, choirId, sortOrder })) },
          participants: { create: input.participantIds.map((membershipId) => ({ membershipId, choirId })) },
        },
        include: eventInclude,
      })

      directorRouter.get('/events', async (req, res, next) => {
        try {
          const { choirId } = await authorize(req, res)
          const query = z.object({
            search: z.string().trim().max(100).optional(),
            page: z.coerce.number().int().min(1).default(1),
            pageSize: z.coerce.number().int().min(1).max(100).default(25),
          }).parse(req.query)
          const where: Prisma.ChoirEventWhereInput = {
            choirId,
            ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
          }
          const [total, events] = await Promise.all([
            prisma.choirEvent.count({ where }),
            prisma.choirEvent.findMany({
              where, include: eventInclude, orderBy: { startsAt: 'asc' },
              skip: (query.page - 1) * query.pageSize, take: query.pageSize,
            }),
          ])
          res.json({ events, pagination: { page: query.page, pageSize: query.pageSize, total } })
        } catch (error) { next(error) }
      })

      directorRouter.delete('/events/:eventId', async (req, res, next) => {
        try {
          const { choirId, membership } = await authorize(req, res)
          requireRole(membership.role, managementRoles)
          const eventId = z.string().uuid().parse(req.params.eventId)
          const deleted = await prisma.choirEvent.deleteMany({ where: { id: eventId, choirId } })
          if (!deleted.count) throw new AppError('Event not found.', 404)
          res.status(204).end()
        } catch (error) { next(error) }
      })
      return created
    })
    res.status(201).json({ event })
  } catch (error) { next(error) }
})

directorRouter.patch('/events/:eventId', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const eventId = z.string().uuid().parse(req.params.eventId)
    const input = eventSchema.parse(req.body)
    await validateEventRelations(choirId, input.songIds, input.participantIds)
    const exists = await prisma.choirEvent.findFirst({ where: { id: eventId, choirId } })
    if (!exists) throw new AppError('Event not found.', 404)
    const event = await prisma.$transaction(async (tx) => {
      await tx.eventSong.deleteMany({ where: { eventId, choirId } })
      await tx.eventParticipant.deleteMany({ where: { eventId, choirId } })
      return tx.choirEvent.update({
        where: { id: eventId },
        data: {
          title: input.title, type: input.type, startsAt: input.startsAt, endsAt: input.endsAt,
          deadlineAt: input.deadlineAt, venue: input.venue, description: input.description,
          songs: { create: input.songIds.map((songId, sortOrder) => ({ songId, choirId, sortOrder })) },
          participants: { create: input.participantIds.map((membershipId) => ({ membershipId, choirId })) },
        },
        include: eventInclude,
      })
    })
    res.json({ event })
  } catch (error) { next(error) }
})

const eventInclude = {
  songs: { orderBy: { sortOrder: Prisma.SortOrder.asc }, include: { song: { select: { id: true, title: true } } } },
  participants: { include: { membership: { include: { user: { select: { id: true, name: true } } } } } },
} satisfies Prisma.ChoirEventInclude

async function validateEventRelations(choirId: string, songIds: string[], participantIds: string[]) {
  const uniqueSongIds = new Set(songIds)
  const uniqueParticipantIds = new Set(participantIds)
  if (uniqueSongIds.size !== songIds.length || uniqueParticipantIds.size !== participantIds.length) {
    throw new AppError('Songs and participants must not be duplicated.', 400)
  }
  const [songs, members] = await Promise.all([
    prisma.song.count({ where: { choirId, id: { in: songIds }, status: 'PUBLISHED' } }),
    prisma.choirMembership.count({ where: { choirId, id: { in: participantIds }, status: 'ACTIVE' } }),
  ])
  if (songs !== songIds.length || members !== participantIds.length) {
    throw new AppError('Selected songs or participants are not available in this choir.', 400)
  }
}

directorRouter.post('/rehearsals/:rehearsalId/attendance', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const rehearsalId = z.string().uuid().parse(req.params.rehearsalId)
    const { records } = attendanceSchema.parse(req.body)
    const rehearsalExists = await prisma.rehearsal.findFirst({ where: { id: rehearsalId, choirId } })
    if (!rehearsalExists) throw new AppError('Rehearsal not found.', 404)
    const memberIds = records.map(({ membershipId }) => membershipId)
    if (new Set(memberIds).size !== memberIds.length) throw new AppError('Attendance contains duplicate members.', 400)
    const memberCount = await prisma.choirMembership.count({
      where: { choirId, status: 'ACTIVE', id: { in: memberIds } },
    })

    directorRouter.get('/rehearsals/:rehearsalId/attendance', async (req, res, next) => {
      try {
        const { choirId, membership } = await authorize(req, res)
        requireRole(membership.role, managementRoles)
        const rehearsalId = z.string().uuid().parse(req.params.rehearsalId)
        const pagination = z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(500).default(100),
        }).parse(req.query)
        const rehearsal = await prisma.rehearsal.findFirst({
          where: { id: rehearsalId, choirId },
          select: { id: true, title: true, startsAt: true },
        })
        if (!rehearsal) throw new AppError('Rehearsal not found.', 404)
        const where = { choirId, status: 'ACTIVE' as const }
        const [total, members] = await Promise.all([
          prisma.choirMembership.count({ where }),
          prisma.choirMembership.findMany({
          where,
          select: {
            id: true,
            user: { select: { name: true } },
            section: { select: { name: true } },
            attendance: { where: { rehearsalId }, select: { status: true, note: true } },
          },
          orderBy: { user: { name: 'asc' } },
          skip: (pagination.page - 1) * pagination.pageSize,
          take: pagination.pageSize,
        })])
        res.json({
          rehearsal,
          pagination: { ...pagination, total },
          members: members.map(({ attendance, ...member }) => ({
            ...member,
            status: attendance[0]?.status ?? null,
            note: attendance[0]?.note ?? null,
          })),
        })
      } catch (error) { next(error) }
    })
    if (memberCount !== memberIds.length) throw new AppError('One or more members are not active in this choir.', 400)
    await prisma.$transaction(records.map(({ membershipId, status, note }) =>
      prisma.attendance.upsert({
        where: { rehearsalId_membershipId: { rehearsalId, membershipId } },
        create: { choirId, rehearsalId, membershipId, status, note },
        update: { status, note },
      }),
    ))
    res.json({ saved: records.length })
  } catch (error) { next(error) }
})

directorRouter.put('/rehearsals/:rehearsalId/songs', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const rehearsalId = z.string().uuid().parse(req.params.rehearsalId)
    const songIds = z.array(z.string().uuid()).max(100).parse(req.body.songIds)
    if (new Set(songIds).size !== songIds.length) throw new AppError('Songs must not be duplicated.', 400)
    const [rehearsal, songs] = await Promise.all([
      prisma.rehearsal.findFirst({ where: { id: rehearsalId, choirId, cancelledAt: null } }),
      prisma.song.count({ where: { choirId, id: { in: songIds }, status: 'PUBLISHED' } }),
    ])
    if (!rehearsal) throw new AppError('Rehearsal not found.', 404)
    if (songs !== songIds.length) throw new AppError('One or more songs are not available in this choir.', 400)
    await prisma.$transaction([
      prisma.rehearsalSong.deleteMany({ where: { rehearsalId, choirId } }),
      ...songIds.map((songId, sortOrder) => prisma.rehearsalSong.create({
        data: { choirId, rehearsalId, songId, sortOrder },
      })),
    ])
    res.json({ songIds })
  } catch (error) { next(error) }
})

directorRouter.post('/notes', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const input = noteSchema.parse(req.body)
    if (input.rehearsalId && !await prisma.rehearsal.findFirst({ where: { id: input.rehearsalId, choirId } })) {
      throw new AppError('Rehearsal not found.', 404)
    }
    const note = await prisma.directorNote.create({ data: { choirId, authorId: membership.userId, ...input } })
    res.status(201).json({ note })
  } catch (error) { next(error) }
})

directorRouter.post('/songs/:songId/resources', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const songId = z.string().uuid().parse(req.params.songId)
    const input = resourceSchema.parse(req.body)
    if (!await prisma.song.findFirst({ where: { id: songId, choirId, status: 'PUBLISHED' } })) {
      throw new AppError('Song not found.', 404)
    }
    const resource = await prisma.songResource.create({ data: { choirId, songId, ...input } })
    res.status(201).json({ resource })
  } catch (error) { next(error) }
})

directorRouter.post(
  '/songs/:songId/resources/upload',
  express.raw({ type: Object.keys(uploadExtensions), limit: '25mb' }),
  async (req, res, next) => {
    let storedPath: string | undefined
    try {
      const { choirId, membership } = await authorize(req, res)
      requireRole(membership.role, managementRoles)
      const songId = z.string().uuid().parse(req.params.songId)
      const query = z.object({
        title: z.string().trim().min(1).max(160),
        type: resourceSchema.shape.type,
      }).parse(req.query)
      const body: unknown = req.body
      if (!Buffer.isBuffer(body) || !body.length) throw new AppError('Choose a non-empty PDF or audio file.', 400)
      if (!await prisma.song.findFirst({ where: { id: songId, choirId, status: 'PUBLISHED' } })) {
        throw new AppError('Song not found.', 404)
      }
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
      const extension = uploadExtensions[contentType]
      if (!extension) throw new AppError('Only PDF and supported audio files can be uploaded.', 415)
      const id = randomUUID()
      const storageName = `${id}.${extension}`
      const directory = resolve(uploadRoot, choirId)
      storedPath = resolve(directory, storageName)
      await mkdir(directory, { recursive: true })
      await writeFile(storedPath, body, { flag: 'wx', mode: 0o600 })
      const resource = await prisma.songResource.create({
        data: {
          id, choirId, songId, title: query.title, type: query.type, storageName, contentType,
          sizeBytes: body.length,
        },
      })
      res.status(201).json({ resource: { ...resource, url: `/api/v1/choirs/${choirId}/director/resources/${resource.id}/download` } })
    } catch (error) {
      if (storedPath) {
        try { await unlink(storedPath) } catch (cleanupError) {
          if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) {
            next(cleanupError)
            return
          }
        }
      }
      next(error)
    }
  },
)

directorRouter.get('/resources/:resourceId/download', async (req, res, next) => {
  try {
    const { choirId } = await authorize(req, res)
    const resourceId = z.string().uuid().parse(req.params.resourceId)
    const resource = await prisma.songResource.findFirst({
      where: { id: resourceId, choirId },
    })
    if (!resource) throw new AppError('Song resource not found.', 404)
    if (!resource.storageName || !resource.contentType) throw new AppError('This resource is an external link.', 400)
    const extension = uploadExtensions[resource.contentType]
    if (!extension || resource.storageName !== `${resource.id}.${extension}`) {
      throw new AppError('Stored resource metadata is invalid.', 500)
    }
    const path = resolve(uploadRoot, choirId, resource.storageName)
    res.download(path, `${resource.title}.${extension}`, (error) => {
      if (!error) return
      if (res.headersSent) {
        res.destroy(error)
      } else if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        next(new AppError('The stored resource file is unavailable.', 404))
      } else next(error)
    })
  } catch (error) { next(error) }
})

directorRouter.delete('/songs/:songId/resources/:resourceId', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const songId = z.string().uuid().parse(req.params.songId)
    const resourceId = z.string().uuid().parse(req.params.resourceId)
    const resource = await prisma.songResource.findFirst({ where: { id: resourceId, songId, choirId } })
    if (!resource) throw new AppError('Song resource not found.', 404)
    await prisma.songResource.delete({ where: { id: resourceId } })
    if (resource.storageName) {
      const path = resolve(uploadRoot, choirId, resource.storageName)
      try { await unlink(path) } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
    }
    res.status(204).end()
  } catch (error) { next(error) }
})

directorRouter.get('/reports', async (req, res, next) => {
  try {
    const { choirId, membership } = await authorize(req, res)
    requireRole(membership.role, managementRoles)
    const range = z.object({
      from: z.coerce.date(),
      to: z.coerce.date(),
    }).refine(({ from, to }) => from <= to, { path: ['to'], message: 'End date must be after start date.' }).parse(req.query)
    const [attendance, tasks, practice, practiceRows, eventCount, events] = await Promise.all([
      prisma.attendance.findMany({
        where: { choirId, recordedAt: { gte: range.from, lte: range.to } },
        include: { membership: { include: { user: { select: { name: true } }, section: { select: { name: true } } } },
          rehearsal: { select: { title: true, startsAt: true } } },
        orderBy: { recordedAt: 'asc' }, take: 5000,
      }),
      prisma.directorTask.groupBy({ by: ['status'], where: { choirId, createdAt: { gte: range.from, lte: range.to } }, _count: true }),
      prisma.practiceAssignment.groupBy({ by: ['status'], where: { choirId, updatedAt: { gte: range.from, lte: range.to } }, _count: true }),
      prisma.practiceAssignment.findMany({
        where: { choirId, updatedAt: { gte: range.from, lte: range.to } },
        select: { status: true, section: { select: { name: true } }, membership: { select: { section: { select: { name: true } } } } },
        take: 5000,
      }),
      prisma.choirEvent.count({ where: { choirId, startsAt: { gte: range.from, lte: range.to } } }),
      prisma.choirEvent.findMany({
        where: { choirId, startsAt: { gte: range.from, lte: range.to } },
        select: {
          title: true, type: true, startsAt: true, endsAt: true, deadlineAt: true, venue: true,
          _count: { select: { participants: true } },
        },
        orderBy: { startsAt: 'asc' }, take: 5000,
      }),
    ])
    const progressBySection = new Map<string, number>()
    for (const item of practiceRows) {
      const section = item.section?.name ?? item.membership?.section?.name ?? 'Whole choir'
      const key = `${section} / ${item.status}`
      progressBySection.set(key, (progressBySection.get(key) ?? 0) + 1)
    }
    const participationByMember = new Map<string, number>()
    for (const item of attendance) {
      const section = item.membership.section?.name ?? 'Unassigned'
      const key = `${item.membership.user.name} / ${section} / ${item.status}`
      participationByMember.set(key, (participationByMember.get(key) ?? 0) + 1)
    }
    res.json({
      range, attendance, tasks, practice, eventCount,
      practiceBySection: [...progressBySection].map(([label, count]) => ({ label, count })),
      memberParticipation: [...participationByMember].map(([label, count]) => ({ label, count })),
      events,
    })
  } catch (error) { next(error) }
})

import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { AppError } from '../errors.js'
import { getMembership } from '../tenant.js'

export const supportRouter = Router()

supportRouter.get('/tickets', async (_req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { createdById: res.locals.auth.userId },
      orderBy: { updatedAt: 'desc' },
      include: { choir: { select: { id: true, name: true } }, replies: { where: { internal: false }, orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } } },
    })
    res.json({ tickets })
  } catch (error) { next(error) }
})

supportRouter.post('/tickets', async (req, res, next) => {
  try {
    const input = z.object({
      choirId: z.string().uuid().nullable().optional(),
      subject: z.string().trim().min(4).max(200),
      body: z.string().trim().min(10).max(10000),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    }).parse(req.body)
    if (input.choirId) await getMembership(input.choirId, res.locals.auth.userId, res)
    const ticket = await prisma.supportTicket.create({
      data: {
        choirId: input.choirId ?? null,
        createdById: res.locals.auth.userId,
        subject: input.subject,
        priority: input.priority,
        replies: { create: { authorId: res.locals.auth.userId, body: input.body } },
      },
      include: { choir: { select: { id: true, name: true } } },
    })
    res.status(201).json({ ticket })
  } catch (error) { next(error) }
})

supportRouter.post('/tickets/:ticketId/replies', async (req, res, next) => {
  try {
    const ticketId = z.string().uuid().parse(req.params.ticketId)
    const { body } = z.object({ body: z.string().trim().min(1).max(10000) }).parse(req.body)
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: ticketId,
        createdById: res.locals.auth.userId,
      },
      select: { id: true, status: true },
    })
    if (!ticket) throw new AppError('Support ticket not found.', 404)
    if (ticket.status === 'CLOSED') throw new AppError('This ticket is closed.', 409)
    const reply = await prisma.$transaction(async (tx) => {
      const item = await tx.supportReply.create({ data: { ticketId, authorId: res.locals.auth.userId, body } })
      await tx.supportTicket.update({ where: { id: ticketId }, data: { status: 'OPEN' } })
      return item
    })
    res.status(201).json({ reply })
  } catch (error) { next(error) }
})

export const choirAnnouncementRouter = Router({ mergeParams: true })

function getChoirId(req: Request) {
  return z.string().uuid().parse((req.params as Record<string, string>).choirId)
}

choirAnnouncementRouter.get('/', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await getMembership(choirId, res.locals.auth.userId, res)
    const announcements = await prisma.announcement.findMany({
      where: { publishedAt: { not: null }, OR: [{ choirs: { none: {} } }, { choirs: { some: { choirId } } }] },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, body: true, maintenance: true, publishedAt: true },
    })
    res.json({ announcements })
  } catch (error) { next(error) }
})

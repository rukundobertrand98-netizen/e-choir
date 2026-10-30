import type { Response } from 'express'
import { ChoirRole, type Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { AppError } from './errors.js'

export async function getMembership(
  choirId: string,
  userId: string,
  res: Response,
) {
  const membership = await prisma.choirMembership.findFirst({
    where: { choirId, userId, status: 'ACTIVE', choir: { status: 'ACTIVE' } },
    include: { choir: true },
  })
  if (!membership) {
    throw new AppError('You do not have access to this choir.', 403)
  }
  res.locals.membership = membership
  return membership
}

declare global {
  namespace Express {
    interface Locals {
      membership: Prisma.ChoirMembershipGetPayload<{ include: { choir: true } }>
    }
  }
}

export function requireRole(membershipRole: ChoirRole, allowed: ChoirRole[]) {
  if (!allowed.includes(membershipRole)) {
    throw new AppError('You do not have permission to perform this action.', 403)
  }
}

export const managementRoles: ChoirRole[] = [
  ChoirRole.ADMIN,
  ChoirRole.DIRECTOR,
]

export function memberVisibilityFilter(
  role: ChoirRole,
  userId: string,
  sectionId: string | null,
) {
  if (role === ChoirRole.ADMIN || role === ChoirRole.DIRECTOR) return {}
  if (role === ChoirRole.SECTION_LEADER) {
    return sectionId ? { sectionId } : null
  }
  return { userId }
}

export function canUpdateDirectorTask(
  role: ChoirRole,
  membershipId: string,
  sectionId: string | null,
  task: { assignedToId: string | null; targetSectionId: string | null },
) {
  if (role === ChoirRole.ADMIN || role === ChoirRole.DIRECTOR) return true
  if (role === ChoirRole.SECTION_LEADER) {
    return Boolean(sectionId && task.targetSectionId === sectionId)
  }
  if (role === ChoirRole.MEMBER) {
    return task.assignedToId === membershipId ||
      (task.assignedToId === null && (
        task.targetSectionId === null || task.targetSectionId === sectionId
      ))
  }
  return false
}

import type { Prisma } from '@prisma/client'

type AuditEntry = {
  choirId: string
  actorId: string
  action: string
  entityType: string
  entityId: string
  details?: Prisma.InputJsonValue
}

export async function recordAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
) {
  await tx.auditLog.create({ data: entry })
}

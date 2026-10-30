import { raw, Router } from 'express'
import { ChoirRole, Prisma } from '@prisma/client'
import type { Request } from 'express'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../db.js'
import { AppError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { getMembership, requireRole } from '../tenant.js'
import { csvCell } from '../csv.js'

export const financeRouter = Router({ mergeParams: true })
const receiptRoot = resolve(process.cwd(), 'uploads', 'financial-receipts')
const receiptTypes: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function validReceiptSignature(buffer: Buffer, contentType: string) {
  if (contentType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-'
  if (contentType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (contentType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  return false
}

function getChoirId(req: Request) {
  return z.string().uuid().parse((req.params as Record<string, string>).choirId)
}

export const filterSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  status: z.enum(['PAID', 'PENDING', 'PARTIALLY_PAID']).optional(),
  category: z.string().trim().max(100).optional(),
  search: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).refine((input) => !input.from || !input.to || input.from <= input.to, 'The start date must be before the end date.')

export const recordSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  status: z.enum(['PAID', 'PENDING', 'PARTIALLY_PAID']).default('PENDING'),
  transactionDate: z.coerce.date(),
  amount: z.coerce.number().positive().max(999999999999.99).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Use no more than two decimal places.'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default('RWF'),
  category: z.string().trim().min(1).max(100),
  paymentMethod: z.string().trim().max(100).nullable().optional(),
  referenceNumber: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(1).max(2000),
  receiptReference: z.string().trim().max(1000).nullable().optional(),
})

type FinanceFilterInput = {
  type?: 'INCOME' | 'EXPENSE'
  status?: 'PAID' | 'PENDING' | 'PARTIALLY_PAID'
  category?: string
  search?: string
  from?: Date
  to?: Date
}

export function buildWhere(choirId: string, input: FinanceFilterInput): Prisma.FinancialRecordWhereInput {
  return {
    choirId,
    ...(input.type ? { type: input.type } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.category ? { category: { contains: input.category, mode: 'insensitive' as const } } : {}),
    ...(input.search ? { OR: [
      { category: { contains: input.search, mode: 'insensitive' as const } },
      { description: { contains: input.search, mode: 'insensitive' as const } },
      { payerName: { contains: input.search, mode: 'insensitive' as const } },
      { beneficiary: { contains: input.search, mode: 'insensitive' as const } },
      { referenceNumber: { contains: input.search, mode: 'insensitive' as const } },
      { membership: { user: { name: { contains: input.search, mode: 'insensitive' as const } } } },
    ] } : {}),
    ...(input.from || input.to ? { transactionDate: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
  }
}

function recordSnapshot(record: {
  type: string
  status: string
  transactionDate: Date
  amount: Prisma.Decimal
  currency: string
  category: string
  paymentMethod: string | null
  referenceNumber: string | null
  description: string
  receiptReference: string | null
  membershipId: string | null
  contributionMonth: Date | null
  payerName: string | null
  beneficiary: string | null
  approvalStatus: string
}) {
  return {
    type: record.type,
    status: record.status,
    transactionDate: record.transactionDate.toISOString(),
    amount: record.amount.toString(),
    currency: record.currency,
    category: record.category,
    paymentMethod: record.paymentMethod,
    referenceNumber: record.referenceNumber,
    description: record.description,
    receiptReference: record.receiptReference,
    membershipId: record.membershipId,
    contributionMonth: record.contributionMonth?.toISOString() ?? null,
    payerName: record.payerName,
    beneficiary: record.beneficiary,
    approvalStatus: record.approvalStatus,
  } satisfies Prisma.InputJsonObject
}

const financeRoles = [ChoirRole.ADMIN, ChoirRole.TREASURER]
export const recordInputSchema = recordSchema.extend({
  payerName: z.string().trim().max(160).nullable().optional(),
  beneficiary: z.string().trim().max(160).nullable().optional(),
  membershipId: z.string().uuid().nullable().optional(),
  contributionMonth: z.coerce.date().nullable().optional(),
})
export const createRecordSchema = recordInputSchema.superRefine((record, context) => {
  const isContribution = /dues|contribution/i.test(record.category)
  if (record.contributionMonth && !record.membershipId) {
    context.addIssue({ code: 'custom', path: ['membershipId'], message: 'A contribution month requires a choir member.' })
  }
  if (record.membershipId && record.type !== 'INCOME') {
    context.addIssue({ code: 'custom', path: ['type'], message: 'Member dues and contributions must be income records.' })
  }
  if (record.contributionMonth && !isContribution) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'A contribution month can only be recorded for dues or contribution income.' })
  }
  if (isContribution && (!record.membershipId || !record.contributionMonth || record.status !== 'PAID')) {
    context.addIssue({ code: 'custom', path: ['contributionMonth'], message: 'A member contribution requires a member, contribution month, and externally paid status.' })
  }
})

async function financialMembership(choirId: string, userId: string, res: Parameters<typeof getMembership>[2]) {
  const membership = await getMembership(choirId, userId, res)
  requireRole(membership.role, financeRoles)
  return membership
}

function monthDate(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex, 1))
}

function roundMoney(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

async function requireContributionPolicy(
  tx: Prisma.TransactionClient,
  choirId: string,
  month: Date,
  currency: string,
) {
  const policy = await tx.contributionPolicy.findFirst({
    where: { choirId, effectiveFrom: { lte: month } },
    orderBy: { effectiveFrom: 'desc' },
  })
  if (!policy) throw new AppError('Configure a contribution policy effective for this month before recording dues.', 409)
  if (policy.currency !== currency) throw new AppError(`Use the contribution policy currency (${policy.currency}) for this payment.`, 400)
}

async function contributionLedger(choirId: string, year: number) {
  const from = monthDate(year, 0)
  const to = monthDate(year + 1, 0)
  const [members, policies, exemptions, payments] = await Promise.all([
    prisma.choirMembership.findMany({
      where: { choirId },
      select: { id: true, joinedAt: true, status: true, user: { select: { name: true } }, section: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.contributionPolicy.findMany({
      where: { choirId, effectiveFrom: { lt: to } },
      orderBy: { effectiveFrom: 'asc' },
    }),
    prisma.contributionExemption.findMany({
      where: { choirId, startsAt: { lt: to }, OR: [{ endsAt: null }, { endsAt: { gte: from } }] },
      include: { membership: { select: { user: { select: { name: true } } } } },
    }),
    prisma.financialRecord.findMany({
      where: {
        choirId, type: 'INCOME', status: 'PAID',
        membershipId: { not: null },
        contributionMonth: { gte: from, lt: to },
      },
      select: { membershipId: true, contributionMonth: true, amount: true, currency: true },
    }),
  ])
  const paymentTotals = new Map<string, number>()
  for (const payment of payments) {
    const key = `${payment.membershipId}:${payment.contributionMonth?.getTime()}:${payment.currency}`
    paymentTotals.set(key, roundMoney((paymentTotals.get(key) ?? 0) + Number(payment.amount)))
  }
  const exemptionsByMember = new Map<string, typeof exemptions>()
  for (const exemption of exemptions) {
    exemptionsByMember.set(exemption.membershipId, [...(exemptionsByMember.get(exemption.membershipId) ?? []), exemption])
  }
  return {
    year,
    currency: policies.at(-1)?.currency ?? 'RWF',
    policy: policies.at(-1) ?? null,
    exemptions: exemptions.map((exemption) => ({
      id: exemption.id,
      membershipId: exemption.membershipId,
      memberName: exemption.membership.user.name,
      startsAt: exemption.startsAt,
      endsAt: exemption.endsAt,
      reason: exemption.reason,
      authorizedById: exemption.authorizedById,
    })),
    months: Array.from({ length: 12 }, (_, monthIndex) => {
      const month = monthDate(year, monthIndex)
      const endOfMonth = monthDate(year, monthIndex + 1)
      const policy = policies.filter((item) => item.effectiveFrom < endOfMonth).at(-1)
      return {
        month: month.toISOString(),
        currency: policy?.currency ?? policies.at(-1)?.currency ?? 'RWF',
        monthlyAmount: roundMoney(Number(policy?.monthlyAmount ?? 0)),
        policyConfigured: Boolean(policy),
        members: members.map((member) => {
          const exemption = (exemptionsByMember.get(member.id) ?? []).some((item) =>
            item.membershipId === member.id && item.startsAt < endOfMonth && (!item.endsAt || item.endsAt >= month),
          )
          const expected = member.status === 'ACTIVE' && member.joinedAt < endOfMonth && !exemption
            ? roundMoney(Number(policy?.monthlyAmount ?? 0))
            : 0
          const currency = policy?.currency ?? policies.at(-1)?.currency ?? 'RWF'
          const paid = paymentTotals.get(`${member.id}:${month.getTime()}:${currency}`) ?? 0
          return {
            membershipId: member.id,
            name: member.user.name,
            section: member.section?.name ?? '',
            active: member.status === 'ACTIVE',
            exempt: exemption,
            expected,
            paid: roundMoney(paid),
            outstanding: roundMoney(Math.max(0, expected - paid)),
          }
        }),
      }
    }),
  }
}

financeRouter.get('/dashboard', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
    const [totals, pendingApprovals, pendingApprovalRecords, missingReceipts, recent, monthly] = await Promise.all([
      prisma.financialRecord.groupBy({
        by: ['currency', 'type', 'status', 'approvalStatus'],
        where: { choirId },
        _sum: { amount: true },
      }),
      prisma.financialRecord.count({ where: { choirId, type: 'EXPENSE', approvalStatus: 'PENDING' } }),
      prisma.financialRecord.findMany({
        where: { choirId, type: 'EXPENSE', approvalStatus: 'PENDING' },
        orderBy: { transactionDate: 'asc' },
        take: 8,
        include: { recordedBy: { select: { id: true, name: true } }, membership: { select: { user: { select: { name: true } } } } },
      }),
      prisma.financialRecord.count({
        where: { choirId, status: 'PAID', OR: [{ receiptStorageName: null, receiptReference: null }] },
      }),
      prisma.financialRecord.findMany({
        where: { choirId }, orderBy: { transactionDate: 'desc' }, take: 8,
        include: { recordedBy: { select: { id: true, name: true } }, membership: { select: { user: { select: { name: true } } } } },
      }),
      prisma.$queryRaw<{ month: Date; currency: string; type: string; total: Prisma.Decimal }[]>`
        SELECT date_trunc('month', "transactionDate") AS month, currency, type, SUM(amount) AS total
        FROM "FinancialRecord"
        WHERE "choirId" = ${choirId}::uuid
          AND status = 'PAID'
          AND ("type" = 'INCOME' OR "approvalStatus" = 'APPROVED')
          AND "transactionDate" >= ${start}
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3
      `,
    ])
    const byCurrency = [...new Set(totals.map((row) => row.currency))].map((currency) => {
      const sum = (type: 'INCOME' | 'EXPENSE', status?: 'PAID') =>
        totals.filter((row) => row.currency === currency && row.type === type && (!status || row.status === status) &&
          (type !== 'EXPENSE' || row.approvalStatus === 'APPROVED' || row.approvalStatus === 'NOT_REQUIRED'))
          .reduce((value, row) => value + Number(row._sum.amount ?? 0), 0)
      const recordedIncome = roundMoney(sum('INCOME', 'PAID'))
      const recordedExpenses = roundMoney(sum('EXPENSE', 'PAID'))
      const outstanding = totals.filter((row) => row.currency === currency && row.status !== 'PAID')
        .reduce((value, row) => value + Number(row._sum.amount ?? 0), 0)
      return { currency, recordedIncome, recordedExpenses, balance: roundMoney(recordedIncome - recordedExpenses), outstanding: roundMoney(outstanding) }
    })
    const ledger = await contributionLedger(choirId, now.getUTCFullYear())
    const currentMonth = ledger.months[now.getUTCMonth()]
    const monthlyDueOutstanding = roundMoney(currentMonth?.members.reduce((sum, item) => sum + item.outstanding, 0) ?? 0)
    const monthlyChart = Array.from({ length: 12 }, (_, index) => {
      const date = monthDate(now.getUTCFullYear(), now.getUTCMonth() - 11 + index)
      return {
        month: date.toISOString(),
        totalsByCurrency: [...new Set(monthly.filter((entry) => entry.month.getTime() === date.getTime()).map((entry) => entry.currency))].map((currency) => ({
          currency,
          income: roundMoney(Number(monthly.find((entry) => entry.month.getTime() === date.getTime() && entry.currency === currency && entry.type === 'INCOME')?.total ?? 0)),
          expenses: roundMoney(Number(monthly.find((entry) => entry.month.getTime() === date.getTime() && entry.currency === currency && entry.type === 'EXPENSE')?.total ?? 0)),
        })),
      }
    })
    res.json({
      totalsByCurrency: byCurrency,
      pendingApprovals,
      pendingApprovalRecords,
      missingReceipts,
      monthlyDueOutstanding,
      monthlyChart,
      recent,
      alerts: [
        ...(pendingApprovals ? [`${pendingApprovals} expense(s) need approval.`] : []),
        ...(missingReceipts ? [`${missingReceipts} paid record(s) have no receipt attached or reference.`] : []),
        ...(monthlyDueOutstanding ? [`${monthlyDueOutstanding.toLocaleString()} ${currentMonth?.currency ?? 'RWF'} in current-month contributions is outstanding.`] : []),
        ...(!currentMonth?.policyConfigured ? ['Set an effective monthly contribution amount to enable dues tracking for this month.'] : []),
      ],
      balanceDisclaimer: 'Recorded balances reflect entries in E-Choir only and are not independently verified bank or cash balances.',
    })
  } catch (error) { next(error) }
})

financeRouter.get('/contributions', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const year = z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()).parse(req.query.year)
    res.json(await contributionLedger(choirId, year))
  } catch (error) { next(error) }
})

financeRouter.post('/contributions/policy', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const input = z.object({
      monthlyAmount: z.coerce.number().min(0).max(999999999999.99).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Use no more than two decimal places.'),
      currency: z.string().trim().regex(/^[A-Z]{3}$/).default('RWF'),
      effectiveFrom: z.coerce.date(),
    }).parse(req.body)
    const existingPolicy = await prisma.contributionPolicy.findFirst({ where: { choirId }, orderBy: { effectiveFrom: 'desc' } })
    if (existingPolicy && existingPolicy.currency !== input.currency) {
      throw new AppError('Contribution currency cannot be changed after the choir has recorded a policy.', 409)
    }
    const effectiveFrom = monthDate(input.effectiveFrom.getUTCFullYear(), input.effectiveFrom.getUTCMonth())
    const policy = await prisma.$transaction(async (tx) => {
      const created = await tx.contributionPolicy.create({
        data: {
          choirId, monthlyAmount: new Prisma.Decimal(input.monthlyAmount), currency: input.currency,
          effectiveFrom, createdById: res.locals.auth.userId,
        },
      })
      await recordAudit(tx, {
        choirId, actorId: res.locals.auth.userId, action: 'CONTRIBUTION_POLICY_CREATED',
        entityType: 'ContributionPolicy', entityId: created.id,
        details: { monthlyAmount: created.monthlyAmount.toString(), currency: created.currency, effectiveFrom },
      })
      return created
    })
    res.status(201).json({ policy })
  } catch (error) { next(error) }
})

financeRouter.post('/contributions/exemptions', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const input = z.object({
      membershipId: z.string().uuid(),
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date().nullable().optional(),
      reason: z.string().trim().min(5).max(1000),
    }).refine(({ startsAt, endsAt }) => !endsAt || endsAt >= startsAt, 'Exemption end must not precede its start.').parse(req.body)
    const member = await prisma.choirMembership.findFirst({
      where: { id: input.membershipId, choirId }, select: { id: true },
    })
    if (!member) throw new AppError('Member not found in this choir.', 404)
    const startsAt = monthDate(input.startsAt.getUTCFullYear(), input.startsAt.getUTCMonth())
    const endsAt = input.endsAt ? monthDate(input.endsAt.getUTCFullYear(), input.endsAt.getUTCMonth()) : null
    const exemption = await prisma.$transaction(async (tx) => {
      const created = await tx.contributionExemption.create({
        data: { choirId, membershipId: member.id, startsAt, endsAt, reason: input.reason, authorizedById: res.locals.auth.userId },
      })
      await recordAudit(tx, {
        choirId, actorId: res.locals.auth.userId, action: 'CONTRIBUTION_EXEMPTION_CREATED',
        entityType: 'ContributionExemption', entityId: created.id,
        details: { membershipId: member.id, startsAt, endsAt, reason: input.reason },
      })
      return created
    })
    res.status(201).json({ exemption })
  } catch (error) { next(error) }
})

financeRouter.get('/contributions/export.csv', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const year = z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()).parse(req.query.year)
    const ledger = await contributionLedger(choirId, year)
    const headers = ['Member', 'Section', ...ledger.months.map((month) => `${new Date(month.month).toLocaleString('en', { month: 'long', timeZone: 'UTC' })} (${month.currency})`), `Expected total (${ledger.currency})`, `Paid total (${ledger.currency})`, `Outstanding (${ledger.currency})`, 'Signature']
    const people = new Map<string, typeof ledger.months[number]['members'][number]>()
    for (const month of ledger.months) for (const member of month.members) people.set(member.membershipId, member)
    const rows = [...people.values()].map((member) => {
      const months = ledger.months.map(({ members, currency }) => {
        const contribution = members.find((item) => item.membershipId === member.membershipId)
        if (!contribution) throw new Error('Contribution register is missing a member-month row.')
        return { ...contribution, currency }
      })
      return [
        member.name, member.section,
        ...months.map((item) => `${item.paid.toFixed(2)} ${item.currency} paid / ${item.outstanding.toFixed(2)} ${item.currency} outstanding${item.exempt ? ' (exempt)' : ''}`),
        `${months.reduce((sum, item) => sum + item.expected, 0).toFixed(2)} ${ledger.currency}`,
        `${months.reduce((sum, item) => sum + item.paid, 0).toFixed(2)} ${ledger.currency}`,
        `${months.reduce((sum, item) => sum + item.outstanding, 0).toFixed(2)} ${ledger.currency}`, '',
      ]
    })
    res.type('text/csv').attachment(`choir-contributions-${year}.csv`)
      .send([headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'))
  } catch (error) { next(error) }
})

financeRouter.get('/contributions/print', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const year = z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()).parse(req.query.year)
    const ledger = await contributionLedger(choirId, year)
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
    )
    const members = new Map<string, typeof ledger.months[number]['members'][number]>()
    for (const month of ledger.months) for (const member of month.members) members.set(member.membershipId, member)
    const head = ledger.months.map((month) => `<th>${new Date(month.month).toLocaleString('en', { month: 'short', timeZone: 'UTC' })}<br>${escapeHtml(month.currency)}</th>`).join('')
    const body = [...members.values()].map((member) => {
      const monthlyRows = ledger.months.map(({ members: monthMembers, currency }) => {
        const item = monthMembers.find((candidate) => candidate.membershipId === member.membershipId)
        if (!item) throw new Error('Contribution register is missing a member-month row.')
        return { ...item, currency }
      })
      const cells = monthlyRows.map((item) => `<td>${item.exempt ? 'Exempt' : `Paid ${item.paid.toFixed(2)} / Due ${item.expected.toFixed(2)} / Owed ${item.outstanding.toFixed(2)} ${escapeHtml(item.currency)}`}</td>`).join('')
      const paidTotal = monthlyRows.reduce((sum, item) => sum + item.paid, 0)
      const outstandingTotal = monthlyRows.reduce((sum, item) => sum + item.outstanding, 0)
      return `<tr><td>${escapeHtml(member.name)}</td><td>${escapeHtml(member.section)}</td>${cells}<td>${paidTotal.toFixed(2)} ${escapeHtml(ledger.currency)}</td><td>${outstandingTotal.toFixed(2)} ${escapeHtml(ledger.currency)}</td><td class="sign"></td></tr>`
    }).join('')
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Contribution register ${year}</title><style>
      @page{size:landscape;margin:10mm}body{font:8px Arial,sans-serif;color:#222}h1{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:3px;text-align:left}th{background:#eee}.sign{min-width:70px;height:28px}
      </style></head><body><h1>Choir contribution register — ${year}</h1><p>Each month shows Paid / Due / Owed (${escapeHtml(ledger.currency)}). Recorded contributions are not independent proof of funds. Signatures confirm receipt only when signed by an authorized representative.</p><p>Use your browser’s Print command to print this register or save it as a PDF.</p><table><thead><tr><th>Member</th><th>Section</th>${head}<th>Year paid (${escapeHtml(ledger.currency)})</th><th>Year owed (${escapeHtml(ledger.currency)})</th><th>Signature</th></tr></thead><tbody>${body}</tbody></table></body></html>`)
  } catch (error) { next(error) }
})

financeRouter.get('/budgets', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const budgets = await prisma.financialBudget.findMany({ where: { choirId }, orderBy: { startsAt: 'desc' }, take: 200 })
    const withSpending = await Promise.all(budgets.map(async (budget) => {
      const [result, event] = await Promise.all([
        prisma.financialRecord.aggregate({
          where: {
            choirId, type: 'EXPENSE', status: 'PAID', approvalStatus: 'APPROVED',
            currency: budget.currency, category: { equals: budget.category, mode: 'insensitive' },
            transactionDate: { gte: budget.startsAt, lt: new Date(budget.endsAt.getTime() + 24 * 60 * 60 * 1000) },
          },
          _sum: { amount: true },
        }),
        budget.eventId
          ? prisma.choirEvent.findFirst({ where: { id: budget.eventId, choirId }, select: { title: true } })
          : Promise.resolve(null),
      ])
      const spent = roundMoney(Number(result._sum.amount ?? 0))
      const remaining = roundMoney(Number(budget.amount) - spent)
      return { ...budget, eventTitle: event?.title ?? null, spent, remaining, overspent: remaining < 0 }
    }))
    res.json({ budgets: withSpending })
  } catch (error) { next(error) }
})

financeRouter.get('/events', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const events = await prisma.choirEvent.findMany({
      where: { choirId },
      select: { id: true, title: true },
      orderBy: { startsAt: 'desc' },
      take: 100,
    })
    res.json({ events })
  } catch (error) { next(error) }
})

financeRouter.get('/members', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const query = z.object({
      search: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(100),
    }).parse(req.query)
    const where: Prisma.ChoirMembershipWhereInput = {
      choirId,
      status: 'ACTIVE',
      ...(query.search ? { user: { name: { contains: query.search, mode: 'insensitive' } } } : {}),
    }
    const [total, result] = await Promise.all([
      prisma.choirMembership.count({ where }),
      prisma.choirMembership.findMany({
        where,
        select: { id: true, user: { select: { name: true } }, section: { select: { name: true } } },
        orderBy: { user: { name: 'asc' } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    res.json({ members: result, pagination: { page: query.page, pageSize: query.pageSize, total } })
  } catch (error) { next(error) }
})

financeRouter.post('/budgets', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const input = z.object({
      name: z.string().trim().min(1).max(160), category: z.string().trim().min(1).max(100),
      amount: z.coerce.number().positive().max(999999999999.99).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Use no more than two decimal places.'),
      currency: z.string().trim().regex(/^[A-Z]{3}$/).default('RWF'),
      startsAt: z.coerce.date(), endsAt: z.coerce.date(), eventId: z.string().uuid().nullable().optional(),
    }).refine(({ startsAt, endsAt }) => endsAt >= startsAt, 'Budget end date must not precede its start date.').parse(req.body)
    if (input.eventId && !await prisma.choirEvent.findFirst({ where: { id: input.eventId, choirId }, select: { id: true } })) {
      throw new AppError('Event not found in this choir.', 404)
    }
    const budget = await prisma.$transaction(async (tx) => {
      const created = await tx.financialBudget.create({
        data: { ...input, amount: new Prisma.Decimal(input.amount), choirId, createdById: res.locals.auth.userId },
      })
      await recordAudit(tx, {
        choirId, actorId: res.locals.auth.userId, action: 'FINANCIAL_BUDGET_CREATED',
        entityType: 'FinancialBudget', entityId: created.id,
        details: { name: created.name, amount: created.amount.toString(), currency: created.currency },
      })
      return created
    })
    res.status(201).json({ budget })
  } catch (error) { next(error) }
})

financeRouter.post('/:recordId/approval', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const recordId = z.string().uuid().parse(req.params.recordId)
    const { decision, reason } = z.object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      reason: z.string().trim().min(5).max(1000),
    }).parse(req.body)
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.financialRecord.findFirst({ where: { id: recordId, choirId } })
      if (!record) throw new AppError('Financial record not found in this choir.', 404)
      if (record.type !== 'EXPENSE' || record.approvalStatus !== 'PENDING') throw new AppError('This expense is not awaiting approval.', 409)
      if (record.recordedById === res.locals.auth.userId) throw new AppError('A different authorized user must approve or reject this expense.', 403)
      if (decision === 'APPROVED' && !record.receiptStorageName && !record.receiptReference) {
        throw new AppError('Attach a receipt file or enter an external receipt reference before approval.', 409)
      }
      const after = await tx.financialRecord.update({
        where: { id: recordId },
        data: {
          approvalStatus: decision,
          approvedAt: decision === 'APPROVED' ? new Date() : null,
          approvedById: decision === 'APPROVED' ? res.locals.auth.userId : null,
        },
      })
      await tx.financialAudit.create({
        data: { financialRecordId: recordId, actorId: res.locals.auth.userId, action: decision, reason, before: recordSnapshot(record), after: recordSnapshot(after) },
      })
      await recordAudit(tx, { choirId, actorId: res.locals.auth.userId, action: `FINANCIAL_EXPENSE_${decision}`, entityType: 'FinancialRecord', entityId: recordId, details: { reason } })
      return after
    })
    res.json({ record: updated })
  } catch (error) { next(error) }
})

financeRouter.post('/:recordId/verify', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const recordId = z.string().uuid().parse(req.params.recordId)
    const { reason } = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(req.body)
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.financialRecord.findFirst({ where: { id: recordId, choirId } })
      if (!record) throw new AppError('Financial record not found in this choir.', 404)
      if (record.status !== 'PAID' || (record.type === 'EXPENSE' && record.approvalStatus !== 'APPROVED')) {
        throw new AppError('Only paid income or approved paid expenses can be verified.', 409)
      }
      if (record.recordedById === res.locals.auth.userId) throw new AppError('A different authorized user must verify this record.', 403)
      if (record.verifiedAt) throw new AppError('This record has already been verified.', 409)
      const after = await tx.financialRecord.update({ where: { id: recordId }, data: { verifiedAt: new Date() } })
      await tx.financialAudit.create({
        data: { financialRecordId: recordId, actorId: res.locals.auth.userId, action: 'VERIFIED', reason, before: recordSnapshot(record), after: recordSnapshot(after) },
      })
      await recordAudit(tx, { choirId, actorId: res.locals.auth.userId, action: 'FINANCIAL_RECORD_VERIFIED', entityType: 'FinancialRecord', entityId: recordId, details: { reason } })
      return after
    })
    res.json({ record: updated })
  } catch (error) { next(error) }
})

financeRouter.post(
  '/:recordId/receipt',
  async (req, res, next) => {
    try {
      const choirId = getChoirId(req)
      await financialMembership(choirId, res.locals.auth.userId, res)
      next()
    } catch (error) { next(error) }
  },
  (req, res, next) => {
    const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!receiptTypes[contentType]) return next(new AppError('Receipts must be PDF, JPEG, PNG, or WebP files.', 415))
    return next()
  },
  raw({ type: Object.keys(receiptTypes), limit: '10mb' }),
  async (req, res, next) => {
    try {
      const choirId = getChoirId(req)
      await financialMembership(choirId, res.locals.auth.userId, res)
      const recordId = z.string().uuid().parse(req.params.recordId)
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError('Select a non-empty receipt file.', 400)
      const record = await prisma.financialRecord.findFirst({ where: { id: recordId, choirId }, select: { id: true, receiptStorageName: true } })
      if (!record) throw new AppError('Financial record not found in this choir.', 404)
      const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? ''
      const storageName = `${randomUUID()}.${receiptTypes[contentType]}`
      const directory = resolve(receiptRoot, choirId)
      await mkdir(directory, { recursive: true })
      if (!validReceiptSignature(req.body, contentType)) throw new AppError('The receipt file does not match its declared type.', 415)
      await writeFile(resolve(directory, storageName), req.body, { flag: 'wx', mode: 0o600 })
      try {
        await prisma.$transaction(async (tx) => {
          await tx.financialRecord.update({
            where: { id: recordId },
            data: { receiptStorageName: storageName, receiptContentType: contentType, receiptSizeBytes: req.body.length },
          })
          await tx.financialAudit.create({
            data: { financialRecordId: recordId, actorId: res.locals.auth.userId, action: 'RECEIPT_ATTACHED', reason: null },
          })
          await recordAudit(tx, { choirId, actorId: res.locals.auth.userId, action: 'FINANCIAL_RECEIPT_ATTACHED', entityType: 'FinancialRecord', entityId: recordId, details: { contentType, sizeBytes: req.body.length } })
        })
      } catch (error) {
        try {
          await unlink(resolve(directory, storageName))
        } catch (cleanupError) {
          console.error('finance_receipt_cleanup_failed', {
            choirId, recordId, name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          })
        }
        throw error
      }
      if (record.receiptStorageName) {
        try {
          await unlink(resolve(directory, record.receiptStorageName))
        } catch (cleanupError) {
          console.error('finance_receipt_replacement_cleanup_failed', {
            choirId, recordId, name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          })
        }
      }
      res.status(201).json({ attached: true })
    } catch (error) { next(error) }
  },
)

financeRouter.get('/:recordId/receipt', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const recordId = z.string().uuid().parse(req.params.recordId)
    const record = await prisma.financialRecord.findFirst({
      where: { id: recordId, choirId },
      select: { receiptStorageName: true, receiptContentType: true, category: true },
    })
    if (!record?.receiptStorageName || !record.receiptContentType) throw new AppError('No receipt file is attached.', 404)
    const extension = receiptTypes[record.receiptContentType]
    if (!extension) throw new AppError('The stored receipt type is invalid.', 500)
    res.setHeader('Cache-Control', 'private, no-store')
    res.download(resolve(receiptRoot, choirId, record.receiptStorageName), `receipt.${extension}`, (error) => {
      if (error && !res.headersSent) next(error)
    })
  } catch (error) { next(error) }
})

financeRouter.get('/', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const filters = filterSchema.parse(req.query)
    const where = buildWhere(choirId, filters)
    const [records, total, groupedTotals] = await Promise.all([
      prisma.financialRecord.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: {
          recordedBy: { select: { id: true, name: true } },
          membership: { select: { id: true, user: { select: { name: true } } } },
          approvedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.financialRecord.count({ where }),
      prisma.financialRecord.groupBy({
        by: ['currency', 'type', 'status', 'approvalStatus'],
        where,
        _sum: { amount: true },
        orderBy: { currency: 'asc' },
      }),
    ])
    res.json({
      records,
      pagination: { page: filters.page, pageSize: filters.pageSize, total },
      summary: {
        totalsByCurrency: [...new Set(groupedTotals.map((row) => row.currency))].map((currency) => {
          const amount = (type: 'INCOME' | 'EXPENSE', status: 'PAID' | 'PENDING' | 'PARTIALLY_PAID') =>
            groupedTotals.filter((row) => row.currency === currency && row.type === type && row.status === status &&
              (type !== 'EXPENSE' || row.approvalStatus === 'APPROVED' || row.approvalStatus === 'NOT_REQUIRED'))
              .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0)
          const recordedIncome = amount('INCOME', 'PAID')
          const recordedExpenses = amount('EXPENSE', 'PAID')
          return {
            currency,
            recordedIncome,
            recordedExpenses,
            balance: recordedIncome - recordedExpenses,
            outstanding: Number(groupedTotals.filter((row) => row.currency === currency && row.status !== 'PAID' &&
              (row.type !== 'EXPENSE' || row.approvalStatus === 'APPROVED' || row.approvalStatus === 'NOT_REQUIRED'))
              .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0)),
          }
        }),
        note: 'Figures reflect records entered in E-Choir; they are not payment processing or independent verification.',
      },
    })
  } catch (error) { next(error) }
})

financeRouter.get('/export.csv', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const filters = filterSchema.parse(req.query)
    const records = await prisma.financialRecord.findMany({
      where: buildWhere(choirId, filters), orderBy: [{ transactionDate: 'desc' }, { id: 'asc' }],
      include: {
        recordedBy: { select: { name: true } },
        membership: { select: { user: { select: { name: true } } } },
        approvedBy: { select: { name: true } },
      },
    })
    const header = ['Date', 'Type', 'Status', 'Approval', 'Amount', 'Currency', 'Category', 'Payer/member', 'Beneficiary', 'Contribution month', 'Payment method', 'Reference', 'Description', 'Receipt reference', 'Receipt file', 'Recorded by', 'Approved by', 'Verified']
    const rows = records.map((record) => [
      record.transactionDate, record.type, record.status, record.approvalStatus, record.amount, record.currency, record.category,
      record.membership?.user.name ?? record.payerName, record.beneficiary, record.contributionMonth,
      record.paymentMethod, record.referenceNumber, record.description, record.receiptReference,
      Boolean(record.receiptStorageName), record.recordedBy.name, record.approvedBy?.name, record.verifiedAt,
    ])
    res.type('text/csv').attachment('choir-financial-records.csv')
      .send([header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'))
  } catch (error) { next(error) }
})

financeRouter.get('/print', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const filters = filterSchema.parse(req.query)
    const where = buildWhere(choirId, filters)
    const [records, totals] = await Promise.all([
      prisma.financialRecord.findMany({
        where, orderBy: [{ transactionDate: 'desc' }, { id: 'asc' }],
        include: { membership: { select: { user: { select: { name: true } } } }, recordedBy: { select: { name: true } } },
      }),
      prisma.financialRecord.groupBy({
        by: ['currency', 'type', 'status', 'approvalStatus'],
        where,
        _sum: { amount: true },
      }),
    ])
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
    )
    const summaries = [...new Set(totals.map((row) => row.currency))].map((currency) => {
      const total = (type: 'INCOME' | 'EXPENSE') => roundMoney(totals
        .filter((row) => row.currency === currency && row.type === type && row.status === 'PAID' &&
          (type !== 'EXPENSE' || row.approvalStatus === 'APPROVED' || row.approvalStatus === 'NOT_REQUIRED'))
        .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0))
      const income = total('INCOME')
      const expenses = total('EXPENSE')
      return `<p><strong>${escapeHtml(currency)}:</strong> recorded income ${income.toFixed(2)} · approved expenses ${expenses.toFixed(2)} · balance ${roundMoney(income - expenses).toFixed(2)}</p>`
    }).join('')
    const body = records.map((record) => `<tr>
      <td>${record.transactionDate.toISOString().slice(0, 10)}</td><td>${record.type}<br>${record.status}</td>
      <td>${escapeHtml(record.category)}</td><td>${escapeHtml(record.membership?.user.name ?? record.payerName ?? '')}</td>
      <td>${escapeHtml(record.beneficiary ?? '')}</td><td>${escapeHtml(record.description)}</td>
      <td>${escapeHtml(record.amount.toString())} ${escapeHtml(record.currency)}</td>
      <td>${record.type === 'EXPENSE' ? record.approvalStatus : (record.verifiedAt ? 'Verified' : 'Unverified')}</td>
      <td>${escapeHtml(record.receiptReference ?? '')}</td><td>${escapeHtml(record.recordedBy.name)}</td>
    </tr>`).join('')
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Choir financial report</title><style>
      @page{size:landscape;margin:10mm}body{font:9px Arial,sans-serif;color:#222}h1{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px;text-align:left;vertical-align:top}th{background:#eee}
      </style></head><body><h1>Choir financial report</h1><p>Filtered records: ${records.length}. Figures are recorded entries, not independent proof of cash or bank balances.</p>${summaries}<p>Use your browser’s Print command to print this report or save it as a PDF.</p><table><thead><tr><th>Date</th><th>Type / payment status</th><th>Category</th><th>Payer / member</th><th>Beneficiary</th><th>Description</th><th>Amount</th><th>Approval / verification</th><th>Receipt reference</th><th>Recorded by</th></tr></thead><tbody>${body}</tbody></table></body></html>`)
  } catch (error) { next(error) }
})

financeRouter.post('/', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const input = createRecordSchema.parse(req.body)
    if (input.contributionMonth && !input.membershipId) throw new AppError('A contribution month requires a choir member.', 400)
    if (input.membershipId && input.type !== 'INCOME') throw new AppError('Member dues and contributions must be recorded as income.', 400)
    const isContribution = /dues|contribution/i.test(input.category)
    if (isContribution && (!input.membershipId || !input.contributionMonth || input.status !== 'PAID')) {
      throw new AppError('A member contribution requires a member, contribution month, and externally paid status.', 400)
    }
    if (input.membershipId && !await prisma.choirMembership.findFirst({
      where: { id: input.membershipId, choirId }, select: { id: true },
    })) throw new AppError('Member not found in this choir.', 404)
    const contributionMonth = input.contributionMonth
      ? monthDate(input.contributionMonth.getUTCFullYear(), input.contributionMonth.getUTCMonth())
      : null
    const created = await prisma.$transaction(async (tx) => {
      if (isContribution && contributionMonth) {
        await requireContributionPolicy(tx, choirId, contributionMonth, input.currency)
      }
      const record = await tx.financialRecord.create({
        data: {
          type: input.type,
          status: input.status,
          approvalStatus: input.type === 'EXPENSE' ? 'PENDING' : 'NOT_REQUIRED',
          transactionDate: input.transactionDate,
          amount: new Prisma.Decimal(input.amount),
          currency: input.currency,
          category: input.category,
          payerName: input.payerName ?? null,
          beneficiary: input.beneficiary ?? null,
          membershipId: input.membershipId ?? null,
          contributionMonth,
          paymentMethod: input.paymentMethod ?? null,
          referenceNumber: input.referenceNumber ?? null,
          description: input.description,
          receiptReference: input.receiptReference ?? null,
          choirId,
          recordedById: res.locals.auth.userId,
          verifiedAt: null,
          approvedAt: null,
          approvedById: null,
        },
        include: { recordedBy: { select: { id: true, name: true } }, membership: { select: { user: { select: { name: true } } } } },
      })
      await tx.financialAudit.create({
        data: {
          financialRecordId: record.id,
          actorId: res.locals.auth.userId,
          action: 'CREATED',
          after: recordSnapshot(record),
        },
      })
      await recordAudit(tx, {
        choirId, actorId: res.locals.auth.userId, action: 'FINANCIAL_RECORD_CREATED',
        entityType: 'FinancialRecord', entityId: record.id,
        details: { type: record.type, status: record.status, amount: record.amount.toString() },
      })
      return record
    })
    res.status(201).json({ record: created })
  } catch (error) { next(error) }
})

financeRouter.patch('/:recordId', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    const recordId = z.string().uuid().parse(req.params.recordId)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const input = recordInputSchema.partial().extend({
      reason: z.string().trim().min(5).max(1000),
    }).refine((value) => Object.keys(value).some((key) => key !== 'reason')).parse(req.body)
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.financialRecord.findFirst({ where: { id: recordId, choirId } })
      if (!before) throw new AppError('Financial record not found in this choir.', 404)
      const { reason, ...changes } = input
      const membershipId = changes.membershipId ?? before.membershipId
      const type = changes.type ?? before.type
      const category = changes.category ?? before.category
      const status = changes.status ?? before.status
      const contributionMonth = changes.contributionMonth === undefined
        ? before.contributionMonth
        : changes.contributionMonth
          ? monthDate(changes.contributionMonth.getUTCFullYear(), changes.contributionMonth.getUTCMonth())
          : null
      if (membershipId && type !== 'INCOME') throw new AppError('Member dues and contributions must be income records.', 400)
      if (contributionMonth && !/dues|contribution/i.test(category)) throw new AppError('A contribution month can only be recorded for dues or contribution income.', 400)
      if (/dues|contribution/i.test(category) && (!membershipId || !contributionMonth || status !== 'PAID')) {
        throw new AppError('A member contribution requires a member, contribution month, and externally paid status.', 400)
      }
      if (/dues|contribution/i.test(category) && contributionMonth) {
        await requireContributionPolicy(tx, choirId, contributionMonth, changes.currency ?? before.currency)
      }
      if (changes.membershipId && !await tx.choirMembership.findFirst({ where: { id: changes.membershipId, choirId }, select: { id: true } })) {
        throw new AppError('Member not found in this choir.', 404)
      }
      const updated = await tx.financialRecord.update({
        where: { id: recordId },
        data: {
          ...changes,
          contributionMonth,
          ...(changes.amount !== undefined ? { amount: new Prisma.Decimal(changes.amount) } : {}),
          ...(type === 'EXPENSE'
            ? { approvalStatus: 'PENDING', approvedAt: null, approvedById: null }
            : before.type === 'EXPENSE'
              ? { approvalStatus: 'NOT_REQUIRED', approvedAt: null, approvedById: null }
              : {}),
          verifiedAt: null,
        },
        include: { recordedBy: { select: { id: true, name: true } } },
      })
      await tx.financialAudit.create({
        data: {
          financialRecordId: recordId, actorId: res.locals.auth.userId, action: 'UPDATED', reason,
          before: recordSnapshot(before),
          after: recordSnapshot(updated),
        },
      })
      await recordAudit(tx, { choirId, actorId: res.locals.auth.userId, action: 'FINANCIAL_RECORD_UPDATED', entityType: 'FinancialRecord', entityId: recordId, details: { reason } })
      return updated
    })
    res.json({ record: result })
  } catch (error) { next(error) }
})

financeRouter.get('/:recordId/audit', async (req, res, next) => {
  try {
    const choirId = getChoirId(req)
    const recordId = z.string().uuid().parse(req.params.recordId)
    await financialMembership(choirId, res.locals.auth.userId, res)
    const record = await prisma.financialRecord.findFirst({ where: { id: recordId, choirId }, select: { id: true } })
    if (!record) throw new AppError('Financial record not found in this choir.', 404)
    const entries = await prisma.financialAudit.findMany({
      where: { financialRecordId: recordId }, orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, name: true } } },
    })
    res.json({ entries })
  } catch (error) { next(error) }
})

import { z } from 'zod'

export const songSchema = z.object({
  title: z.string().trim().min(1).max(160),
  composer: z.string().trim().max(160).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  language: z.string().trim().max(80).nullable().optional(),
  lyrics: z.string().max(20000).nullable().optional(),
  musicalKey: z.string().trim().max(20).nullable().optional(),
  bpm: z.number().int().min(20).max(400).nullable().optional(),
  durationSec: z.number().int().min(1).max(86400).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

const rehearsalFields = {
  title: z.string().trim().min(1).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  venue: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
}

export const rehearsalSchema = z
  .object(rehearsalFields)
  .refine((data) => data.endsAt > data.startsAt, {
    path: ['endsAt'],
    message: 'End time must be after the start time.',
  })

export const rehearsalChangesSchema = z.object(rehearsalFields).partial()

export const announcementSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5000),
  targetSectionId: z.string().uuid().nullable().optional(),
})

export const taskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  targetSectionId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
})

export const practiceSchema = z.object({
  songId: z.string().uuid(),
  sectionId: z.string().uuid().nullable().optional(),
  membershipId: z.string().uuid().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
}).refine(
  ({ sectionId, membershipId }) => !(sectionId && membershipId),
  'Assign practice to either a section, a member, or the whole choir.',
)

export const eventSchema = z.object({
  title: z.string().trim().min(1).max(160),
  type: z.enum(['CONCERT', 'WORSHIP', 'PERFORMANCE', 'OTHER']),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  deadlineAt: z.coerce.date().nullable().optional(),
  venue: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  songIds: z.array(z.string().uuid()).max(100).default([]),
  participantIds: z.array(z.string().uuid()).max(500).default([]),
}).refine(({ startsAt, endsAt }) => endsAt > startsAt, {
  path: ['endsAt'],
  message: 'End time must be after the start time.',
})

export const attendanceSchema = z.object({
  records: z.array(z.object({
    membershipId: z.string().uuid(),
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
    note: z.string().trim().max(500).nullable().optional(),
  })).min(1).max(500),
})

export const noteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10000),
  rehearsalId: z.string().uuid().nullable().optional(),
})

export const resourceSchema = z.object({
  title: z.string().trim().min(1).max(160),
  type: z.enum(['SHEET_MUSIC', 'PDF', 'AUDIO', 'SOPRANO_TRACK', 'ALTO_TRACK', 'TENOR_TRACK', 'BASS_TRACK', 'OTHER']),
  url: z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:', 'Resources must use HTTPS.'),
})

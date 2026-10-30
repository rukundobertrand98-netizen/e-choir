import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { normalizeChoirName, normalizeLoginName } from '../src/identity.js'

const prisma = new PrismaClient()

async function main() {
  let choir = await prisma.choir.findFirst({ where: { name: 'Sample Choir' } })
  if (!choir) {
    choir = await prisma.choir.create({
      data: {
        name: 'Sample Choir',
        nameKey: normalizeChoirName('Sample Choir'),
        timezone: 'Africa/Kigali',
        currency: 'RWF',
      },
    })
  }

  for (const name of ['Soprano', 'Alto', 'Tenor', 'Bass']) {
    await prisma.vocalSection.upsert({
      where: { choirId_name: { choirId: choir.id, name } },
      update: {},
      create: { choirId: choir.id, name },
    })
  }

  await prisma.song.upsert({
    where: { choirId_title: { choirId: choir.id, title: 'Sample Hymn' } },
    update: {},
    create: {
      choirId: choir.id,
      title: 'Sample Hymn',
      category: 'Hymn',
      language: 'English',
      musicalKey: 'C',
      status: 'PUBLISHED',
    },
  })

  const rehearsalStart = new Date()
  rehearsalStart.setUTCDate(rehearsalStart.getUTCDate() + 1)
  rehearsalStart.setUTCHours(17, 0, 0, 0)
  const rehearsalEnd = new Date(rehearsalStart.getTime() + 90 * 60 * 1000)
  const existingRehearsal = await prisma.rehearsal.findFirst({
    where: { choirId: choir.id, title: 'Sample choir practice' },
  })
  const rehearsalData = {
    startsAt: rehearsalStart,
    endsAt: rehearsalEnd,
    venue: 'Choir room',
    description: 'A development-only example rehearsal.',
  }
  if (existingRehearsal) {
    await prisma.rehearsal.update({
      where: { id: existingRehearsal.id },
      data: rehearsalData,
    })
  } else {
    await prisma.rehearsal.create({
      data: {
        choirId: choir.id,
        title: 'Sample choir practice',
        ...rehearsalData,
      },
    })
  }

  const demoName = process.env.DEMO_NAME?.trim().replace(/\s+/g, ' ') || 'Choir Administrator'
  const demoPassword = process.env.DEMO_PASSWORD
  if (demoPassword) {
    if (demoPassword.length < 10) {
      throw new Error('DEMO_PASSWORD must be at least 10 characters long.')
    }
    const passwordHash = await bcrypt.hash(demoPassword, 12)
    const loginName = normalizeLoginName(demoName)
    const existingMembership = await prisma.choirMembership.findFirst({
      where: { choirId: choir.id, loginName },
      select: { userId: true },
    })
    if (existingMembership) {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: existingMembership.userId },
          data: { name: demoName, passwordHash },
        }),
        prisma.choirMembership.update({
          where: {
            choirId_loginName: { choirId: choir.id, loginName },
          },
          data: { role: 'ADMIN', status: 'ACTIVE' },
        }),
      ])
    } else {
      const user = await prisma.user.create({
        data: { name: demoName, passwordHash },
      })
      await prisma.choirMembership.create({
        data: {
          userId: user.id,
          choirId: choir.id,
          loginName,
          role: 'ADMIN',
        },
      })
    }
  }
  const superAdminUserId = process.env.PLATFORM_SUPER_ADMIN_USER_ID?.trim()
  if (superAdminUserId) {
    const updated = await prisma.user.updateMany({
      where: { id: superAdminUserId },
      data: { platformRole: 'SUPER_ADMIN' },
    })
    if (updated.count !== 1) {
      throw new Error('PLATFORM_SUPER_ADMIN_USER_ID did not match an existing account.')
    }
    console.info('The configured account was promoted to platform super administrator.')
  }
  console.info('Development sample choir, vocal sections, and song are ready.')
}

main()
  .catch((error: unknown) => {
    console.error('Database seeding failed.', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

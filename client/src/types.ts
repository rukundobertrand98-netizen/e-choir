export interface User {
  id: string
  name: string
  language: Language
  platformRole: 'USER' | 'SUPER_ADMIN'
  mustChangePassword: boolean
  memberships: Membership[]
}

export type Language = 'EN' | 'RW' | 'FR'

export interface Membership {
  id: string
  role: string
  status: string
  joinedAt: string
  choir: { id: string; name: string; timezone: string; currency: string; status: string }
  section: { id: string; name: string } | null
  user?: { id: string; name: string; language: Language }
}

export interface ChoirMember {
  id: string
  role: string
  status: string
  joinedAt: string
  user: { id: string; name: string; language: Language }
  section: { id: string; name: string } | null
}

export interface Song {
  id: string
  title: string
  composer: string | null
  category: string | null
  language: string | null
  lyrics: string | null
  musicalKey: string | null
  bpm: number | null
  durationSec: number | null
  notes: string | null
  createdAt: string
}

export interface Rehearsal {
  id: string
  title: string
  startsAt: string
  endsAt: string
  venue: string | null
  description: string | null
  cancelledAt: string | null
}

export interface DashboardData {
  stats: {
    activeMembers: number
    publishedSongs: number
    upcomingRehearsals: number
  }
  upcomingRehearsals: Rehearsal[]
  sections: { id: string; name: string; members: number }[]
  recentSongs: Pick<Song, 'id' | 'title' | 'composer' | 'musicalKey'>[]
}

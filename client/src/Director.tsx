import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Check, ClipboardList, Download, Megaphone, Music2, Plus, UsersRound } from 'lucide-react'
import { api } from './api'
import { dateTimeLocalToIso, isoToDateTimeLocal } from './date-time'
import { translateText } from './i18n'
import type { Language, Membership, Rehearsal, Song } from './types'

type Overview = {
  stats: {
    totalMembers: number
    activeMembers: number
    upcomingRehearsals: number
    upcomingEvents: number
    songReadiness: Record<'ready' | 'learning' | 'needsPractice' | 'notStarted', number>
  }
  upcomingRehearsals: (Rehearsal & { songs: { song: { id: string; title: string } }[] })[]
  upcomingEvents: EventItem[]
  recentAttendance: { id: string; status: string; membership: { user: { name: string }; section: { name: string } | null }; rehearsal: { title: string; startsAt: string } }[]
  songs: (Song & { resources: SongResource[] })[]
  practices: PracticeItem[]
  announcements: AnnouncementItem[]
  tasks: TaskItem[]
  sections: { id: string; name: string; _count: { memberships: number } }[]
  notes: { id: string; title: string; body: string; createdAt: string }[]
  recentActivity: { id: string; action: string; entityType: string; createdAt: string }[]
}
type EventItem = {
  id: string; title: string; type: string; startsAt: string; endsAt: string; deadlineAt: string | null
  venue: string | null; description: string | null; songs: { song: { id: string; title: string } }[]
  participants: { membershipId: string }[]
}
type SongResource = { id: string; title: string; type: string; url: string }
type PracticeItem = { id: string; status: string; dueAt: string | null; note: string | null; song: { id: string; title: string; composer: string | null }; section: { id: string; name: string } | null; membership: { id: string; user: { name: string } } | null }
type TaskItem = { id: string; title: string; description: string | null; dueAt: string | null; status: string; targetSection: { name: string } | null; assignedTo: { user: { name: string } } | null }
type AnnouncementItem = { id: string; title: string; body: string; publishedAt: string; targetSection: { name: string } | null }
type MemberOption = { id: string; user: { name: string }; section: { name: string } | null }
type ReportData = {
  attendance: { status: string; recordedAt: string; membership: { user: { name: string }; section: { name: string } | null }; rehearsal: { title: string; startsAt: string } }[]
  tasks: { status: string; _count: { _all: number } }[]
  practice: { status: string; _count: { _all: number } }[]
  practiceBySection: { label: string; count: number }[]
  memberParticipation: { label: string; count: number }[]
  events: { title: string; type: string; startsAt: string; endsAt: string; deadlineAt: string | null; venue: string | null; _count: { participants: number } }[]
  eventCount: number
}
type TabName = 'Overview' | 'Training' | 'Events' | 'Communication' | 'Attendance & notes' | 'Reports'

const statusNames: Record<string, string> = {
  NOT_STARTED: 'Not started', LEARNING: 'Learning', NEEDS_PRACTICE: 'Needs practice', READY: 'Ready',
  OPEN: 'Open', IN_PROGRESS: 'In progress', DONE: 'Done',
  PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused',
}
const tabs: TabName[] = ['Overview', 'Training', 'Events', 'Communication', 'Attendance & notes', 'Reports']

export default function Director({ membership, language }: { membership: Membership; language: Language }) {
  const tx = (text: string) => translateText(language, text)
  const statusLabel = (status: string) => tx(statusNames[status] ?? status)
  const choirId = membership.choir.id
  const canManage = ['ADMIN', 'DIRECTOR'].includes(membership.role)
  const canLead = canManage || membership.role === 'SECTION_LEADER'
  const [tab, setTab] = useState<TabName>('Overview')
  const [selectedRehearsalId, setSelectedRehearsalId] = useState('')
  const [attendancePage, setAttendancePage] = useState(1)
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null)
  const [resourceSongId, setResourceSongId] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [eventSearch, setEventSearch] = useState('')
  const [eventPage, setEventPage] = useState(1)
  const [report, setReport] = useState<ReportData | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [error, setError] = useState('')
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: ['director-overview', choirId],
    queryFn: () => api<Overview>(`/choirs/${choirId}/director/overview`),
    refetchInterval: 60_000,
  })
  const memberQuery = useQuery({
    queryKey: ['director-members', choirId, memberSearch],
    queryFn: () => api<{ members: MemberOption[]; pagination: { total: number } }>(`/choirs/${choirId}/members?search=${encodeURIComponent(memberSearch)}&page=1&pageSize=100`),
  })
  const rehearsalQuery = useQuery({
    queryKey: ['rehearsals', choirId],
    queryFn: () => api<{ rehearsals: (Rehearsal & { songs: { songId: string; song: { id: string; title: string } }[] })[] }>(`/choirs/${choirId}/rehearsals`),
    enabled: tab === 'Attendance & notes',
  })
  const eventsQuery = useQuery({
    queryKey: ['director-events', choirId, eventSearch, eventPage],
    queryFn: () => api<{ events: EventItem[]; pagination: { page: number; pageSize: number; total: number } }>(
      `/choirs/${choirId}/director/events?search=${encodeURIComponent(eventSearch)}&page=${eventPage}&pageSize=25`,
    ),
    enabled: tab === 'Events',
  })
  const attendanceQuery = useQuery({
    queryKey: ['director-attendance', choirId, selectedRehearsalId, attendancePage],
    queryFn: () => api<{ rehearsal: Rehearsal; pagination: { page: number; pageSize: number; total: number }; members: (MemberOption & { status: string | null; note: string | null })[] }>(`/choirs/${choirId}/director/rehearsals/${selectedRehearsalId}/attendance?page=${attendancePage}&pageSize=100`),
    enabled: Boolean(selectedRehearsalId) && canManage && tab === 'Attendance & notes',
  })
  const commit = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body: unknown }) =>
      api(`/choirs/${choirId}/director${path}`, { method, body: JSON.stringify(body) }),
    onSuccess: async () => {
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['director-overview', choirId] })
      await queryClient.invalidateQueries({ queryKey: ['director-events', choirId] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard', choirId] })
      await queryClient.invalidateQueries({ queryKey: ['director-attendance', choirId] })
      setEditingEvent(null)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Unable to save this change.'),
  })
  const uploadResource = useMutation({
    mutationFn: async ({ songId, title, type, file }: { songId: string; title: string; type: string; file: File }) => {
      const params = new URLSearchParams({ title, type })
      const response = await fetch(`/api/v1/choirs/${choirId}/director/songs/${songId}/resources/upload?${params}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(result?.error ?? 'The upload could not be completed.')
      }
      return response.json()
    },
    onSuccess: async () => {
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['director-overview', choirId] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The upload could not be completed.'),
  })
  const sectionList = overview.data?.sections ?? []
  const members = memberQuery.data?.members ?? []
  const songs = overview.data?.songs ?? []
  const rehearsals = rehearsalQuery.data?.rehearsals ?? []

  function saveForm(event: FormEvent<HTMLFormElement>, kind: 'practice' | 'task' | 'announcement' | 'event' | 'note' | 'resource') {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '').trim()
    if (kind === 'practice') {
      const sectionId = value('sectionId')
      const memberId = value('membershipId')
      commit.mutate({ path: '/practice', body: {
        songId: value('songId'), sectionId: sectionId || null, membershipId: memberId || null,
        dueAt: value('dueAt') ? new Date(value('dueAt')).toISOString() : null, note: value('note') || null,
      } })
    } else if (kind === 'task') {
      const sectionId = value('targetSectionId')
      commit.mutate({ path: '/tasks', body: {
        title: value('title'), description: value('description') || null,
        targetSectionId: sectionId || null, assignedToId: value('assignedToId') || null,
        dueAt: value('dueAt') ? new Date(value('dueAt')).toISOString() : null,
      } })
    } else if (kind === 'announcement') {
      commit.mutate({ path: '/announcements', body: { title: value('title'), body: value('body'), targetSectionId: value('targetSectionId') || null } })
    } else if (kind === 'event') {
      const startsAt = dateTimeLocalToIso(value('startsAt'), membership.choir.timezone)
      const endsAt = dateTimeLocalToIso(value('endsAt'), membership.choir.timezone)
      if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
        setError(`Set an end time after the start time (${membership.choir.timezone}).`)
        return
      }
      const body = {
        title: value('title'), type: value('type'), startsAt, endsAt,
        deadlineAt: value('deadlineAt') ? new Date(value('deadlineAt')).toISOString() : null,
        venue: value('venue') || null, description: value('description') || null,
        songIds: form.getAll('songIds').map(String), participantIds: form.getAll('participantIds').map(String),
      }
      commit.mutate({ path: editingEvent ? `/events/${editingEvent.id}` : '/events', method: editingEvent ? 'PATCH' : 'POST', body })
    } else if (kind === 'note') {
      commit.mutate({ path: '/notes', body: { title: value('title'), body: value('body'), rehearsalId: value('rehearsalId') || null } })
    } else {
      commit.mutate({ path: `/songs/${value('songId')}/resources`, body: { title: value('title'), type: value('type'), url: value('url') } })
    }
    event.currentTarget.reset()
  }

  function changePracticeStatus(id: string, status: string) {
    commit.mutate({ path: `/practice/${id}`, method: 'PATCH', body: { status } })
  }
  function changeTaskStatus(id: string, status: string) {
    commit.mutate({ path: `/tasks/${id}`, method: 'PATCH', body: { status } })
  }
  function selectRehearsal(rehearsalId: string) {
    setSelectedRehearsalId(rehearsalId)
    setAttendancePage(1)
  }

  function submitAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedRehearsalId || !attendanceQuery.data) return
    const form = new FormData(event.currentTarget)
    const records = attendanceQuery.data.members.map((member) => ({
      membershipId: member.id,
      status: String(form.get(`status-${member.id}`) ?? 'ABSENT'),
      note: String(form.get(`note-${member.id}`) ?? '').trim() || null,
    }))
    commit.mutate({ path: `/rehearsals/${selectedRehearsalId}/attendance`, body: { records } })
  }
  function submitResourceFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get('file')
    if (!(file instanceof File) || !file.size) { setError('Choose a PDF or audio file to upload.'); return }
    const title = String(form.get('title') ?? '').trim()
    const songId = String(form.get('songId') ?? '')
    const type = String(form.get('type') ?? '')
    uploadResource.mutate({ songId, title: title || file.name, type, file })
    event.currentTarget.reset()
  }

  function downloadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const from = String(form.get('from'))
    const to = String(form.get('to'))
    if (!from || !to || from > to) { setError('Choose a valid report date range.'); return }
    setError('')
    setReportLoading(true)
    void api<ReportData>(`/choirs/${choirId}/director/reports?from=${encodeURIComponent(`${from}T00:00:00.000Z`)}&to=${encodeURIComponent(`${to}T23:59:59.999Z`)}`)
      .then((data) => {
        setReport(data)
        const rows = [
          ['Report', `Attendance and activity: ${from} to ${to}`],
          ['Events', data.eventCount],
          [],
          ['Event', 'Type', 'Starts', 'Ends', 'Deadline', 'Venue', 'Participants'],
          ...data.events.map((item) => [item.title, item.type, item.startsAt, item.endsAt, item.deadlineAt ?? '', item.venue ?? '', item._count.participants]),
          [],
          ['Rehearsal', 'Date', 'Member', 'Section', 'Attendance'],
          ...data.attendance.map((item) => [item.rehearsal.title, item.rehearsal.startsAt, item.membership.user.name, item.membership.section?.name ?? '', statusLabel(item.status)]),
          [],
          ['Member participation', 'Count'],
          ...data.memberParticipation.map((item) => [item.label, item.count]),
          [],
          ['Task status', 'Count'],
          ...data.tasks.map((item) => [statusLabel(item.status), item._count._all]),
          [],
          ['Song progress', 'Count'],
          ...data.practice.map((item) => [statusLabel(item.status), item._count._all]),
          [],
          ['Section progress', 'Count'],
          ...data.practiceBySection.map((item) => [item.label, item.count]),
        ]
        const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `choir-report-${from}-${to}.csv`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to create the report.'))
      .finally(() => setReportLoading(false))
  }

  if (overview.isError) return <section className="panel director-empty"><h2>{tx('Director workspace unavailable')}</h2><p>{overview.error instanceof Error ? overview.error.message : tx('Unable to load choir data.')}</p><button className="button button-secondary" onClick={() => void overview.refetch()}>{tx('Try again')}</button></section>
  const data = overview.data
  return (
    <div className="director-workspace">
      <div className="page-heading-row"><div><span className="eyebrow">{tx('CHOIR LEADERSHIP')}</span><h1>{tx('Director dashboard')}<span className="heading-period">.</span></h1><p className="muted">{membership.choir.name} · {tx('rehearsal planning, repertoire, and member progress')}</p></div><button className="button button-secondary" onClick={() => void overview.refetch()} disabled={overview.isFetching}>{overview.isFetching ? tx('Refreshing…') : tx('Refresh data')}</button></div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {memberQuery.isError && <div className="inline-error" role="alert">{tx('Could not load member choices.')} <button className="table-action" onClick={() => void memberQuery.refetch()}>{tx('Retry')}</button></div>}
      {rehearsalQuery.isError && tab === 'Attendance & notes' && <div className="inline-error" role="alert">{tx('Could not load rehearsals.')} <button className="table-action" onClick={() => void rehearsalQuery.refetch()}>{tx('Retry')}</button></div>}
      {!memberQuery.isError && data && data.stats.totalMembers > 100 && <label className="director-member-search">{tx('Find a member for assignments')}<input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder={tx('Search choir member names')} aria-label={tx('Search choir member names')} /><small>{memberSearch ? `${memberQuery.data?.pagination.total ?? 0} ${tx('search matches')}` : `${tx('Showing')} ${members.length} ${tx('of')} ${data.stats.totalMembers} ${tx('members')}`}</small></label>}
      <nav className="director-tabs" aria-label={tx('Director workspace sections')}>{tabs.filter((item) => canManage || !['Attendance & notes', 'Reports'].includes(item)).map((item) => <button key={item} className={tab === item ? 'director-tab director-tab-active' : 'director-tab'} onClick={() => setTab(item)}>{tx(item)}</button>)}</nav>
      {overview.isLoading ? <Loading /> : !data ? null : <>
        {tab === 'Overview' && <OverviewPanel data={data} canManage={canManage} language={language} onTabChange={setTab} />}
        {tab === 'Training' && <section className="director-columns">
          {canLead && <Panel title={tx('Assign vocal practice')} icon={<Music2 size={17} />}><form className="director-form" onSubmit={(e) => saveForm(e, 'practice')}><label>{tx('Song')}<select name="songId" required defaultValue=""><option value="" disabled>{tx('Select a song')}</option>{songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label><label>{tx('Section')}<select name="sectionId" defaultValue={membership.role === 'SECTION_LEADER' ? membership.section?.id ?? '' : ''} disabled={membership.role === 'SECTION_LEADER'}><option value="">{tx('Whole choir')}</option>{sectionList.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select>{membership.role === 'SECTION_LEADER' && <input type="hidden" name="sectionId" value={membership.section?.id ?? ''} />}</label><label>{tx('Due date')}<input type="date" name="dueAt" /></label><label className="director-wide">{tx('Practice notes')}<textarea name="note" rows={2} maxLength={2000} /></label><button className="button button-primary" disabled={commit.isPending}><Plus size={15} /> {tx('Assign practice')}</button></form></Panel>}
          <Panel title={tx('Practice progress')} icon={<Check size={17} />}><div className="director-list">{data.practices.length ? data.practices.map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{item.song.title}</strong><span>{item.membership?.user.name ?? item.section?.name ?? tx('Whole choir')}{item.dueAt ? ` · ${tx('due')} ${formatDate(item.dueAt)}` : ''}</span></div><select aria-label={`${tx('Progress for')} ${item.song.title}`} value={item.status} disabled={!canLead && item.membership?.id !== membership.id} onChange={(e) => changePracticeStatus(item.id, e.target.value)}>{['NOT_STARTED','LEARNING','NEEDS_PRACTICE','READY'].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></div>) : <Empty>{tx('No song practice has been assigned yet.')}</Empty>}</div></Panel>
        </section>}
        {tab === 'Events' && <section className="director-columns">
          {canManage && <Panel title={editingEvent ? 'Edit event and setlist' : 'Plan an event'} icon={<CalendarDays size={17} />}><form key={editingEvent?.id ?? 'event'} className="director-form" onSubmit={(e) => saveForm(e, 'event')}><label>Event name<input name="title" defaultValue={editingEvent?.title ?? ''} required maxLength={160} /></label><label>Event type<select name="type" defaultValue={editingEvent?.type ?? 'CONCERT'}><option value="CONCERT">Concert</option><option value="WORSHIP">Worship service</option><option value="PERFORMANCE">Performance</option><option value="OTHER">Other</option></select></label><label>Starts<input name="startsAt" type="datetime-local" defaultValue={editingEvent ? isoToDateTimeLocal(editingEvent.startsAt, membership.choir.timezone) : ''} required /></label><label>Ends<input name="endsAt" type="datetime-local" defaultValue={editingEvent ? isoToDateTimeLocal(editingEvent.endsAt, membership.choir.timezone) : ''} required /></label><label>Deadline<input name="deadlineAt" type="date" defaultValue={editingEvent?.deadlineAt?.slice(0,10) ?? ''} /></label><label>Venue<input name="venue" defaultValue={editingEvent?.venue ?? ''} maxLength={200} /></label><label className="director-wide">Description<textarea name="description" defaultValue={editingEvent?.description ?? ''} rows={2} maxLength={5000} /></label><label className="director-wide">Setlist (Ctrl/Cmd-click to choose multiple)<select name="songIds" multiple defaultValue={editingEvent?.songs.map(({ song }) => song.id) ?? []}>{songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label><label className="director-wide">Participants (optional; no selection means open choir event)<select name="participantIds" multiple defaultValue={editingEvent?.participants.map(({ membershipId }) => membershipId) ?? []}>{members.map((member) => <option key={member.id} value={member.id}>{member.user.name}{member.section ? ` · ${member.section.name}` : ''}</option>)}</select></label><div className="director-actions director-wide">{editingEvent && <button type="button" className="button button-secondary" onClick={() => setEditingEvent(null)}>Cancel edit</button>}<button className="button button-primary" disabled={commit.isPending}>{editingEvent ? 'Save event' : 'Create event'}</button></div></form></Panel>}
          <Panel title="Events and setlists" icon={<CalendarDays size={17} />}><label className="director-event-search">Search events<input value={eventSearch} onChange={(e) => { setEventSearch(e.target.value); setEventPage(1) }} placeholder="Search event names" /></label>{eventsQuery.isError ? <p className="form-error">Could not load events. <button className="table-action" onClick={() => void eventsQuery.refetch()}>Retry</button></p> : eventsQuery.isLoading ? <Loading /> : <div className="director-list">{eventsQuery.data?.events.length ? eventsQuery.data.events.map((item) => <div className="director-event" key={item.id}><div><strong>{item.title}</strong><span>{formatDate(item.startsAt)} · {item.venue || 'Venue to be confirmed'} · {item.participants.length || 'All'} participants</span><span>Setlist: {item.songs.map(({ song }) => song.title).join(', ') || 'Not set'}</span></div>{canManage && <div className="director-actions"><button className="table-action" onClick={() => { setEditingEvent(item); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Edit</button><button className="table-action table-action-danger" onClick={() => { if (window.confirm(`Remove event “${item.title}”?`)) commit.mutate({ path: `/events/${item.id}`, method: 'DELETE', body: {} }) }}>Remove</button></div>}</div>) : <Empty>No events match this search.</Empty>}</div>}{eventsQuery.data && eventsQuery.data.pagination.total > 25 && <div className="director-pagination"><span>{eventsQuery.data.pagination.total} events</span><button className="button button-secondary" disabled={eventPage <= 1} onClick={() => setEventPage((page) => page - 1)}>Previous</button><span>Page {eventPage} of {Math.ceil(eventsQuery.data.pagination.total / 25)}</span><button className="button button-secondary" disabled={eventPage >= Math.ceil(eventsQuery.data.pagination.total / 25)} onClick={() => setEventPage((page) => page + 1)}>Next</button></div>}</Panel>
        </section>}
        {tab === 'Communication' && <section className="director-columns">
          {canLead && <Panel title="Publish an announcement" icon={<Megaphone size={17} />}><form className="director-form" onSubmit={(e) => saveForm(e, 'announcement')}><label>Audience<select name="targetSectionId" defaultValue={membership.role === 'SECTION_LEADER' ? membership.section?.id ?? '' : ''} disabled={membership.role === 'SECTION_LEADER'}><option value="">Whole choir</option>{sectionList.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select>{membership.role === 'SECTION_LEADER' && <input type="hidden" name="targetSectionId" value={membership.section?.id ?? ''} />}</label><label>Title<input name="title" required maxLength={160} /></label><label className="director-wide">Message<textarea name="body" rows={4} required maxLength={5000} /></label><button className="button button-primary" disabled={commit.isPending}><Megaphone size={15} /> Publish</button></form></Panel>}
          {canLead && <Panel title="Assign a task" icon={<ClipboardList size={17} />}><form className="director-form" onSubmit={(e) => saveForm(e, 'task')}><label>Task title<input name="title" required maxLength={160} /></label><label>Section<select name="targetSectionId" defaultValue={membership.role === 'SECTION_LEADER' ? membership.section?.id ?? '' : ''} disabled={membership.role === 'SECTION_LEADER'}><option value="">Whole choir</option>{sectionList.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select>{membership.role === 'SECTION_LEADER' && <input type="hidden" name="targetSectionId" value={membership.section?.id ?? ''} />}</label><label>Assign to member<select name="assignedToId" defaultValue=""><option value="">Section / choir assignment</option>{members.map((member) => <option value={member.id} key={member.id}>{member.user.name}</option>)}</select></label><label>Due date<input name="dueAt" type="date" /></label><label className="director-wide">Details<textarea name="description" rows={2} maxLength={5000} /></label><button className="button button-primary" disabled={commit.isPending}><Plus size={15} /> Assign task</button></form></Panel>}
          <Panel title="Announcements" icon={<Megaphone size={17} />}><div className="director-list">{data.announcements.length ? data.announcements.map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{item.title}</strong><span>{item.targetSection?.name ?? 'Whole choir'} · {formatDate(item.publishedAt)}</span><p>{item.body}</p></div></div>) : <Empty>No announcements have been published.</Empty>}</div></Panel>
          <Panel title="Pending tasks" icon={<ClipboardList size={17} />}><div className="director-list">{data.tasks.length ? data.tasks.map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{item.title}</strong><span>{item.assignedTo?.user.name ?? item.targetSection?.name ?? 'Whole choir'}{item.dueAt ? ` · due ${formatDate(item.dueAt)}` : ''}</span><p>{item.description}</p></div><select aria-label={`Task status ${item.title}`} value={item.status} disabled={!canManage && membership.role === 'SECTION_LEADER' && !item.targetSection} onChange={(e) => changeTaskStatus(item.id, e.target.value)}>{['OPEN','IN_PROGRESS','DONE'].map((value) => <option key={value} value={value}>{statusNames[value]}</option>)}</select></div>) : <Empty>No tasks have been assigned.</Empty>}</div></Panel>
        </section>}
        {tab === 'Attendance & notes' && <section className="director-columns">
          {canManage && <Panel title="Rehearsal attendance" icon={<UsersRound size={17} />}><label className="director-select-label">Choose rehearsal<select value={selectedRehearsalId} onChange={(e) => selectRehearsal(e.target.value)}><option value="">Select a rehearsal</option>{rehearsals.map((item) => <option value={item.id} key={item.id}>{item.title} · {formatDate(item.startsAt)}</option>)}</select></label>{attendanceQuery.isLoading ? <Loading /> : attendanceQuery.data && <form onSubmit={submitAttendance}><div className="attendance-list">{attendanceQuery.data.members.map((member) => <div className="attendance-row" key={member.id}><span><strong>{member.user.name}</strong><small>{member.section?.name ?? 'Unassigned'}</small></span><select name={`status-${member.id}`} defaultValue={member.status ?? ''} required><option value="" disabled>Choose status</option>{['PRESENT','ABSENT','LATE','EXCUSED'].map((value) => <option value={value} key={value}>{statusNames[value]}</option>)}</select><input name={`note-${member.id}`} defaultValue={member.note ?? ''} placeholder="Note (optional)" maxLength={500} /></div>)}</div><button className="button button-primary" disabled={commit.isPending}>Save attendance</button></form>}{attendanceQuery.data && attendanceQuery.data.pagination.total > attendanceQuery.data.pagination.pageSize && <div className="director-pagination"><span>{attendanceQuery.data.pagination.total} active members</span><button type="button" className="button button-secondary" disabled={attendancePage <= 1} onClick={() => setAttendancePage((page) => page - 1)}>Previous</button><span>Page {attendancePage} of {Math.ceil(attendanceQuery.data.pagination.total / attendanceQuery.data.pagination.pageSize)}</span><button type="button" className="button button-secondary" disabled={attendancePage >= Math.ceil(attendanceQuery.data.pagination.total / attendanceQuery.data.pagination.pageSize)} onClick={() => setAttendancePage((page) => page + 1)}>Next</button></div>}{attendanceQuery.isError && <p className="form-error">Could not load attendance. Choose another rehearsal or retry.</p>}</Panel>}
          {canManage && <Panel title="Rehearsal agenda" icon={<Music2 size={17} />}><label className="director-select-label">Choose rehearsal<select value={selectedRehearsalId} onChange={(e) => selectRehearsal(e.target.value)}><option value="">Select a rehearsal</option>{rehearsals.map((item) => <option value={item.id} key={item.id}>{item.title} · {formatDate(item.startsAt)}</option>)}</select></label>{selectedRehearsalId && <form className="director-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); commit.mutate({ path: `/rehearsals/${selectedRehearsalId}/songs`, method: 'PUT', body: { songIds: form.getAll('songIds').map(String) } }) }}><label className="director-wide">Select the ordered songs for this rehearsal<select name="songIds" multiple defaultValue={rehearsals.find(({ id }) => id === selectedRehearsalId)?.songs.map(({ song }) => song.id) ?? []}>{songs.map((song) => <option value={song.id} key={song.id}>{song.title}</option>)}</select></label><button className="button button-primary" disabled={commit.isPending}>Save agenda</button></form>}</Panel>}
          {canManage && <Panel title="Rehearsal notes" icon={<ClipboardList size={17} />}><form className="director-form" onSubmit={(e) => saveForm(e, 'note')}><label>Title<input name="title" required maxLength={160} /></label><label>Rehearsal<select name="rehearsalId" defaultValue=""><option value="">General director note</option>{rehearsals.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="director-wide">Feedback and follow-up<textarea name="body" rows={5} required maxLength={10000} /></label><button className="button button-primary" disabled={commit.isPending}>Save note</button></form><div className="director-list">{data.notes.map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{item.title}</strong><span>{formatDate(item.createdAt)}</span><p>{item.body}</p></div></div>)}</div></Panel>}
        </section>}
        {tab === 'Reports' && <section className="director-columns">
          <Panel title="Participation and readiness report" icon={<Download size={17} />}><p className="muted director-help">Export attendance by member and rehearsal, event participants, task completion, section progress, and song readiness for a selected period.</p><form className="director-form report-form" onSubmit={downloadReport}><label>From<input type="date" name="from" required /></label><label>To<input type="date" name="to" required /></label><button className="button button-primary director-wide" disabled={reportLoading}><Download size={15} /> {reportLoading ? 'Generating…' : 'Generate CSV report'}</button></form>{report && <div className="director-report-summary"><strong>{report.attendance.length} attendance entries</strong><span>{report.eventCount} events · {report.memberParticipation.length} member participation groups · {report.practiceBySection.length} section progress groups</span></div>}</Panel>
          <Panel title="Section and song readiness" icon={<Music2 size={17} />}><Readiness data={data} language={language} /></Panel>
        </section>}
      </>}
      {tab === 'Overview' && data && <div className="director-columns director-secondary">
        <Panel title="Song resources" icon={<Music2 size={17} />}>{canManage && <><form className="director-form director-resource-form" onSubmit={(e) => saveForm(e, 'resource')}><label>Song<select name="songId" value={resourceSongId} onChange={(e) => setResourceSongId(e.target.value)} required><option value="">Select a song</option>{songs.map((song) => <option value={song.id} key={song.id}>{song.title}</option>)}</select></label><label>Type<select name="type"><option value="SHEET_MUSIC">Sheet music</option><option value="PDF">PDF</option><option value="AUDIO">Audio</option><option value="SOPRANO_TRACK">Soprano track</option><option value="ALTO_TRACK">Alto track</option><option value="TENOR_TRACK">Tenor track</option><option value="BASS_TRACK">Bass track</option><option value="OTHER">Other</option></select></label><label>Display name<input name="title" required maxLength={160} /></label><label>Secure HTTPS URL<input name="url" type="url" pattern="https://.+" required maxLength={2048} /></label><button className="button button-primary director-wide" disabled={commit.isPending}>Add resource link</button></form><form className="director-form director-resource-form" onSubmit={submitResourceFile}><label>Song<select name="songId" required defaultValue=""><option value="" disabled>Select a song</option>{songs.map((song) => <option value={song.id} key={song.id}>{song.title}</option>)}</select></label><label>Resource type<select name="type"><option value="PDF">PDF / sheet music</option><option value="AUDIO">Audio</option><option value="SOPRANO_TRACK">Soprano track</option><option value="ALTO_TRACK">Alto track</option><option value="TENOR_TRACK">Tenor track</option><option value="BASS_TRACK">Bass track</option></select></label><label>Display name (optional)<input name="title" maxLength={160} /></label><label>Upload PDF or audio (max 25 MB)<input name="file" type="file" accept="application/pdf,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac" required /></label><button className="button button-primary director-wide" disabled={uploadResource.isPending}>{uploadResource.isPending ? 'Uploading…' : 'Upload secure file'}</button></form></> }<div className="director-list">{songs.map((song) => song.resources.length > 0 && <div className="director-resource-group" key={song.id}><strong>{song.title}</strong>{song.resources.map((resource) => <div className="director-resource-row" key={resource.id}><a href={resource.url} target="_blank" rel="noreferrer">{resource.title} · {resource.type.replaceAll('_', ' ').toLowerCase()}</a>{canManage && <button className="table-action table-action-danger" disabled={commit.isPending} onClick={() => commit.mutate({ path: `/songs/${song.id}/resources/${resource.id}`, method: 'DELETE', body: {} })}>Remove</button>}</div>)}</div>)}</div></Panel>
        <Panel title="Recent director activity" icon={<ClipboardList size={17} />}><div className="director-list">{data.recentActivity.length ? data.recentActivity.map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{activityLabel(item.action)}</strong><span>{item.entityType} · {formatDate(item.createdAt)}</span></div></div>) : <Empty>No recent activity recorded.</Empty>}</div></Panel>
      </div>}
    </div>
  )
}

function OverviewPanel({ data, canManage, language, onTabChange }: { data: Overview; canManage: boolean; language: Language; onTabChange: (tab: TabName) => void }) {
  const tx = (text: string) => translateText(language, text)
  const labelStatus = (status: string) => tx(statusNames[status] ?? status)
  return <>
    <div className="director-stat-grid">
      <Stat label={tx('Total members')} value={data.stats.totalMembers} note={`${data.stats.activeMembers} ${tx('active')}`} icon={<UsersRound size={17} />} />
      <Stat label={tx('Upcoming rehearsals')} value={data.stats.upcomingRehearsals} note={tx('On the schedule')} icon={<CalendarDays size={17} />} />
      <Stat label={tx('Upcoming events')} value={data.stats.upcomingEvents} note={tx('Concerts and services')} icon={<CalendarDays size={17} />} />
      <Stat label={tx('Songs in practice')} value={data.practices.length} note={`${data.stats.songReadiness.ready} ${tx('marked ready')}`} icon={<Music2 size={17} />} />
    </div>
    <div className="director-quick-actions"><span>{tx('Quick actions')}</span><button onClick={() => onTabChange('Training')}><Music2 size={14} /> {tx('Assign practice')}</button><button onClick={() => onTabChange('Events')}><CalendarDays size={14} /> {tx('Plan event')}</button><button onClick={() => onTabChange('Communication')}><Megaphone size={14} /> {tx('Publish update')}</button>{canManage && <button onClick={() => onTabChange('Attendance & notes')}><UsersRound size={14} /> {tx('Record attendance')}</button>}</div>
    <div className="director-columns">
      <Panel title={tx('Upcoming schedule')} icon={<CalendarDays size={17} />}><div className="director-list">{data.upcomingRehearsals.map((item) => <div className="director-event" key={item.id}><div><strong>{item.title}</strong><span>{formatDate(item.startsAt)} · {item.venue ?? tx('Venue to be confirmed')}</span><span>{tx('Agenda')}: {item.songs.map(({ song }) => song.title).join(', ') || tx('Not set')}</span></div></div>)}{data.upcomingEvents.map((item) => <div className="director-event" key={item.id}><div><strong>{item.title} <small>{tx(item.type.toLowerCase())}</small></strong><span>{formatDate(item.startsAt)} · {item.venue ?? tx('Venue to be confirmed')}</span><span>{item.songs.map(({ song }) => song.title).join(', ') || tx('Setlist not set')}</span></div></div>)}{!data.upcomingEvents.length && !data.upcomingRehearsals.length && <Empty>{tx('No upcoming rehearsals or events.')}</Empty>}</div></Panel>
      <Panel title={tx('Section activity')} icon={<UsersRound size={17} />}><div className="director-list">{data.sections.map((section) => <div className="director-row" key={section.id}><div className="director-row-main"><strong>{section.name}</strong><span>{section._count.memberships} {tx('active members')}</span></div></div>)}</div><Readiness data={data} language={language} /></Panel>
      <Panel title={tx('Recent attendance')} icon={<Check size={17} />}><div className="director-list">{data.recentAttendance.length ? data.recentAttendance.map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{item.membership.user.name}</strong><span>{item.rehearsal.title} · {formatDate(item.rehearsal.startsAt)} · {item.membership.section?.name ?? tx('Unassigned')}</span></div><span className={`director-status status-${item.status.toLowerCase()}`}>{labelStatus(item.status)}</span></div>) : <Empty>{tx('No attendance has been recorded yet.')}</Empty>}</div></Panel>
      <Panel title={tx('Current announcements')} icon={<Megaphone size={17} />}><div className="director-list">{data.announcements.slice(0,5).map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{item.title}</strong><span>{item.targetSection?.name ?? tx('Whole choir')} · {formatDate(item.publishedAt)}</span><p>{item.body}</p></div></div>)}{!data.announcements.length && <Empty>{tx('No choir announcements.')}</Empty>}</div></Panel>
      <Panel title={tx('Songs being practiced')} icon={<Music2 size={17} />}><div className="director-list">{data.practices.length ? data.practices.slice(0,8).map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{item.song.title}</strong><span>{item.section?.name ?? item.membership?.user.name ?? tx('Whole choir')} · {labelStatus(item.status)}</span></div></div>) : <Empty>{tx('No active practice assignments.')}</Empty>}</div></Panel>
      <Panel title={tx('Pending tasks')} icon={<ClipboardList size={17} />}><div className="director-list">{data.tasks.filter((item) => item.status !== 'DONE').slice(0,8).map((item) => <div className="director-row" key={item.id}><div className="director-row-main"><strong>{item.title}</strong><span>{item.assignedTo?.user.name ?? item.targetSection?.name ?? tx('Whole choir')}{item.dueAt ? ` · ${tx('due')} ${formatDate(item.dueAt)}` : ''}</span></div></div>)}{!data.tasks.some((item) => item.status !== 'DONE') && <Empty>{tx('No pending tasks.')}</Empty>}</div></Panel>
    </div>
  </>
}

function Readiness({ data, language }: { data: Overview; language: Language }) {
  const values = data.stats.songReadiness
  return <div className="readiness-bars">{Object.entries({ READY: values.ready, LEARNING: values.learning, NEEDS_PRACTICE: values.needsPractice, NOT_STARTED: values.notStarted }).map(([name, count]) => <div className="readiness-row" key={name}><span>{translateText(language, statusNames[name])}</span><strong>{count}</strong><i><b style={{ width: `${values.ready + values.learning + values.needsPractice + values.notStarted ? count / (values.ready + values.learning + values.needsPractice + values.notStarted) * 100 : 0}%` }} /></i></div>)}</div>
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="panel director-panel"><div className="director-panel-title"><span>{icon}</span><h2>{title}</h2></div>{children}</section>
}
function Stat({ label, value, note, icon }: { label: string; value: number; note: string; icon: ReactNode }) {
  return <section className="panel director-stat"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></section>
}
function Loading() { return <div className="director-loading"><span /><span /><span /></div> }
function Empty({ children }: { children: ReactNode }) { return <div className="director-empty-state">{children}</div> }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
function csvCell(value: unknown) {
  const text = String(value ?? '')
  return `"${(/^[\s]*[=+\-@]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`
}
function activityLabel(value: string) { return value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase()) }

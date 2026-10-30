import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Music2,
  Plus,
  Search,
  Shield,
  UsersRound,
  X,
} from 'lucide-react'
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { api, ApiError } from './api'
import Platform from './Platform'
import Support from './Support'
import { dateTimeLocalToIso, isoToDateTimeLocal } from './date-time'
import { languageOptions, localeCode, t, translateText } from './i18n'
import type { ChoirMember, DashboardData, Language, Membership, Rehearsal, Song, User } from './types'

const Director = lazy(() => import('./Director'))
const Finance = lazy(() => import('./Finance'))
const SectionChart = lazy(() => import('./SectionChart'))

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/members', label: 'Members', icon: UsersRound },
  { to: '/songs', label: 'Song library', icon: Music2 },
  { to: '/rehearsals', label: 'Rehearsals', icon: CalendarDays },
]

export default function App() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [selectedMembershipId, setSelectedMembershipId] = useState('')
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
  })
  const user = meQuery.data
  const accountLanguage = user?.language
  useEffect(() => {
    document.documentElement.lang = accountLanguage ? localeCode(accountLanguage) : 'en'
  }, [accountLanguage])
  const membership =
    user?.memberships.find((item) => item.id === selectedMembershipId) ??
    user?.memberships[0]
  const signOut = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(['me'], null)
      void queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'me',
      })
    },
  })
  const onSignOut = () => signOut.mutate()

  if (meQuery.isLoading) {
    return <main className="app-loading"><div className="loading-mark">ec</div><span>Preparing your choir space…</span></main>
  }

  if (meQuery.isError) {
    return (
      <main className="auth-page">
        <div className="auth-brand"><Brand /></div>
        <div className="auth-card">
          <span className="eyebrow">Connection issue</span>
          <h1>We couldn't reach your choir space.</h1>
          <p className="muted">Check that the E-Choir API and database are running, then try again.</p>
          <button className="button button-primary full-width" onClick={() => void meQuery.refetch()}>Try again</button>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="*" element={<AuthPage mode="login" />} />
      </Routes>
    )
  }

  if (user.platformRole === 'SUPER_ADMIN' && (location.pathname.startsWith('/platform') || !membership || membership.choir.status !== 'ACTIVE')) {
    return <Platform user={user} language={user.language} onSignOut={onSignOut} />
  }

  if (!membership || membership.choir.status !== 'ACTIVE') {
    const pendingApproval = membership?.choir.status === 'PENDING_APPROVAL'
    return <main className="auth-page"><div className="auth-card"><h1>{pendingApproval ? 'Choir workspace pending approval' : membership ? 'Choir workspace unavailable' : 'No choir memberships'}</h1><p className="muted">{pendingApproval ? 'A platform administrator must approve this choir before members can use its workspace.' : membership ? 'This choir is currently suspended or archived. Contact platform support for assistance.' : 'This account is not currently an active member of a choir.'}</p><button className="button button-secondary" disabled={signOut.isPending} onClick={() => signOut.mutate()}>Sign out</button>{signOut.isError && <div className="form-error">{signOut.error.message}</div>}</div></main>
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand"><Brand /><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>
        <div className="choir-switcher">
          <div className="choir-avatar">{membership.choir.name.slice(0, 1).toUpperCase()}</div>
          <div className="choir-meta"><strong>{membership.choir.name}</strong><span>{roleLabel(membership.role, user.language)}</span></div>
          {user.memberships.length > 1 && <ChevronDown size={15} className="switcher-chevron" />}
          {user.memberships.length > 1 && <select className="choir-select" aria-label="Switch choir" value={membership.id} onChange={(event) => setSelectedMembershipId(event.target.value)}>{user.memberships.map((item) => <option value={item.id} key={item.id}>{item.choir.name}</option>)}</select>}
        </div>
        <span className="nav-caption">{t(user.language, 'workspace').toUpperCase()}</span>
        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMobileNavOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{t(user.language, navKey(to))}</span>
              {label === 'Members' && <span className="nav-dot" />}
            </NavLink>
          ))}
          {['ADMIN', 'DIRECTOR', 'SECTION_LEADER'].includes(membership.role) && <NavLink to="/director" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><ClipboardList size={18} /><span>{translateText(user.language, 'Director workspace')}</span></NavLink>}
          <NavLink to="/support" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><Shield size={18} /><span>{t(user.language, 'support')}</span></NavLink>
          {['ADMIN', 'TREASURER'].includes(membership.role) && <NavLink to="/finance" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><CircleDollarSign size={18} /><span>{t(user.language, 'finance')}</span></NavLink>}
          {user.platformRole === 'SUPER_ADMIN' && <NavLink to="/platform" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><Shield size={18} /><span>{t(user.language, 'platformAdmin')}</span></NavLink>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-profile">
            <div className="profile-avatar">{initials(user.name)}</div>
            <div className="profile-info"><strong>{user.name}</strong><span>{t(user.language, 'member')}</span></div>
            <button className="icon-button logout-button" aria-label={t(user.language, 'signOut')} title={t(user.language, 'signOut')} disabled={signOut.isPending} onClick={() => signOut.mutate()}><LogOut size={17} /></button>
          </div>
          {signOut.isError && <div className="signout-error" role="alert">{translateText(user.language, 'Could not sign out. Please retry.')}</div>}
        </div>
      </aside>
      {mobileNavOpen && <button className="mobile-overlay" aria-label={translateText(user.language, 'Close navigation')} onClick={() => setMobileNavOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label={translateText(user.language, 'Open navigation')} onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumbs"><span>{t(user.language, 'workspace')}</span><span className="crumb-divider">/</span><strong>{pageTitle(location.pathname, user.language)}</strong></div>
          <div className="topbar-actions">
            <TodayDate language={user.language} />
            <LanguageSelector language={user.language} />
            <button className="icon-button" aria-label="Change password" title={t(user.language, 'changePassword')} onClick={() => setShowPasswordDialog(true)}><LockKeyhole size={16} /></button>
            <div className="top-avatar">{initials(user.name)}</div>
          </div>
        </header>
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard membership={membership} user={user} />} />
            <Route path="/members" element={<Members membership={membership} language={user.language} />} />
            <Route path="/songs" element={<Songs membership={membership} language={user.language} />} />
            <Route path="/rehearsals" element={<Rehearsals membership={membership} language={user.language} />} />
            {['ADMIN', 'DIRECTOR', 'SECTION_LEADER'].includes(membership.role) && <Route path="/director" element={<Suspense fallback={<div className="director-loading"><span /><span /><span /></div>}><Director membership={membership} language={user.language} /></Suspense>} />}
            <Route path="/finance" element={['ADMIN', 'TREASURER'].includes(membership.role) ? <Suspense fallback={<div className="director-loading"><span /><span /><span /></div>}><Finance membership={membership} language={user.language} /></Suspense> : <Navigate to="/" replace />} />
            <Route path="/support" element={<Support membership={membership} language={user.language} />} />
            {user.platformRole === 'SUPER_ADMIN' && <Route path="/platform/*" element={<Platform user={user} language={user.language} onSignOut={onSignOut} />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      {(showPasswordDialog || user.mustChangePassword) && <PasswordDialog language={user.language} force={user.mustChangePassword} onClose={() => setShowPasswordDialog(false)} />}
    </div>
  )
}

function AuthPage({ mode: initialMode }: { mode: 'login' | 'register' }) {
  const [mode, setMode] = useState(initialMode)
  const [formError, setFormError] = useState('')
  const [language, setLanguage] = useState<Language>('EN')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  useEffect(() => {
    document.documentElement.lang = localeCode(language)
  }, [language])
  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api<{ user: User }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async ({ user: signedInUser }) => {
      if (mode === 'login' && signedInUser.language !== language) {
        try {
          await api('/auth/preferences', { method: 'PATCH', body: JSON.stringify({ language }) })
        } catch {
          setFormError(t(signedInUser.language, 'languageSaveFailed'))
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/', { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        setFormError(t(language, 'wrongCredentials'))
      } else if (error instanceof ApiError && error.status === 409) {
        setFormError(t(language, mode === 'register' ? 'choirNameInUse' : 'nameInUse'))
      } else {
        setFormError(error instanceof Error ? error.message : 'Unable to sign in.')
      }
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    const formData = new FormData(event.currentTarget)
    const body = Object.fromEntries(
      [...formData.entries()].map(([key, value]) => [key, String(value).trim()]),
    )
    if (mode === 'register') body.language = language
    mutation.mutate(body)
  }

  return (
    <main className="auth-page">
      <div className="auth-brand"><Brand /><span className="auth-tagline">A more harmonious way to lead.</span></div>
      <div className="auth-card">
        <span className="eyebrow">{mode === 'register' ? t(language, 'createWorkspace').toUpperCase() : t(language, 'welcomeBack')}</span>
        <h1>{mode === 'register' ? t(language, 'createWorkspace') : t(language, 'signInHeading')}</h1>
        <p className="muted">{mode === 'register' ? t(language, 'createWorkspaceLink') : t(language, 'signInIntro')}</p>
        <label className="auth-language">{t(language, 'language')}<select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>{languageOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'login' && <label>{t(language, 'choirName')}<input name="choirName" autoComplete="organization" minLength={2} maxLength={120} required /></label>}
          <label>{t(language, 'fullName')}<input name="name" autoComplete="name" minLength={2} maxLength={100} required placeholder="e.g. Grace Uwimana" /></label>
          {mode === 'register' && <label>{t(language, 'choirName')}<input name="choirName" autoComplete="organization" minLength={2} maxLength={120} required placeholder="e.g. St. Cecilia Choir" /></label>}
          <label>{t(language, 'password')}<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={10} maxLength={128} required placeholder={mode === 'register' ? 'At least 10 characters' : ''} /></label>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <button className="button button-primary full-width auth-submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Please wait…' : mode === 'register' ? t(language, 'createWorkspace') : t(language, 'signIn')}<ArrowRight size={16} />
          </button>
        </form>
        <p className="auth-switch">{mode === 'register' ? t(language, 'welcomeBack') : t(language, 'newToChoir')} <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setFormError('') }}>{mode === 'register' ? t(language, 'signIn') : t(language, 'createWorkspaceLink')}</button></p>
      </div>
      <span className="auth-footnote">Made for the music you make together.</span>
    </main>
  )
}

function Dashboard({ membership, user }: { membership: Membership; user: User }) {
  const choirId = membership.choir.id
  const query = useQuery({
    queryKey: ['dashboard', choirId],
    queryFn: () => api<DashboardData>(`/choirs/${choirId}/dashboard`),
  })
  const announcements = useQuery({
    queryKey: ['announcements', choirId],
    queryFn: () => api<{ announcements: { id: string; title: string; body: string; maintenance: boolean; publishedAt: string }[] }>(`/choirs/${choirId}/announcements`),
  })
  const data = query.data
  const chartData = useMemo(() => (data?.sections ?? []).map(({ name, members }) => ({ name, members })), [data?.sections])

  return (
    <>
      <div className="page-heading-row">
      <div>      <span className="eyebrow">{t(user.language, 'choirAtGlance')}</span><h1>{t(user.language, 'welcome')}, {user.name.split(' ')[0]}<span className="heading-period">.</span></h1><p className="muted">{t(user.language, 'dashboardIntro')}</p></div>
        <Link className="button button-secondary" to="/rehearsals"><CalendarDays size={16} /> {t(user.language, 'viewSchedule')}</Link>
      </div>
      {announcements.isError && <div className="inline-error" role="alert">{translateText(user.language, 'Could not load platform announcements.')}</div>}
      {announcements.data?.announcements.map((announcement) => <section className={`announcement-banner ${announcement.maintenance ? 'announcement-maintenance' : ''}`} key={announcement.id}><strong>{announcement.maintenance ? `${translateText(user.language, 'Maintenance notice')} · ` : ''}{announcement.title}</strong><p>{announcement.body}</p><small>{announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleString(localeCode(user.language)) : ''}</small></section>)}
      {query.isError ? <ErrorPanel onRetry={() => void query.refetch()} /> : <>
        <div className="stats-grid">
          <StatCard language={user.language} label={t(user.language, 'activeMembers')} value={data?.stats.activeMembers} suffix={t(user.language, 'inChoir')} icon={<UsersRound size={18} />} tone="violet" detail={t(user.language, 'members')} />
          <StatCard language={user.language} label={t(user.language, 'songsInLibrary')} value={data?.stats.publishedSongs} suffix={t(user.language, 'readyToSing')} icon={<Music2 size={18} />} tone="gold" detail={t(user.language, 'repertoire')} />
          <StatCard language={user.language} label={t(user.language, 'upcomingRehearsals')} value={data?.stats.upcomingRehearsals} suffix={t(user.language, 'onCalendar')} icon={<CalendarDays size={18} />} tone="blue" detail={t(user.language, 'scheduled')} />
        </div>
        <div className="dashboard-grid">
          <section className="panel section-chart-panel">
            <div className="panel-heading"><div><h2>{t(user.language, 'choirAtGlance')}</h2><p>{t(user.language, 'membersBySection')}</p></div><span className="period-pill">{t(user.language, 'members').toUpperCase()}</span></div>
            {query.isLoading ? <LoadingBlock /> : chartData.length ? <Suspense fallback={<LoadingBlock />}><SectionChart data={chartData} /></Suspense> : <EmptyState title={t(user.language, 'sectionsReady')} description={t(user.language, 'sectionsEmpty')} /> }
              <div className="chart-legend"><span><i className="legend-dot" /> {t(user.language, 'activeMembers')}</span><span className="chart-footnote">{t(user.language, 'membershipUpdates')}</span></div>
          </section>
          <section className="panel rehearsal-panel">
            <div className="panel-heading"><div><h2>{t(user.language, 'comingUp')}</h2><p>{t(user.language, 'nextRehearsals')}</p></div><Link className="text-link" to="/rehearsals">{t(user.language, 'viewSchedule')} <ArrowRight size={14} /></Link></div>
            {query.isLoading ? <LoadingBlock /> : data?.upcomingRehearsals.length ? <div className="event-list">{data.upcomingRehearsals.map((rehearsal) => <RehearsalPreview key={rehearsal.id} rehearsal={rehearsal} timezone={membership.choir.timezone} language={user.language} />)}</div> : <EmptyState title={t(user.language, 'quietRehearsals')} description={t(user.language, 'addNextRehearsal')} action={<Link className="text-link" to="/rehearsals">{t(user.language, 'scheduleRehearsal')} <ArrowRight size={14} /></Link>} />}
          </section>
          <section className="panel recent-songs-panel">
            <div className="panel-heading"><div><h2>{t(user.language, 'recentSongs')}</h2><p>{t(user.language, 'repertoire')}</p></div><Link className="text-link" to="/songs">{t(user.language, 'viewSongs')} <ArrowRight size={14} /></Link></div>
            {query.isLoading ? <LoadingBlock /> : data?.recentSongs.length ? <div className="song-list">{data.recentSongs.map((song) => <SongRow key={song.id} song={song} language={user.language} />)}</div> : <EmptyState title={t(user.language, 'songbookStarts')} description={t(user.language, 'addFirstSong')} action={<Link className="text-link" to="/songs">{t(user.language, 'addSong')} <ArrowRight size={14} /></Link>} />}
          </section>
          <section className="panel welcome-panel">
            <div className="welcome-art"><span className="welcome-note note-one">♪</span><span className="welcome-note note-two">♫</span><span className="welcome-orb" /></div>
            <span className="eyebrow">{translateText(user.language, 'A SPACE FOR EVERY VOICE')}</span><h2>{translateText(user.language, 'Better together.')}</h2><p>{translateText(user.language, 'One place to organize the people, practice, and music that make your choir special.')}</p><div className="welcome-footer"><span className="welcome-check">✓</span> {translateText(user.language, 'Your choir workspace is ready')}</div>
          </section>
        </div>
      </>}
    </>
  )
}

function Members({ membership, language: uiLanguage }: { membership: Membership; language: Language }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [updating, setUpdating] = useState('')
  const [showAddMember, setShowAddMember] = useState(false)
  const [profileMember, setProfileMember] = useState<ChoirMember | null>(null)
  const [memberError, setMemberError] = useState('')
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['members', membership.choir.id, search, page],
    queryFn: () => api<{ members: ChoirMember[]; pagination: { page: number; pageSize: number; total: number } }>(`/choirs/${membership.choir.id}/members?search=${encodeURIComponent(search)}&page=${page}&pageSize=25`),
  })
  const updateMembership = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: { role?: string; status?: 'ACTIVE' | 'INACTIVE'; sectionId?: string | null } }) =>
      api(`/choirs/${membership.choir.id}/members/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', membership.choir.id] }),
    onSettled: () => setUpdating(''),
  })
  const sectionsQuery = useQuery({
    queryKey: ['sections', membership.choir.id],
    queryFn: () => api<{ sections: { id: string; name: string }[] }>(`/choirs/${membership.choir.id}/sections`),
    enabled: ['ADMIN', 'DIRECTOR'].includes(membership.role),
  })
  const addMember = useMutation({
    mutationFn: (body: { name: string; password: string; role: string; sectionId: string | null }) =>
      api(`/choirs/${membership.choir.id}/members`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members', membership.choir.id] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard', membership.choir.id] })
      setShowAddMember(false)
      setMemberError('')
    },
    onError: (error) => setMemberError(error instanceof ApiError && error.status === 409 ? t(uiLanguage, 'nameInUse') : error.message),
  })
  const canManage = membership.role === 'ADMIN'
  const canAssignSection = ['ADMIN', 'DIRECTOR'].includes(membership.role)

  function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    addMember.mutate({
      name: String(form.get('name')).trim().replace(/\s+/g, ' '),
      password: String(form.get('password')),
      role: String(form.get('role')),
      sectionId: String(form.get('sectionId') ?? '') || null,
    })
  }

  return (
    <PageHeader eyebrow={t(uiLanguage, 'choirCommunity')} title={t(uiLanguage, 'members')} subtitle={t(uiLanguage, 'membersSubtitle')} action={<div className="member-header-actions"><span className="member-count-pill"><UsersRound size={15} /> {query.data?.pagination.total ?? '—'} {t(uiLanguage, 'members').toLowerCase()}</span>{canManage && <button className="button button-primary" onClick={() => { setShowAddMember(!showAddMember); setMemberError('') }}><Plus size={16} /> {t(uiLanguage, 'addMember')}</button>}</div>}>
      {showAddMember && canManage && <section className="panel create-panel"><div className="panel-heading"><div><h2>{t(uiLanguage, 'addToChoir')}</h2><p>{t(uiLanguage, 'addMemberHelp')}</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowAddMember(false)}><X size={18} /></button></div><form className="song-form" onSubmit={submitMember}><label>{t(uiLanguage, 'fullName')}<input name="name" autoComplete="off" required minLength={2} maxLength={100} placeholder="e.g. Grace Uwimana" /></label><label>{t(uiLanguage, 'temporaryPassword')}<input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /><span className="field-help">{t(uiLanguage, 'passwordHelp')}</span></label><label>{t(uiLanguage, 'choirRole')}<select name="role" defaultValue="MEMBER"><option value="MEMBER">{t(uiLanguage, 'member')}</option><option value="ADMIN">{t(uiLanguage, 'admin')}</option><option value="DIRECTOR">{t(uiLanguage, 'director')}</option><option value="SECTION_LEADER">{t(uiLanguage, 'sectionLeader')}</option><option value="TREASURER">{t(uiLanguage, 'treasurer')}</option></select></label><label>{t(uiLanguage, 'vocalSection')}<select name="sectionId" defaultValue=""><option value="">{t(uiLanguage, 'notAssigned')}</option>{(sectionsQuery.data?.sections ?? []).map((section) => <option value={section.id} key={section.id}>{section.name}</option>)}</select></label>{memberError && <div className="form-error wide-field">{memberError}</div>}<div className="form-actions wide-field"><button type="button" className="button button-secondary" onClick={() => setShowAddMember(false)}>{t(uiLanguage, 'cancel')}</button><button className="button button-primary" disabled={addMember.isPending}>{addMember.isPending ? t(uiLanguage, 'adding') : t(uiLanguage, 'saveMember')}</button></div></form></section>}
    {profileMember && <section className="panel member-profile-card"><div className="panel-heading"><div><h2>{profileMember.user.name}</h2><p>{t(uiLanguage, 'member')} · {roleLabel(profileMember.role, uiLanguage)}</p></div><button className="icon-button" aria-label="Close member profile" onClick={() => setProfileMember(null)}><X size={18} /></button></div><div className="member-profile-details"><span><small>{t(uiLanguage, 'vocalSection')}</small><strong>{profileMember.section?.name ?? t(uiLanguage, 'notAssigned')}</strong></span><span><small>{t(uiLanguage, 'status')}</small><strong>{profileMember.status === 'ACTIVE' ? t(uiLanguage, 'active') : t(uiLanguage, 'inactive')}</strong></span><span><small>{t(uiLanguage, 'joined')}</small><strong>{new Intl.DateTimeFormat(uiLanguage === 'FR' ? 'fr-FR' : uiLanguage === 'RW' ? 'rw-RW' : 'en', { dateStyle: 'medium' }).format(new Date(profileMember.joinedAt))}</strong></span><span><small>{t(uiLanguage, 'language')}</small><strong>{profileMember.user.language}</strong></span></div></section>}
      {query.isError ? <ErrorPanel onRetry={() => void query.refetch()} /> : <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>{t(uiLanguage, 'choirMembers')}</h2><p>{t(uiLanguage, 'manageMembers')}</p></div><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t(uiLanguage, 'searchMembers')} aria-label={t(uiLanguage, 'searchMembers')} /></label></div>
        <div className="table-scroll"><table><thead><tr><th>{t(uiLanguage, 'member')}</th><th>{t(uiLanguage, 'role')}</th><th>{t(uiLanguage, 'vocalSection')}</th><th>{t(uiLanguage, 'status')}</th><th>{t(uiLanguage, 'joined')}</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>
          {query.isLoading ? <tr><td colSpan={canManage ? 6 : 5}><LoadingBlock /></td></tr> : query.data?.members.length ? query.data.members.map((member) => <tr key={member.id}>
            <td><div className="member-cell"><div className="table-avatar">{initials(member.user.name)}</div><div><button className="member-profile-trigger" onClick={() => setProfileMember(member)}>{member.user.name}</button></div></div></td>
            <td>{canManage ? <select className="inline-select" aria-label={`${t(uiLanguage, 'role')} ${member.user.name}`} value={member.role} disabled={updating === member.id} onChange={(event) => { setUpdating(member.id); updateMembership.mutate({ id: member.id, changes: { role: event.target.value } }) }}><option value="ADMIN">{t(uiLanguage, 'admin')}</option><option value="DIRECTOR">{t(uiLanguage, 'director')}</option><option value="SECTION_LEADER">{t(uiLanguage, 'sectionLeader')}</option><option value="TREASURER">{t(uiLanguage, 'treasurer')}</option><option value="MEMBER">{t(uiLanguage, 'member')}</option></select> : <span className={`role-pill role-${member.role.toLowerCase()}`}>{roleLabel(member.role, uiLanguage)}</span>}</td>
            <td>{canAssignSection ? <select className="inline-select" aria-label={`${t(uiLanguage, 'vocalSection')} ${member.user.name}`} value={member.section?.id ?? ''} disabled={updating === member.id} onChange={(event) => {
              setUpdating(member.id)
              const sectionId = event.target.value || null
              if (membership.role === 'ADMIN') updateMembership.mutate({ id: member.id, changes: { sectionId } })
              else void api(`/choirs/${membership.choir.id}/members/${member.id}/section`, { method: 'PATCH', body: JSON.stringify({ sectionId }) })
                .then(() => queryClient.invalidateQueries({ queryKey: ['members', membership.choir.id] }))
                .catch(() => setMemberError('Unable to assign this vocal section.'))
                .finally(() => setUpdating(''))
            }}><option value="">{t(uiLanguage, 'notAssigned')}</option>{(sectionsQuery.data?.sections ?? []).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select> : member.section?.name ?? <span className="muted">{t(uiLanguage, 'notAssigned')}</span>}</td>
            <td><span className={`status-pill ${member.status === 'ACTIVE' ? 'status-active' : 'status-inactive'}`}><i />{member.status === 'ACTIVE' ? t(uiLanguage, 'active') : t(uiLanguage, 'inactive')}</span></td>
            <td>{new Intl.DateTimeFormat(uiLanguage === 'FR' ? 'fr-FR' : uiLanguage === 'RW' ? 'rw-RW' : 'en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(member.joinedAt))}</td>
            {canManage && <td className="row-action-cell"><button className="table-action" disabled={updating === member.id} onClick={() => { setUpdating(member.id); updateMembership.mutate({ id: member.id, changes: { status: member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }) }}>{member.status === 'ACTIVE' ? t(uiLanguage, 'deactivate') : t(uiLanguage, 'reactivate')}</button></td>}
          </tr>) : <tr><td colSpan={canManage ? 6 : 5}><EmptyState title={search ? t(uiLanguage, 'noMatches') : t(uiLanguage, 'noMembers')} description={search ? t(uiLanguage, 'tryName') : t(uiLanguage, 'membersEmpty')} /></td></tr>}
        </tbody></table></div>
        {memberError && !showAddMember && <div className="inline-error" role="alert">{memberError}</div>}
        {query.data && query.data.pagination.total > 25 && <Pagination page={page} pageSize={25} total={query.data.pagination.total} onPageChange={setPage} />}
        {updateMembership.isError && <div className="inline-error">{updateMembership.error.message}</div>}
      </section>}
    </PageHeader>
  )
}

function Songs({ membership, language: uiLanguage }: { membership: Membership; language: Language }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [editingSong, setEditingSong] = useState<Song | null>(null)
  const [formError, setFormError] = useState('')
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['songs', membership.choir.id, search, page],
    queryFn: () => api<{ songs: Song[]; pagination: { page: number; pageSize: number; total: number } }>(`/choirs/${membership.choir.id}/songs?search=${encodeURIComponent(search)}&page=${page}&pageSize=25`),
  })
  const saveSong = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: Record<string, unknown> }) =>
      api(`/choirs/${membership.choir.id}/songs${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['songs', membership.choir.id] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard', membership.choir.id] })
      setShowForm(false)
      setEditingSong(null)
      setFormError('')
    },
    onError: (error) => setFormError(error.message),
  })
  const archiveSong = useMutation({
    mutationFn: (id: string) => api(`/choirs/${membership.choir.id}/songs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPage(1)
      void queryClient.invalidateQueries({ queryKey: ['songs', membership.choir.id] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard', membership.choir.id] })
    },
  })
  const canManage = ['ADMIN', 'DIRECTOR'].includes(membership.role)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') ?? '').trim()
    if (!title) {
      setFormError('Add a song title to continue.')
      return
    }
    saveSong.mutate({ id: editingSong?.id ?? null, body: {
      title,
      composer: String(data.get('composer') ?? '').trim() || null,
      category: String(data.get('category') ?? '').trim() || null,
      musicalKey: String(data.get('musicalKey') ?? '').trim() || null,
      bpm: String(data.get('bpm') ?? '') ? Number(data.get('bpm')) : null,
      durationSec: String(data.get('durationSec') ?? '') ? Number(data.get('durationSec')) : null,
      lyrics: String(data.get('lyrics') ?? '').trim() || null,
      notes: String(data.get('notes') ?? '').trim() || null,
    } })
  }

  return (
    <PageHeader eyebrow={t(uiLanguage, 'repertoireEyebrow')} title={t(uiLanguage, 'songs')} subtitle={t(uiLanguage, 'songsSubtitle')} action={canManage ? <button className="button button-primary" onClick={() => { setEditingSong(null); setShowForm(!showForm); setFormError('') }}><Plus size={17} /> {t(uiLanguage, 'addSong')}</button> : undefined}>
      {showForm && <section className="panel create-panel"><div className="panel-heading"><div><h2>{editingSong ? t(uiLanguage, 'editSong') : t(uiLanguage, 'addSongHeading')}</h2><p>{t(uiLanguage, 'songsSubtitle')}</p></div><button className="icon-button" aria-label="Close" onClick={() => { setShowForm(false); setEditingSong(null) }}><X size={18} /></button></div><form key={editingSong?.id ?? 'new-song'} className="song-form" onSubmit={handleSubmit}><label>{t(uiLanguage, 'title')}<input name="title" defaultValue={editingSong?.title ?? ''} required maxLength={160} /></label><label>{t(uiLanguage, 'composer')}<input name="composer" defaultValue={editingSong?.composer ?? ''} maxLength={160} /></label><label>{t(uiLanguage, 'category')}<input name="category" defaultValue={editingSong?.category ?? ''} maxLength={80} /></label><label>{t(uiLanguage, 'key')}<input name="musicalKey" defaultValue={editingSong?.musicalKey ?? ''} maxLength={20} /></label><label>Tempo (BPM)<input name="bpm" type="number" min={20} max={400} defaultValue={editingSong?.bpm ?? ''} /></label><label>Duration (seconds)<input name="durationSec" type="number" min={1} max={86400} defaultValue={editingSong?.durationSec ?? ''} /></label><label className="wide-field">{t(uiLanguage, 'lyrics')}<textarea name="lyrics" defaultValue={editingSong?.lyrics ?? ''} rows={4} maxLength={20000} placeholder={t(uiLanguage, 'addNotes')} /></label><label className="wide-field">Director notes<textarea name="notes" defaultValue={editingSong?.notes ?? ''} rows={2} maxLength={5000} /></label>{formError && <div className="form-error wide-field">{formError}</div>}<div className="form-actions wide-field"><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditingSong(null) }}>{t(uiLanguage, 'cancel')}</button><button className="button button-primary" disabled={saveSong.isPending}>{saveSong.isPending ? t(uiLanguage, 'adding') : editingSong ? t(uiLanguage, 'saveChanges') : t(uiLanguage, 'saveSong')}</button></div></form></section>}
      <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>{t(uiLanguage, 'repertoire')}</h2><p>{query.data?.pagination.total ?? 0} {t(uiLanguage, 'songs').toLowerCase()}</p></div><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t(uiLanguage, 'searchSongs')} aria-label={t(uiLanguage, 'searchSongs')} /></label></div>
        {query.isError ? <ErrorPanel onRetry={() => void query.refetch()} /> : <div className="song-library-list">{query.isLoading ? <LoadingBlock /> : query.data?.songs.length ? query.data.songs.map((song) => <SongRow key={song.id} song={song} language={uiLanguage} onEdit={canManage ? () => { setEditingSong(song); setShowForm(true); setFormError('') } : undefined} onArchive={canManage ? () => { if (window.confirm(`Archive “${song.title}”?`)) archiveSong.mutate(song.id) } : undefined} />) : <EmptyState title={search ? t(uiLanguage, 'noMatches') : t(uiLanguage, 'songsEmpty')} description={search ? t(uiLanguage, 'tryName') : t(uiLanguage, 'addFirstSong')} />}</div>}
        {query.data && query.data.pagination.total > 25 && <Pagination page={page} pageSize={25} total={query.data.pagination.total} onPageChange={setPage} />}
        {archiveSong.isError && <div className="inline-error">Unable to archive this song. Please try again.</div>}
      </section>
    </PageHeader>
  )
}

function Rehearsals({ membership, language: uiLanguage }: { membership: Membership; language: Language }) {
  const [showForm, setShowForm] = useState(false)
  const [editingRehearsal, setEditingRehearsal] = useState<Rehearsal | null>(null)
  const [formError, setFormError] = useState('')
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['rehearsals', membership.choir.id],
    queryFn: () => api<{ rehearsals: Rehearsal[] }>(`/choirs/${membership.choir.id}/rehearsals`),
  })
  const saveRehearsal = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: Record<string, string | null> }) =>
      api(`/choirs/${membership.choir.id}/rehearsals${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rehearsals', membership.choir.id] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard', membership.choir.id] })
      setShowForm(false)
      setEditingRehearsal(null)
      setFormError('')
    },
    onError: (error) => setFormError(error.message),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/choirs/${membership.choir.id}/rehearsals/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rehearsals', membership.choir.id] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard', membership.choir.id] })
    },
  })
  const canManage = ['ADMIN', 'DIRECTOR'].includes(membership.role)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const startsAt = dateTimeLocalToIso(String(form.get('startsAt')), membership.choir.timezone)
    const endsAt = dateTimeLocalToIso(String(form.get('endsAt')), membership.choir.timezone)
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
      setFormError(`${t(uiLanguage, 'chooseValidTime')} (${membership.choir.timezone}).`)
      return
    }
    saveRehearsal.mutate({ id: editingRehearsal?.id ?? null, body: {
      title: String(form.get('title')).trim(),
      startsAt,
      endsAt,
      venue: String(form.get('venue') ?? '').trim() || null,
      description: String(form.get('description') ?? '').trim() || null,
    } })
  }

  const sorted = [...(query.data?.rehearsals ?? [])].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
  return (
    <PageHeader eyebrow={t(uiLanguage, 'rehearsalEyebrow')} title={t(uiLanguage, 'rehearsals')} subtitle={t(uiLanguage, 'rehearsalsSubtitle')} action={canManage ? <button className="button button-primary" onClick={() => { setEditingRehearsal(null); setShowForm(!showForm); setFormError('') }}><Plus size={17} /> {t(uiLanguage, 'scheduleRehearsal')}</button> : undefined}>
      {showForm && <section className="panel create-panel"><div className="panel-heading"><div><h2>{editingRehearsal ? t(uiLanguage, 'editRehearsal') : t(uiLanguage, 'scheduleChoirRehearsal')}</h2><p>{t(uiLanguage, 'timezoneNote')} {membership.choir.timezone}.</p></div><button className="icon-button" aria-label="Close" onClick={() => { setShowForm(false); setEditingRehearsal(null) }}><X size={18} /></button></div><form key={editingRehearsal?.id ?? 'new-rehearsal'} className="song-form" onSubmit={submit}><label>{t(uiLanguage, 'title')}<input name="title" defaultValue={editingRehearsal?.title ?? ''} required maxLength={160} /></label><label>{t(uiLanguage, 'venue')}<input name="venue" defaultValue={editingRehearsal?.venue ?? ''} maxLength={200} /></label><label>{t(uiLanguage, 'startTime')}<input name="startsAt" type="datetime-local" defaultValue={editingRehearsal ? isoToDateTimeLocal(editingRehearsal.startsAt, membership.choir.timezone) : ''} required /></label><label>{t(uiLanguage, 'endTime')}<input name="endsAt" type="datetime-local" defaultValue={editingRehearsal ? isoToDateTimeLocal(editingRehearsal.endsAt, membership.choir.timezone) : ''} required /></label><label className="wide-field">{t(uiLanguage, 'preparationNotes')}<textarea name="description" defaultValue={editingRehearsal?.description ?? ''} rows={3} maxLength={5000} /></label>{formError && <div className="form-error wide-field">{formError}</div>}<div className="form-actions wide-field"><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditingRehearsal(null) }}>{t(uiLanguage, 'cancel')}</button><button className="button button-primary" disabled={saveRehearsal.isPending}>{saveRehearsal.isPending ? t(uiLanguage, 'adding') : editingRehearsal ? t(uiLanguage, 'saveChanges') : t(uiLanguage, 'saveRehearsal')}</button></div></form></section>}
      {query.isError ? <ErrorPanel onRetry={() => void query.refetch()} /> : <section className="panel rehearsal-schedule"><div className="panel-heading"><div><h2>{t(uiLanguage, 'choirSchedule')}</h2><p>{t(uiLanguage, 'scheduledSessions')}</p></div><span className="period-pill">{sorted.length} {t(uiLanguage, 'scheduled').toUpperCase()}</span></div>{query.isLoading ? <LoadingBlock /> : sorted.length ? <div className="schedule-list">{sorted.map((item) => <RehearsalCard key={item.id} rehearsal={item} timezone={membership.choir.timezone} language={uiLanguage} canManage={canManage} onEdit={() => { setEditingRehearsal(item); setShowForm(true); setFormError('') }} onCancel={() => { if (window.confirm(`Cancel “${item.title}”?`)) cancel.mutate(item.id) }} />)}</div> : <EmptyState title={t(uiLanguage, 'noRehearsals')} description={t(uiLanguage, 'scheduleIntro')} />}</section>}
      {cancel.isError && <div className="inline-error">Unable to cancel this rehearsal. Please try again.</div>}
    </PageHeader>
  )
}

function PageHeader({ eyebrow, title, subtitle, action, children }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode; children: ReactNode }) {
  return <><div className="page-heading-row"><div><span className="eyebrow">{eyebrow}</span><h1>{title}<span className="heading-period">.</span></h1><p className="muted">{subtitle}</p></div>{action}</div><div className="stack-content">{children}</div></>
}

function LanguageSelector({ language }: { language: Language }) {
  const queryClient = useQueryClient()
  const [errorMessage, setErrorMessage] = useState('')
  const update = useMutation({
    mutationFn: (nextLanguage: Language) =>
      api('/auth/preferences', { method: 'PATCH', body: JSON.stringify({ language: nextLanguage }) }),
    onSuccess: (_result, nextLanguage) => {
      queryClient.setQueryData<User | null>(['me'], (current) =>
        current ? { ...current, language: nextLanguage } : current,
      )
      setErrorMessage('')
    },
    onError: () => setErrorMessage(t(language, 'languageSaveFailed')),
  })
  return <div className="language-control" title={errorMessage || t(language, 'language')}>
    <label className="sr-only" htmlFor="language-select">{t(language, 'language')}</label>
    <select id="language-select" aria-label={t(language, 'language')} value={language} disabled={update.isPending} onChange={(event) => update.mutate(event.target.value as Language)}>
      {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {errorMessage && <span className="language-error" role="alert">{errorMessage}</span>}
  </div>
}

function PasswordDialog({ language, force, onClose }: { language: Language; force: boolean; onClose: () => void }) {
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const queryClient = useQueryClient()
  const changePassword = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api('/auth/password', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: async () => {
      setErrorMessage('')
      setSuccessMessage(t(language, 'passwordChanged'))
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      if (force) onClose()
    },
    onError: (error) => setErrorMessage(error.message),
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    const values = new FormData(event.currentTarget)
    changePassword.mutate({
      currentPassword: String(values.get('currentPassword')),
      newPassword: String(values.get('newPassword')),
    })
    event.currentTarget.reset()
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!force && event.target === event.currentTarget) onClose() }}><section className="panel password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title"><div className="panel-heading"><div><h2 id="password-dialog-title">{force ? 'Set a new password' : t(language, 'changePassword')}</h2><p>{t(language, 'passwordRequirement')}</p></div>{!force && <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>}</div><form className="auth-form" onSubmit={submit}><label>{t(language, 'currentPassword')}<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label><label>{t(language, 'newPassword')}<input name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></label>{errorMessage && <div className="form-error" role="alert">{errorMessage}</div>}{successMessage && <div className="success-message" role="status">{successMessage}</div>}<div className="form-actions">{!force && <button type="button" className="button button-secondary" onClick={onClose}>{t(language, 'cancel')}</button>}<button className="button button-primary" disabled={changePassword.isPending}>{changePassword.isPending ? t(language, 'saving') : t(language, 'changePassword')}</button></div></form></section></div>
}

function StatCard({ label, value, suffix, icon, tone, detail, language }: { label: string; value?: number; suffix: string; icon: ReactNode; tone: string; detail: string; language: Language }) {
  return <section className="stat-card"><div className="stat-top"><div className={`stat-icon stat-${tone}`}>{icon}</div><span className="stat-trend">{t(language, 'database')}</span></div><span className="stat-label">{label}</span><div className="stat-value-row"><strong>{value ?? '—'}</strong><span>{suffix}</span></div><div className="stat-footer">{detail}</div></section>
}

function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.ceil(total / pageSize)
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return <div className="table-footer"><span>Showing {first}–{last} of {total}</span><div><button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} /></button><span>Page {page} of {pageCount}</span><button className="icon-button" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}><ChevronRight size={16} /></button></div></div>
}

function RehearsalPreview({ rehearsal, timezone, language }: { rehearsal: Rehearsal; timezone: string; language: Language }) {
  const date = new Date(rehearsal.startsAt)
  const locale = language === 'FR' ? 'fr-FR' : language === 'RW' ? 'rw-RW' : 'en'
  return <div className="event-item"><div className="event-date"><span>{new Intl.DateTimeFormat(locale, { month: 'short', timeZone: timezone }).format(date).toUpperCase()}</span><strong>{new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: timezone }).format(date)}</strong></div><div className="event-info"><strong>{rehearsal.title}</strong><span><Clock3 size={13} /> {new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(date)}{rehearsal.venue ? ` · ${rehearsal.venue}` : ''}</span></div><ArrowRight className="event-arrow" size={15} /></div>
}

function RehearsalCard({ rehearsal, timezone, language, canManage, onEdit, onCancel }: { rehearsal: Rehearsal; timezone: string; language: Language; canManage: boolean; onEdit: () => void; onCancel: () => void }) {
  const start = new Date(rehearsal.startsAt)
  const end = new Date(rehearsal.endsAt)
  const now = useSyncExternalStore(subscribeToTime, readTime, () => 0)
  const past = now > 0 && start.getTime() < now
  return <article className={`schedule-card ${past ? 'schedule-past' : ''}`}><div className="schedule-date"><span>{new Intl.DateTimeFormat(language === 'FR' ? 'fr' : language === 'RW' ? 'rw' : 'en', { month: 'short', timeZone: timezone }).format(start).toUpperCase()}</span><strong>{new Intl.DateTimeFormat('en', { day: '2-digit', timeZone: timezone }).format(start)}</strong><span>{new Intl.DateTimeFormat(language === 'FR' ? 'fr' : language === 'RW' ? 'rw' : 'en', { weekday: 'short', timeZone: timezone }).format(start)}</span></div><div className="schedule-detail"><div className="schedule-title-row"><h3>{rehearsal.title}</h3><span className={`status-pill ${past ? 'status-inactive' : 'status-active'}`}><i />{past ? t(language, 'past') : t(language, 'scheduled')}</span></div><p><Clock3 size={14} />{new Intl.DateTimeFormat(language === 'FR' ? 'fr' : language === 'RW' ? 'rw' : 'en', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(start)} – {new Intl.DateTimeFormat(language === 'FR' ? 'fr' : language === 'RW' ? 'rw' : 'en', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(end)}</p>{rehearsal.venue && <p><CalendarDays size={14} />{rehearsal.venue}</p>}{rehearsal.description && <p className="rehearsal-description">{rehearsal.description}</p>}</div>{canManage && <div className="schedule-actions"><button className="table-action" onClick={onEdit}>{t(language, 'edit')}</button>{!past && <button className="table-action" onClick={onCancel}>{t(language, 'cancel')}</button>}</div>}</article>
}

function SongRow({ song, language, onEdit, onArchive }: { song: Pick<Song, 'id' | 'title' | 'composer'> & Partial<Pick<Song, 'musicalKey' | 'category' | 'lyrics' | 'notes'>>; language: Language; onEdit?: () => void; onArchive?: () => void }) {
  const [showLyrics, setShowLyrics] = useState(false)
  return <>
    <div className="song-row"><div className="song-cover"><Music2 size={18} /></div><div className="song-info"><strong>{song.title}</strong><span>{song.composer || song.category || t(language, 'repertoire')}</span></div>{song.musicalKey && <span className="key-tag">{song.musicalKey}</span>}{song.lyrics && <button className="table-action" aria-expanded={showLyrics} onClick={() => setShowLyrics(!showLyrics)}>{t(language, 'lyrics')}</button>}{onEdit && <button className="table-action" onClick={onEdit}>{t(language, 'edit')}</button>}{onArchive && <button className="table-action" onClick={onArchive}>{t(language, 'archive')}</button>}</div>
    {showLyrics && <div className="song-lyrics"><strong>{t(language, 'lyrics')}</strong><p>{song.lyrics}</p>{song.notes && <p className="song-notes">{song.notes}</p>}</div>}
  </>
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Music2 size={20} /></div><strong>{title}</strong><p>{description}</p>{action && <div className="empty-action">{action}</div>}</div>
}

function LoadingBlock() {
  return <div className="loading-block"><span /><span /><span /></div>
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return <div className="error-panel"><strong>We couldn't load this information.</strong><span>Check your connection and try again.</span><button className="button button-secondary" onClick={onRetry}>Try again</button></div>
}

function Brand() {
  return <Link to="/" className="brand"><span className="brand-mark"><Music2 size={17} strokeWidth={2.4} /></span><span>e-choir<span className="brand-period">.</span></span></Link>
}

function roleLabel(role: string, language: Language = 'EN') {
  const roleKeys: Record<string, 'admin' | 'director' | 'sectionLeader' | 'treasurer' | 'member'> = {
    ADMIN: 'admin',
    DIRECTOR: 'director',
    SECTION_LEADER: 'sectionLeader',
    TREASURER: 'treasurer',
    MEMBER: 'member',
  }
  return roleKeys[role] ? t(language, roleKeys[role]) : role
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function navKey(path: string): 'overview' | 'members' | 'songs' | 'rehearsals' | 'finance' | 'support' | 'platformAdmin' {
  return path === '/members' ? 'members' : path === '/songs' ? 'songs' : path === '/rehearsals' ? 'rehearsals' : path === '/finance' ? 'finance' : path === '/support' ? 'support' : path.startsWith('/platform') ? 'platformAdmin' : 'overview'
}

function pageTitle(path: string, language: Language) {
  return path === '/director' ? translateText(language, 'Director workspace') : t(language, navKey(path))
}

function TodayDate({ language }: { language: Language }) {
  const label = useSyncExternalStore(subscribeToClock, readClock, () => '')
  return <span className="today-label">{new Intl.DateTimeFormat(localeCode(language), { weekday: 'short', month: 'short', day: 'numeric' }).format(Number(label) * 60_000)}</span>
}

let clockSnapshot = Math.floor(Date.now() / 60_000)

function readClock() {
  return String(clockSnapshot)
}

function subscribeToClock(onChange: () => void) {
  const interval = window.setInterval(() => {
    const next = Math.floor(Date.now() / 60_000)
    if (next !== clockSnapshot) {
      clockSnapshot = next
      onChange()
    }
  }, 60_000)
  return () => window.clearInterval(interval)
}

let timeSnapshot = Date.now()

function readTime() {
  return timeSnapshot
}

function subscribeToTime(onChange: () => void) {
  const interval = window.setInterval(() => {
    const next = Date.now()
    if (next !== timeSnapshot) {
      timeSnapshot = next
      onChange()
    }
  }, 30_000)
  return () => window.clearInterval(interval)
}

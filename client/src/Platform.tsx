import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Building2, CircleDollarSign, FileText, Megaphone, Settings, Shield, UsersRound } from 'lucide-react'
import { api } from './api'
import { languageOptions, translateText } from './i18n'
import type { Language, User } from './types'

type PlatformTab = 'overview' | 'choirs' | 'users' | 'finance' | 'announcements' | 'tickets' | 'audit' | 'security' | 'settings'
type Page = { page: number; pageSize: number; total: number }
type Choir = { id: string; name: string; status: string; statusReason: string | null; createdAt: string; membershipCount: number; administrators: { id: string; name: string }[] }
type PlatformUser = { id: string; name: string; platformRole: string; accountStatus: string; createdAt: string; memberships: { role: string; status: string; choir: { id: string; name: string; status: string } }[] }
type Ticket = { id: string; subject: string; status: string; priority: string; assignedTo: { id: string; name: string } | null; choir: { id: string; name: string } | null; createdBy: { name: string }; replies: { id: string; body: string; createdAt: string; author: { name: string } }[] }
type FinancialRecord = { id: string; type: string; status: string; transactionDate: string; amount: string; currency: string; category: string; description: string; choir: { name: string }; recordedBy: { name: string } }

const tabs: { id: PlatformTab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'choirs', label: 'Choirs', icon: Building2 },
  { id: 'users', label: 'Users', icon: UsersRound },
  { id: 'finance', label: 'Financial records', icon: CircleDollarSign },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'tickets', label: 'Support', icon: FileText },
  { id: 'audit', label: 'Audit log', icon: Shield },
  { id: 'security', label: 'Security events', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export default function Platform({ user, language, onSignOut }: { user: User; language: Language; onSignOut: () => void }) {
  const tx = (text: string) => translateText(language, text)
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<PlatformTab>('overview')
  const [mobileOpen, setMobileOpen] = useState(false)
  const languageUpdate = useMutation({
    mutationFn: (nextLanguage: Language) => api('/auth/preferences', { method: 'PATCH', body: JSON.stringify({ language: nextLanguage }) }),
    onSuccess: (_result, nextLanguage) => queryClient.setQueryData<User | null>(['me'], (current) => current ? { ...current, language: nextLanguage } : current),
  })
  return <div className="platform-shell">
    <aside className={`platform-sidebar ${mobileOpen ? 'platform-sidebar-open' : ''}`}>
      <div className="platform-brand"><span className="brand-mark">ec</span><strong>E-Choir <small>PLATFORM</small></strong></div>
      <nav aria-label={tx('Platform administration')}>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={`platform-nav ${tab === id ? 'platform-nav-active' : ''}`} onClick={() => { setTab(id); setMobileOpen(false) }}><Icon size={17} />{tx(label)}</button>)}</nav>
      <div className="platform-profile"><div><strong>{user.name}</strong><span>{tx('Super administrator')}</span></div><button className="table-action" onClick={onSignOut}>{tx('Sign out')}</button></div>
    </aside>
    {mobileOpen && <button className="platform-overlay" aria-label={tx('Close menu')} onClick={() => setMobileOpen(false)} />}
    <main className="platform-main"><header className="platform-topbar"><button className="icon-button platform-menu-button" onClick={() => setMobileOpen(true)} aria-label={tx('Open menu')}>☰</button><div><span className="eyebrow">{tx('PLATFORM ADMINISTRATION')}</span><h1>{tx(tabs.find((item) => item.id === tab)?.label ?? 'Overview')}</h1></div><label className="language-control"><span className="sr-only">{tx('Language')}</span><select aria-label={tx('Language')} value={language} disabled={languageUpdate.isPending} onChange={(event) => languageUpdate.mutate(event.target.value as Language)}>{languageOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><span className="role-pill role-admin">{tx('Super admin')}</span>{languageUpdate.isError && <span className="language-error" role="alert">{tx('Could not save language preference. Please retry.')}</span>}</header>
      <section className="platform-content">{tab === 'overview' && <Overview />}{tab === 'choirs' && <ChoirManagement />}{tab === 'users' && <UserManagement currentUserId={user.id} />}{tab === 'finance' && <GlobalFinance />}{tab === 'announcements' && <Announcements />}{tab === 'tickets' && <TicketManagement />}{tab === 'audit' && <AuditLog />}{tab === 'security' && <SecurityEvents />}{tab === 'settings' && <PlatformSettings />}</section>
    </main>
  </div>
}

function Overview() {
  const [analyticsFrom, setAnalyticsFrom] = useState('')
  const [analyticsTo, setAnalyticsTo] = useState('')
  const query = useQuery({ queryKey: ['platform', 'dashboard'], queryFn: () => api<any>('/platform/dashboard') })
  if (query.isError) return <PanelError message="Dashboard data could not be loaded." onRetry={() => void query.refetch()} />
  const stats = query.data?.stats
  return <div className="platform-stack">
    <div className="platform-stat-grid">
      <Metric label="Registered choirs" value={stats?.totalChoirs} detail={`${stats?.activeChoirs ?? '—'} active · ${stats?.suspendedChoirs ?? '—'} suspended · ${stats?.pendingChoirs ?? '—'} awaiting approval`} />
      <Metric label="Registered users" value={stats?.totalUsers} detail={`${stats?.newUsers ?? '—'} registered this month`} />
      <Metric label="Active memberships" value={stats?.activeMemberships} detail={`${stats?.songs ?? '—'} songs · ${stats?.rehearsals ?? '—'} rehearsals`} />
      <Metric label="Recorded financial totals" value={stats?.financeTotals?.length ? `${stats.financeTotals.length} currency/status totals` : 'No records'} detail={(stats?.financeTotals ?? []).map((item: { currency: string; type: string; status: string; amount: number }) => `${item.currency} ${item.type.toLowerCase()} ${item.status.toLowerCase()}: ${item.amount.toLocaleString()}`).join(' · ') || 'No financial records have been entered.'} />
    </div>
    <div className="analytics-export"><label>From<input type="date" value={analyticsFrom} onChange={(event) => setAnalyticsFrom(event.target.value)} /></label><label>To<input type="date" value={analyticsTo} onChange={(event) => setAnalyticsTo(event.target.value)} /></label><a className="button button-secondary" href={`/api/v1/platform/analytics/registrations.csv?${new URLSearchParams({ ...(analyticsFrom ? { from: analyticsFrom } : {}), ...(analyticsTo ? { to: analyticsTo } : {}) })}`}>Export registrations CSV</a></div>
    <div className="platform-panel"><div className="platform-panel-heading"><div><h2>System health</h2><p>Live API/database checks; unsupported integrations are reported as not configured.</p></div></div><div className="health-grid"><Health label="API" value={query.data?.health.api} /><Health label="Database" value={query.data?.health.database} /><Health label="Process uptime" value={query.data ? `${Math.floor(query.data.health.uptimeSeconds / 3600)}h ${Math.floor((query.data.health.uptimeSeconds % 3600) / 60)}m` : '—'} /><Health label="Backups" value={query.data?.health.backups} /><Health label="Storage monitoring" value={query.data?.health.storage} /></div></div>
    <div className="platform-growth-grid"><Growth title="Choir registrations" rows={query.data?.choirGrowth ?? []} /><Growth title="User registrations" rows={query.data?.userGrowth ?? []} /></div>
    <div className="platform-panel"><div className="platform-panel-heading"><div><h2>Recent platform activity</h2><p>Administrative changes recorded in the audit log.</p></div></div><ActivityRows rows={query.data?.activity ?? []} /></div>
  </div>
}

function Metric({ label, value, detail }: { label: string; value?: string | number; detail: string }) {
  return <article className="platform-metric"><span>{label}</span><strong>{value ?? '—'}</strong><small>{detail}</small></article>
}

function Health({ label, value }: { label: string; value?: string }) {
  return <div className="health-item"><span>{label}</span><strong className={value === 'ok' ? 'health-ok' : ''}>{value ?? '—'}</strong></div>
}

function Growth({ title, rows }: { title: string; rows: { month: string; total: number }[] }) {
  return <div className="platform-panel"><div className="platform-panel-heading"><div><h2>{title}</h2><p>Monthly registrations in the last 12 months.</p></div></div>{rows.length ? <div className="growth-bars">{rows.map((row) => <div className="growth-bar-row" key={row.month}><span>{new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit' }).format(new Date(row.month))}</span><div><i style={{ width: `${Math.max(3, row.total / Math.max(...rows.map((item) => item.total)) * 100)}%` }} /></div><strong>{row.total}</strong></div>)}</div> : <p className="platform-empty">No registrations in this period.</p>}</div>
}

function ActivityRows({ rows }: { rows: { id: string; action: string; entityType: string; entityId: string; reason: string | null; createdAt: string; actor: { name: string } }[] }) {
  return rows.length ? <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Activity</th><th>Administrator</th><th>Reason</th><th>When</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.action.replaceAll('_', ' ')}</strong><small>{row.entityType} · {row.entityId.slice(0, 8)}</small></td><td>{row.actor.name}</td><td>{row.reason || '—'}</td><td>{new Date(row.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="platform-empty">No administrative activity recorded yet.</p>
}

function ChoirManagement() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['platform', 'choirs', search, status, page],
    queryFn: () => api<{ choirs: Choir[]; pagination: Page }>(`/platform/choirs?search=${encodeURIComponent(search)}&page=${page}&pageSize=25${status ? `&status=${status}` : ''}`),
  })
  const mutation = useMutation({
    mutationFn: (value: { id: string; status: string; reason: string }) => api(`/platform/choirs/${value.id}`, { method: 'PATCH', body: JSON.stringify({ status: value.status, reason: value.reason }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'choirs'] }),
  })
  return <section className="platform-panel"><Toolbar title="Choir directory" detail={`${query.data?.pagination.total ?? '—'} organizations`} search={search} setSearch={(value) => { setSearch(value); setPage(1) }} filter={<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">All statuses</option><option>PENDING_APPROVAL</option><option>ACTIVE</option><option>SUSPENDED</option><option>ARCHIVED</option></select>} />{query.isError ? <PanelError message={query.error.message} onRetry={() => void query.refetch()} /> : <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Choir</th><th>Administrators</th><th>Members</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{query.isLoading ? <tr><td colSpan={6}>Loading choirs…</td></tr> : query.data?.choirs.length ? query.data.choirs.map((choir) => <tr key={choir.id}><td><strong>{choir.name}</strong><small>{choir.id}</small>{choir.statusReason && <small>Reason: {choir.statusReason}</small>}</td><td>{choir.administrators.map((admin) => admin.name).join(', ') || 'No active admin'}</td><td>{choir.membershipCount}</td><td><StatusBadge value={choir.status} /></td><td>{new Date(choir.createdAt).toLocaleDateString()}</td><td><select value={choir.status} disabled={mutation.isPending} onChange={(event) => { const reason = window.prompt(`Reason for changing ${choir.name} to ${event.target.value}:`); if (reason && reason.trim().length >= 5) mutation.mutate({ id: choir.id, status: event.target.value, reason: reason.trim() }); else if (reason !== null) window.alert('Please enter a reason of at least 5 characters.') }}><option>PENDING_APPROVAL</option><option>ACTIVE</option><option>SUSPENDED</option><option>ARCHIVED</option></select></td></tr>) : <tr><td colSpan={6}>No choirs match this search.</td></tr>}</tbody></table></div>}{query.data && <PageNav page={page} pageSize={25} total={query.data.pagination.total} onPageChange={setPage} />}{mutation.isError && <p className="form-error">{mutation.error.message}</p>}</section>
}

function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [resetId, setResetId] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['platform', 'users', search, page], queryFn: () => api<{ users: PlatformUser[]; pagination: Page }>(`/platform/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=25`) })
  const mutation = useMutation({
    mutationFn: (value: { id: string; patch: Record<string, string> }) => api(`/platform/users/${value.id}`, { method: 'PATCH', body: JSON.stringify(value.patch) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'users'] }),
  })
  const reset = useMutation({
    mutationFn: ({ id, temporaryPassword, reason }: { id: string; temporaryPassword: string; reason: string }) =>
      api(`/platform/users/${id}/password-reset`, { method: 'POST', body: JSON.stringify({ temporaryPassword, reason }) }),
    onSuccess: () => { setResetMessage('Temporary password set. Share it with the account owner privately; it must be changed at next sign-in.'); setResetId('') },
    onError: (error) => setResetMessage(error.message),
  })
  return <section className="platform-panel"><Toolbar title="Global user management" detail="Passwords are never returned by this API. Recovery sets a one-time temporary password and revokes existing sessions." search={search} setSearch={(value) => { setSearch(value); setPage(1) }} />{resetMessage && <p className={reset.isError ? 'form-error' : 'success-message'} role="status">{resetMessage}</p>}{query.isError ? <PanelError message={query.error.message} onRetry={() => void query.refetch()} /> : <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>User</th><th>Choir memberships</th><th>Platform role</th><th>Account status</th><th>Actions</th></tr></thead><tbody>{query.isLoading ? <tr><td colSpan={5}>Loading users…</td></tr> : query.data?.users.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small><small>Joined {new Date(item.createdAt).toLocaleDateString()}</small></td><td>{item.memberships.map((m, index) => <small key={`${m.choir.id}-${index}`}>{m.choir.name} — {m.role} ({m.status})</small>)}</td><td><select value={item.platformRole} disabled={mutation.isPending || item.id === currentUserId} onChange={(event) => confirmUpdate(`Change ${item.name}'s platform role?`, (reason) => mutation.mutate({ id: item.id, patch: { platformRole: event.target.value, reason } }))}><option>USER</option><option>SUPER_ADMIN</option></select></td><td><StatusBadge value={item.accountStatus} /></td><td><select value={item.accountStatus} disabled={mutation.isPending || item.id === currentUserId} onChange={(event) => confirmUpdate(`${event.target.value === 'SUSPENDED' ? 'Suspend' : 'Reactivate'} ${item.name}?`, (reason) => mutation.mutate({ id: item.id, patch: { accountStatus: event.target.value, reason } }))}><option>ACTIVE</option><option>SUSPENDED</option></select><button className="table-action" onClick={() => { setResetId(resetId === item.id ? '' : item.id); setResetMessage('') }}>Assist with recovery</button>{resetId === item.id && <form className="recovery-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); reset.mutate({ id: item.id, temporaryPassword: String(form.get('temporaryPassword')), reason: String(form.get('reason')) }) }}><input name="temporaryPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password" placeholder="Temporary password (10+ chars)" required /><input name="reason" minLength={5} maxLength={1000} placeholder="Reason for reset" required /><button className="button button-secondary" disabled={reset.isPending}>Set temporary password</button></form>}</td></tr>)}</tbody></table></div>}{query.data && <PageNav page={page} pageSize={25} total={query.data.pagination.total} onPageChange={setPage} />}{mutation.isError && <p className="form-error">{mutation.error.message}</p>}</section>
}

function confirmUpdate(question: string, update: (reason: string) => void) {
  if (!window.confirm(question)) return
  const reason = window.prompt('Enter the reason (at least 5 characters):')
  if (reason?.trim() && reason.trim().length >= 5) update(reason.trim())
  else if (reason !== null) window.alert('Please enter a reason of at least 5 characters.')
}

function GlobalFinance() {
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  if (status) params.set('status', status)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = useQuery({ queryKey: ['platform', 'finance', type, status, from, to], queryFn: () => api<{ records: FinancialRecord[] }>(`/platform/finance?${params}`) })
  return <section className="platform-panel"><Toolbar title="Platform financial records" detail="Read-only, cross-choir view. Amounts in different currencies are not combined." filter={<><select aria-label="Filter type" value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option><option value="INCOME">Income</option><option value="EXPENSE">Expenses</option></select><select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="PAID">Paid</option><option value="PENDING">Pending</option><option value="PARTIALLY_PAID">Partially paid</option></select><input type="date" aria-label="From date" value={from} onChange={(event) => setFrom(event.target.value)} /><input type="date" aria-label="To date" value={to} onChange={(event) => setTo(event.target.value)} /></>} /><p className="financial-notice">E-Choir only records transactions completed outside the system. These entries do not prove that money was received or verified.</p><a className="button button-secondary" href={`/api/v1/platform/finance/export.csv?${params}`}>Export filtered CSV</a>{query.isError ? <PanelError message={query.error.message} onRetry={() => void query.refetch()} /> : <RecordTable records={query.data?.records ?? []} loading={query.isLoading} />}</section>
}

function RecordTable({ records, loading }: { records: FinancialRecord[]; loading: boolean }) {
  return <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Date / choir</th><th>Type</th><th>Category / description</th><th>Amount</th><th>Status</th><th>Recorded by</th></tr></thead><tbody>{loading ? <tr><td colSpan={6}>Loading records…</td></tr> : records.length ? records.map((record) => <tr key={record.id}><td>{new Date(record.transactionDate).toLocaleDateString()}<small>{record.choir.name}</small></td><td>{record.type}</td><td>{record.category}<small>{record.description}</small></td><td>{Number(record.amount).toLocaleString()} {record.currency}</td><td><StatusBadge value={record.status} /></td><td>{record.recordedBy.name}</td></tr>) : <tr><td colSpan={6}>No financial records have been recorded.</td></tr>}</tbody></table></div>
}

function Announcements() {
  const [message, setMessage] = useState('')
  const queryClient = useQueryClient()
  const choirsQuery = useQuery({ queryKey: ['platform', 'choirs', 'announcement-options'], queryFn: () => api<{ choirs: Choir[] }>('/platform/choirs?pageSize=100') })
  const query = useQuery({ queryKey: ['platform', 'announcements'], queryFn: () => api<any>('/platform/announcements') })
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/platform/announcements', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => { setMessage('Announcement saved.'); await queryClient.invalidateQueries({ queryKey: ['platform', 'announcements'] }) },
    onError: (error) => setMessage(error.message),
  })
  const toggle = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => api(`/platform/announcements/${id}`, { method: 'PATCH', body: JSON.stringify({ published }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'announcements'] }),
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    create.mutate({
      title: String(form.get('title')), body: String(form.get('body')),
      maintenance: form.get('maintenance') === 'on',
      publish: true,
      choirIds: form.getAll('choirIds').map(String),
    })
    event.currentTarget.reset()
  }
  return <div className="platform-stack"><section className="platform-panel"><div className="platform-panel-heading"><div><h2>Publish announcement</h2><p>Leave organizations unselected to publish to all choirs.</p></div></div><form className="platform-form" onSubmit={submit}><label>Title<input name="title" minLength={3} maxLength={160} required /></label><label>Message<textarea name="body" rows={4} maxLength={10000} required /></label><label className="platform-check"><input name="maintenance" type="checkbox" /> Maintenance notice</label><label>Selected choirs (optional)<select name="choirIds" multiple size={Math.min(5, Math.max(2, choirsQuery.data?.choirs.length ?? 2))}>{(choirsQuery.data?.choirs ?? []).map((choir) => <option key={choir.id} value={choir.id}>{choir.name}</option>)}</select></label>{message && <p role="status">{message}</p>}<button className="button button-primary" disabled={create.isPending}>{create.isPending ? 'Publishing…' : 'Publish announcement'}</button></form></section><section className="platform-panel"><div className="platform-panel-heading"><div><h2>Published announcements</h2><p>Publication changes are recorded in the platform audit log.</p></div></div>{query.isLoading ? <p>Loading announcements…</p> : query.data?.announcements.length ? query.data.announcements.map((item: any) => <article className="announcement-row" key={item.id}><div><strong>{item.title}</strong><p>{item.body}</p><small>{item.maintenance ? 'Maintenance · ' : ''}{item.publishedAt ? `Published ${new Date(item.publishedAt).toLocaleString()}` : 'Draft'} · {item.choirs.length ? item.choirs.map((entry: any) => entry.choir.name).join(', ') : 'All choirs'}</small></div><button className="button button-secondary" onClick={() => toggle.mutate({ id: item.id, published: !item.publishedAt })}>{item.publishedAt ? 'Unpublish' : 'Publish'}</button></article>) : <p className="platform-empty">No announcements yet.</p>}{toggle.isError && <p className="form-error">{toggle.error.message}</p>}</section></div>
}

function TicketManagement() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['platform', 'tickets'], queryFn: () => api<{ tickets: Ticket[] }>('/platform/tickets?pageSize=100') })
  const staff = useQuery({ queryKey: ['platform', 'staff'], queryFn: () => api<{ staff: { id: string; name: string }[] }>('/platform/staff') })
  const [replyText, setReplyText] = useState<Record<string, string>>({})
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, string | null> }) => api(`/platform/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'tickets'] }),
  })
  const reply = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api(`/platform/tickets/${id}/replies`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: () => { setReplyText({}); void queryClient.invalidateQueries({ queryKey: ['platform', 'tickets'] }) },
  })
  return <section className="platform-panel"><div className="platform-panel-heading"><div><h2>Support tickets</h2><p>Ticket history, priority, assignment, and status.</p></div></div>{query.isError ? <PanelError message={query.error.message} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading tickets…</p> : query.data?.tickets.length ? query.data.tickets.map((ticket) => <article className="ticket-card" key={ticket.id}><div className="ticket-head"><div><strong>{ticket.subject}</strong><small>{ticket.choir?.name ?? 'Platform'} · {ticket.createdBy.name}</small></div><div><select value={ticket.status} onChange={(event) => update.mutate({ id: ticket.id, patch: { status: event.target.value } })}><option>OPEN</option><option>IN_PROGRESS</option><option>RESOLVED</option><option>CLOSED</option></select><select value={ticket.priority} onChange={(event) => update.mutate({ id: ticket.id, patch: { priority: event.target.value } })}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select><select aria-label="Assign support ticket" value={ticket.assignedTo?.id ?? ''} onChange={(event) => update.mutate({ id: ticket.id, patch: { assignedToId: event.target.value || null } })}><option value="">Unassigned</option>{(staff.data?.staff ?? []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div></div>{ticket.replies.map((entry) => <p className="ticket-reply" key={entry.id}><strong>{entry.author.name}</strong> · {new Date(entry.createdAt).toLocaleString()}<br />{entry.body}</p>)}<form className="ticket-reply-form" onSubmit={(event) => { event.preventDefault(); const text = replyText[ticket.id]?.trim(); if (text) reply.mutate({ id: ticket.id, body: text }) }}><input aria-label="Reply" value={replyText[ticket.id] ?? ''} onChange={(event) => setReplyText((old) => ({ ...old, [ticket.id]: event.target.value }))} placeholder="Write a reply…" maxLength={10000} /><button className="button button-primary" disabled={reply.isPending}>Reply</button></form></article>) : <p className="platform-empty">No support tickets have been submitted.</p>}{(update.isError || reply.isError) && <p className="form-error">{update.error?.message ?? reply.error?.message}</p>}</section>
}

function AuditLog() {
  const query = useQuery({ queryKey: ['platform', 'audit'], queryFn: () => api<any>('/platform/audit?pageSize=100') })
  return <section className="platform-panel"><div className="platform-panel-heading"><div><h2>Platform audit history</h2><p>Sensitive actions include the acting staff member, target, and reason where applicable.</p></div></div>{query.isError ? <PanelError message={query.error.message} onRetry={() => void query.refetch()} /> : <ActivityRows rows={query.data?.entries ?? []} />}</section>
}

function SecurityEvents() {
  const query = useQuery({ queryKey: ['platform', 'security-events'], queryFn: () => api<any>('/platform/security-events?pageSize=100') })
  return <section className="platform-panel"><div className="platform-panel-heading"><div><h2>Authentication and account events</h2><p>Failed sign-ins are recorded without storing submitted names, passwords, or IP addresses.</p></div></div>{query.isError ? <PanelError message={query.error.message} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading security events…</p> : query.data?.events.length ? <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Event</th><th>User</th><th>Time</th></tr></thead><tbody>{query.data.events.map((event: { id: string; event: string; createdAt: string; user: { name: string } | null }) => <tr key={event.id}><td>{event.event.replaceAll('_', ' ')}</td><td>{event.user?.name ?? 'Unmatched sign-in'}</td><td>{new Date(event.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="platform-empty">No authentication events recorded.</p>}</section>
}

function PlatformSettings() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['platform', 'settings'], queryFn: () => api<{ settings: { key: string; value: unknown }[] }>('/platform/settings') })
  const save = useMutation({
    mutationFn: (value: Record<string, unknown>) => api('/platform/settings', { method: 'PATCH', body: JSON.stringify(value) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'settings'] }),
  })
  const values = Object.fromEntries((query.data?.settings ?? []).map((item) => [item.key, item.value]))
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    save.mutate({
      defaultCurrency: String(form.get('defaultCurrency')).toUpperCase(),
      defaultTimezone: String(form.get('defaultTimezone')),
      supportedLanguages: form.getAll('language').map(String),
      approvalEnabled: form.get('approvalEnabled') === 'on',
    })
  }
  return <section className="platform-panel"><div className="platform-panel-heading"><div><h2>Platform defaults</h2><p>These settings describe defaults; they do not retroactively change existing choir records.</p></div></div>{query.isError ? <PanelError message={query.error.message} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading settings…</p> : <form className="platform-form" onSubmit={submit}><label>Default currency<input name="defaultCurrency" defaultValue={String(values.defaultCurrency ?? 'RWF')} maxLength={3} pattern="[A-Za-z]{3}" required /></label><label>Default timezone<input name="defaultTimezone" defaultValue={String(values.defaultTimezone ?? 'Africa/Kigali')} required /></label><fieldset><legend>Supported languages</legend>{(['EN', 'RW', 'FR'] as const).map((language) => <label className="platform-check" key={language}><input type="checkbox" name="language" value={language} defaultChecked={(values.supportedLanguages as string[] | undefined)?.includes(language) ?? true} />{language}</label>)}</fieldset><label className="platform-check"><input type="checkbox" name="approvalEnabled" defaultChecked={values.approvalEnabled === true} />Require Super Admin approval for new choir registrations</label><p className="field-help">New choirs await approval when this setting is enabled. Existing choirs and memberships are not changed. Branding, MFA and automated backups are not configured in this deployment. No secret keys are shown in this interface.</p>{save.isError && <p className="form-error">{save.error.message}</p>}<button className="button button-primary" disabled={save.isPending}>Save defaults</button></form>}</section>
}

function Toolbar({ title, detail, search, setSearch, filter }: { title: string; detail: string; search?: string; setSearch?: (value: string) => void; filter?: React.ReactNode }) {
  return <div className="platform-panel-heading platform-toolbar"><div><h2>{title}</h2><p>{detail}</p></div><div className="platform-toolbar-actions">{filter}{setSearch && <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search…" aria-label="Search" />}</div></div>
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`platform-status status-${value.toLowerCase().replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-panel"><strong>{message}</strong><button className="button button-secondary" onClick={onRetry}>Retry</button></div>
}

function PageNav({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  return <div className="platform-pagination"><span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span><button className="button button-secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button><span>Page {page} / {pages}</span><button className="button button-secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Next</button></div>
}

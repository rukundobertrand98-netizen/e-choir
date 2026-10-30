import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { localeCode, translateText } from './i18n'
import type { Language, Membership } from './types'

const FinanceChart = lazy(() => import('./FinanceChart'))

type ApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED'
type FinancialRecord = {
  id: string
  type: 'INCOME' | 'EXPENSE'
  status: 'PAID' | 'PENDING' | 'PARTIALLY_PAID'
  approvalStatus: ApprovalStatus
  transactionDate: string
  contributionMonth: string | null
  amount: string
  currency: string
  category: string
  payerName: string | null
  beneficiary: string | null
  membershipId: string | null
  membership: { id: string; user: { name: string } } | null
  paymentMethod: string | null
  referenceNumber: string | null
  description: string
  receiptReference: string | null
  receiptStorageName: string | null
  verifiedAt: string | null
  recordedBy: { id: string; name: string }
  approvedBy: { id: string; name: string } | null
}
type Totals = { currency: string; recordedIncome: number; recordedExpenses: number; balance: number; outstanding: number }
type MonthContribution = {
  month: string
  currency: string
  monthlyAmount: number
  policyConfigured: boolean
  members: { membershipId: string; name: string; section: string; active: boolean; exempt: boolean; expected: number; paid: number; outstanding: number }[]
}
type Contributions = {
  year: number
  currency: string
  policy: { monthlyAmount: string; currency: string; effectiveFrom: string } | null
  exemptions: { id: string; memberName: string; startsAt: string; endsAt: string | null; reason: string }[]
  months: MonthContribution[]
}
type MemberOption = { id: string; user: { name: string }; section: { name: string } | null }
type FinanceTab = 'Dashboard' | 'Transactions' | 'Contributions' | 'Budgets' | 'Reports'

const tabs: FinanceTab[] = ['Dashboard', 'Transactions', 'Contributions', 'Budgets', 'Reports']
const asCurrency = (amount: number | string, currency: string, language: Language = 'EN') => `${Number(amount).toLocaleString(localeCode(language), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

export default function Finance({ membership, language }: { membership: Membership; language: Language }) {
  const tx = (text: string) => translateText(language, text)
  const choirId = membership.choir.id
  const [today] = useState(() => new Date())
  const [tab, setTab] = useState<FinanceTab>('Dashboard')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<FinancialRecord | null>(null)
  const [message, setMessage] = useState('')
  const [auditRecordId, setAuditRecordId] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [ledgerYear, setLedgerYear] = useState(today.getFullYear())
  const [ledgerMonth, setLedgerMonth] = useState(today.getMonth())
  const [chartCurrency, setChartCurrency] = useState(membership.choir.currency)
  const monthLabels = Array.from({ length: 12 }, (_, month) =>
    new Intl.DateTimeFormat(localeCode(language), { month: 'long' }).format(new Date(2020, month, 1)),
  )
  const client = useQueryClient()

  const params = useMemo(() => {
    const value = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (typeFilter) value.set('type', typeFilter)
    if (statusFilter) value.set('status', statusFilter)
    if (from) value.set('from', `${from}T00:00:00.000Z`)
    if (to) value.set('to', `${to}T23:59:59.999Z`)
    if (category) value.set('category', category)
    if (search) value.set('search', search)
    return value
  }, [page, typeFilter, statusFilter, from, to, category, search])
  const query = useQuery({
    queryKey: ['finance', choirId, params.toString()],
    queryFn: () => api<{ records: FinancialRecord[]; pagination: { page: number; pageSize: number; total: number }; summary: { totalsByCurrency: Totals[]; note: string } }>(`/choirs/${choirId}/finance?${params}`),
  })
  const dashboard = useQuery({
    queryKey: ['finance-dashboard', choirId],
    queryFn: () => api<{
      totalsByCurrency: Totals[]
      pendingApprovals: number
      pendingApprovalRecords: FinancialRecord[]
      missingReceipts: number
      monthlyDueOutstanding: number
      monthlyChart: { month: string; totalsByCurrency: { currency: string; income: number; expenses: number }[] }[]
      recent: FinancialRecord[]
      alerts: string[]
      balanceDisclaimer: string
    }>(`/choirs/${choirId}/finance/dashboard`),
    refetchInterval: 60_000,
  })
  const contributions = useQuery({
    queryKey: ['finance-contributions', choirId, ledgerYear],
    queryFn: () => api<Contributions>(`/choirs/${choirId}/finance/contributions?year=${ledgerYear}`),
    enabled: tab === 'Contributions' || tab === 'Reports',
  })
  const budgets = useQuery({
    queryKey: ['finance-budgets', choirId],
    queryFn: () => api<{ budgets: (Record<string, unknown> & { id: string; name: string; category: string; amount: string; currency: string; startsAt: string; endsAt: string; eventTitle: string | null; spent: number; remaining: number; overspent: boolean })[] }>(`/choirs/${choirId}/finance/budgets`),
    enabled: tab === 'Dashboard' || tab === 'Budgets',
  })
  const members = useQuery({
    queryKey: ['finance-members', choirId, memberSearch],
    queryFn: () => api<{ members: MemberOption[] }>(`/choirs/${choirId}/finance/members?search=${encodeURIComponent(memberSearch)}&page=1&pageSize=100`),
    enabled: tab === 'Transactions' || tab === 'Contributions',
  })
  const events = useQuery({
    queryKey: ['finance-events', choirId],
    queryFn: () => api<{ events: { id: string; title: string }[] }>(`/choirs/${choirId}/finance/events`),
    enabled: tab === 'Budgets',
  })
  const save = useMutation({
    mutationFn: async ({ id, body, file }: { id: string | null; body: Record<string, unknown>; file: File | null }) => {
      const result = await api<{ record: FinancialRecord }>(`/choirs/${choirId}/finance${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(body),
      })
      if (file) {
        await api(`/choirs/${choirId}/finance/${result.record.id}/receipt`, {
          method: 'POST', headers: { 'Content-Type': file.type }, body: file,
        })
      }
      return result
    },
    onSuccess: async () => {
      setEditing(null)
      setMessage('Record saved. Transactions are entered manually after completion outside E-Choir.')
      await refreshFinance()
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Unable to save the financial record.'),
  })
  const audit = useQuery({
    queryKey: ['finance-audit', choirId, auditRecordId],
    queryFn: () => api<{ entries: { id: string; action: string; reason: string | null; createdAt: string; actor: { name: string } }[] }>(`/choirs/${choirId}/finance/${auditRecordId}/audit`),
    enabled: Boolean(auditRecordId),
  })
  const approval = useMutation({
    mutationFn: ({ recordId, decision, reason }: { recordId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }) =>
      api(`/choirs/${choirId}/finance/${recordId}/approval`, { method: 'POST', body: JSON.stringify({ decision, reason }) }),
    onSuccess: refreshFinance,
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Unable to review the expense.'),
  })
  const verify = useMutation({
    mutationFn: ({ recordId, reason }: { recordId: string; reason: string }) =>
      api(`/choirs/${choirId}/finance/${recordId}/verify`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: refreshFinance,
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Unable to verify the transaction.'),
  })
  const createPolicy = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/choirs/${choirId}/finance/contributions/policy`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: refreshFinance,
    onError: (error) => setMessage(error.message),
  })
  const createExemption = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/choirs/${choirId}/finance/contributions/exemptions`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: refreshFinance,
    onError: (error) => setMessage(error.message),
  })
  const createBudget = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/choirs/${choirId}/finance/budgets`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: refreshFinance,
    onError: (error) => setMessage(error.message),
  })
  const selectedLedgerMonth = contributions.data?.months[ledgerMonth]

  async function refreshFinance() {
    setMessage('')
    await Promise.all([
      client.invalidateQueries({ queryKey: ['finance', choirId] }),
      client.invalidateQueries({ queryKey: ['finance-dashboard', choirId] }),
      client.invalidateQueries({ queryKey: ['finance-contributions', choirId] }),
      client.invalidateQueries({ queryKey: ['finance-budgets', choirId] }),
    ])
  }

  function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const type = String(form.get('type'))
    const contributionMonth = String(form.get('contributionMonth') ?? '')
    const memberId = String(form.get('membershipId') ?? '')
    const body: Record<string, unknown> = {
      type,
      status: String(form.get('status')),
      transactionDate: new Date(`${String(form.get('transactionDate'))}T12:00:00.000Z`).toISOString(),
      amount: Number(form.get('amount')),
      currency: String(form.get('currency')).trim().toUpperCase(),
      category: String(form.get('category')).trim(),
      payerName: String(form.get('payerName')).trim() || null,
      beneficiary: String(form.get('beneficiary')).trim() || null,
      membershipId: memberId || null,
      contributionMonth: contributionMonth ? new Date(`${contributionMonth}-01T00:00:00.000Z`).toISOString() : null,
      paymentMethod: String(form.get('paymentMethod')).trim() || null,
      referenceNumber: String(form.get('referenceNumber')).trim() || null,
      description: String(form.get('description')).trim(),
      receiptReference: String(form.get('receiptReference')).trim() || null,
    }
    if (editing) body.reason = String(form.get('reason')).trim()
    const file = form.get('receiptFile')
    save.mutate({ id: editing?.id ?? null, body, file: file instanceof File && file.size > 0 ? file : null })
  }

  function createContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const formElement = event.currentTarget
    const month = String(form.get('month'))
    const memberId = String(form.get('membershipId'))
    const amount = Number(form.get('amount'))
    const date = String(form.get('date'))
    const body = {
      type: 'INCOME',
      status: 'PAID',
      transactionDate: new Date(`${date}T12:00:00.000Z`).toISOString(),
      amount,
      currency: contributions.data?.months[ledgerMonth]?.currency ?? membership.choir.currency,
      category: 'Member contribution',
      membershipId: memberId,
      contributionMonth: new Date(`${month}-01T00:00:00.000Z`).toISOString(),
      payerName: selectedLedgerMonth?.members.find((member) => member.membershipId === memberId)?.name ?? null,
      description: String(form.get('description')).trim() || `Member contribution for ${month}`,
    }
    const receipt = form.get('receiptFile')
    save.mutate({ id: null, body, file: receipt instanceof File && receipt.size > 0 ? receipt : null })
    formElement.reset()
  }

  function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    createPolicy.mutate({
      monthlyAmount: Number(data.get('monthlyAmount')),
      currency: String(data.get('currency')).trim().toUpperCase(),
      effectiveFrom: new Date(`${String(data.get('effectiveFrom'))}-01T00:00:00.000Z`).toISOString(),
    })
    event.currentTarget.reset()
  }

  function saveExemption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    createExemption.mutate({
      membershipId: String(data.get('membershipId')),
      startsAt: new Date(`${String(data.get('startsAt'))}-01T00:00:00.000Z`).toISOString(),
      endsAt: String(data.get('endsAt')) ? new Date(`${String(data.get('endsAt'))}-01T00:00:00.000Z`).toISOString() : null,
      reason: String(data.get('reason')).trim(),
    })
    event.currentTarget.reset()
  }

  function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    createBudget.mutate({
      name: String(data.get('name')).trim(),
      category: String(data.get('category')).trim(),
      amount: Number(data.get('amount')),
      currency: String(data.get('currency')).trim().toUpperCase(),
      startsAt: new Date(`${String(data.get('startsAt'))}T00:00:00.000Z`).toISOString(),
      endsAt: new Date(`${String(data.get('endsAt'))}T00:00:00.000Z`).toISOString(),
      eventId: String(data.get('eventId')) || null,
    })
    event.currentTarget.reset()
  }

  function reviewRecord(record: FinancialRecord, decision: 'APPROVED' | 'REJECTED') {
    const reason = window.prompt(`Reason to ${decision.toLowerCase()} this expense:`)?.trim()
    if (reason && reason.length >= 5) approval.mutate({ recordId: record.id, decision, reason })
    else if (reason) setMessage('Enter a reason with at least 5 characters.')
  }

  function verifyRecord(record: FinancialRecord) {
    const reason = window.prompt('Verification notes (for example, receipt inspected):')?.trim()
    if (reason && reason.length >= 5) verify.mutate({ recordId: record.id, reason })
    else if (reason) setMessage('Enter verification notes with at least 5 characters.')
  }

  const csvUrl = `/api/v1/choirs/${choirId}/finance/export.csv?${params}`
  const contributionCsvUrl = `/api/v1/choirs/${choirId}/finance/contributions/export.csv?year=${ledgerYear}`
  const contributionPrintUrl = `/api/v1/choirs/${choirId}/finance/contributions/print?year=${ledgerYear}`
  const financialPrintUrl = `/api/v1/choirs/${choirId}/finance/print?${params}`

  return <div className="finance-page">
    <div className="page-heading-row">
      <div><span className="eyebrow">{tx('CHOIR FINANCE')}</span><h1>{tx('Treasurer dashboard')}<span className="heading-period">.</span></h1><p className="muted">{tx('Record and review choir finances completed outside E-Choir.')}</p></div>
      <div className="finance-heading-actions"><button className="button button-primary" onClick={() => { setTab('Transactions'); setEditing(null) }}>{tx('Record transaction')}</button><button className="button button-secondary" onClick={() => setTab('Contributions')}>{tx('Track contributions')}</button></div>
    </div>
    <div className="financial-notice" role="note">{tx('No online payments or transfers are processed. Recorded balances are bookkeeping totals, not independently verified cash or bank balances. Currency totals are kept separate.')}</div>
    <nav className="finance-tabs" aria-label={tx('Treasurer sections')}>{tabs.map((item) => <button type="button" key={item} className={tab === item ? 'finance-tab-active' : ''} onClick={() => setTab(item)}>{tx(item)}</button>)}</nav>
    {message && <div className={save.isError || approval.isError || verify.isError || createPolicy.isError || createExemption.isError || createBudget.isError ? 'form-error finance-message' : 'success-message finance-message'} role="status">{message}</div>}

    {tab === 'Dashboard' && <section className="finance-section">
      {dashboard.isLoading ? <Loading /> : dashboard.isError ? <Retry message={dashboard.error.message} retry={() => void dashboard.refetch()} /> : dashboard.data && <>
        <div className="platform-stat-grid finance-stat-grid">
          {dashboard.data.totalsByCurrency.length ? dashboard.data.totalsByCurrency.map((item) => <div className="platform-panel finance-currency-summary" key={item.currency}>
            <strong>{item.currency} · {tx('recorded')}</strong><Metric language={language} label="Income" value={asCurrency(item.recordedIncome, item.currency, language)} /><Metric language={language} label="Expenses" value={asCurrency(item.recordedExpenses, item.currency, language)} /><Metric language={language} label="Balance" value={asCurrency(item.balance, item.currency, language)} /><Metric language={language} label="Outstanding records" value={asCurrency(item.outstanding, item.currency, language)} />
          </div>) : <div className="platform-panel finance-empty-summary"><h2>{tx('No transactions recorded')}</h2><p>{tx('Record an externally completed receipt or expense to start the ledger.')}</p><button className="button button-primary" onClick={() => setTab('Transactions')}>{tx('Record a transaction')}</button></div>}
        </div>
        <div className="finance-alert-grid">
          <Metric language={language} label="Expenses awaiting approval" value={String(dashboard.data.pendingApprovals)} />
          <Metric language={language} label="Paid records missing receipts" value={String(dashboard.data.missingReceipts)} />
          <Metric language={language} label="Current-month dues outstanding" value={asCurrency(dashboard.data.monthlyDueOutstanding, contributions.data?.currency ?? membership.choir.currency, language)} />
        </div>
        {dashboard.data.alerts.length > 0 && <div className="finance-alerts"><strong>{tx('Financial alerts')}</strong>{dashboard.data.alerts.map((item) => <p key={item}>{item}</p>)}</div>}
        <div className="finance-dashboard-grid">
          <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Monthly income vs expenses')}</h2><p>{tx('Paid records; expenses count only after approval.')}</p></div><select aria-label={tx('Chart currency')} value={chartCurrency} onChange={(event) => setChartCurrency(event.target.value)}>{[...new Set(dashboard.data.monthlyChart.flatMap((item) => item.totalsByCurrency.map((total) => total.currency)).concat(dashboard.data.totalsByCurrency.map((item) => item.currency)))].map((currency) => <option key={currency}>{currency}</option>)}</select></div><Suspense fallback={<Loading />}><FinanceChart data={dashboard.data.monthlyChart} currency={chartCurrency} language={language} /></Suspense></section>
          <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Recent transactions')}</h2><p>{tx('Latest recorded activity')}</p></div><button className="table-action" onClick={() => setTab('Transactions')}>{tx('View all')}</button></div><RecentList language={language} records={dashboard.data.recent} onReview={reviewRecord} onVerify={verifyRecord} onReceipt={(record) => window.open(`/api/v1/choirs/${choirId}/finance/${record.id}/receipt`, '_blank', 'noopener')} /></section>
        </div>
        <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Expense approvals')}</h2><p>{dashboard.data.pendingApprovals} {tx('pending review · a different authorized user must decide.')}</p></div><button className="table-action" onClick={() => { setTab('Transactions'); setTypeFilter('EXPENSE'); setStatusFilter('') }}>{tx('Review ledger')}</button></div>{dashboard.data.pendingApprovalRecords.length ? <RecentList language={language} records={dashboard.data.pendingApprovalRecords} onReview={reviewRecord} onVerify={verifyRecord} onReceipt={(record) => window.open(`/api/v1/choirs/${choirId}/finance/${record.id}/receipt`, '_blank', 'noopener')} /> : <p className="platform-empty">{tx('No expenses are waiting for approval.')}</p>}</section>
        <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Budget watch')}</h2><p>{tx('Approved paid spending against active budgets')}</p></div><button className="table-action" onClick={() => setTab('Budgets')}>{tx('Manage budgets')}</button></div>{budgets.isLoading ? <Loading /> : budgets.isError ? <Retry message={budgets.error.message} retry={() => void budgets.refetch()} /> : budgets.data?.budgets.length ? <BudgetList language={language} budgets={budgets.data.budgets.slice(0, 5)} /> : <p className="platform-empty">{tx('No budgets have been created.')}</p>}</section>
      </>}
    </section>}

    {tab === 'Transactions' && <section className="finance-section">
      <div className="platform-panel">
        <div className="platform-panel-heading"><div><h2>{tx(editing ? 'Edit financial record' : 'Record a transaction')}</h2><p>{tx('Record a payment already made outside E-Choir. Expenses require a separate reviewer before they enter the recorded balance.')}</p></div></div>
        <form className="platform-form finance-form" onSubmit={submitTransaction} key={editing?.id ?? 'new'}>
          <label>{tx('Type')}<select name="type" defaultValue={editing?.type ?? 'INCOME'}><option value="INCOME">{tx('Income / receipt')}</option><option value="EXPENSE">{tx('Expense')}</option></select></label>
          <label>{tx('Payment status')}<select name="status" defaultValue={editing?.status ?? 'PAID'}><option value="PENDING">{tx('Pending / unpaid')}</option><option value="PARTIALLY_PAID">{tx('Partially paid')}</option><option value="PAID">{tx('Recorded as paid')}</option></select></label>
          <label>{tx('Transaction date')}<input name="transactionDate" type="date" defaultValue={editing ? new Date(editing.transactionDate).toISOString().slice(0, 10) : today.toISOString().slice(0, 10)} required /></label>
          <label>{tx('Amount')}<input name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" defaultValue={editing?.amount ?? ''} required /></label>
          <label>{tx('Currency')}<input name="currency" defaultValue={editing?.currency ?? membership.choir.currency} pattern="[A-Za-z]{3}" maxLength={3} required /></label>
          <label>{tx('Category')}<input name="category" defaultValue={editing?.category ?? ''} placeholder={tx('Dues, donation, fundraising, utilities…')} maxLength={100} required /></label>
          <label className="finance-wide">{tx('Search members')}<input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder={tx('Search names to link a member')} /></label>
          <label>{tx('Member (optional)')}<select name="membershipId" defaultValue={editing?.membershipId ?? ''}><option value="">{tx('No member linked')}</option>{members.data?.members.map((member) => <option key={member.id} value={member.id}>{member.user.name}</option>)}</select></label>
          <label>{tx('Payer')}<input name="payerName" defaultValue={editing?.payerName ?? ''} maxLength={160} placeholder={tx('Payer / donor')} /></label>
          <label>{tx('Beneficiary')}<input name="beneficiary" defaultValue={editing?.beneficiary ?? ''} maxLength={160} /></label>
          <label>{tx('Contribution month (dues only)')}<input name="contributionMonth" type="month" defaultValue={editing?.contributionMonth?.slice(0, 7) ?? ''} /></label>
          <label>{tx('Payment method')}<input name="paymentMethod" defaultValue={editing?.paymentMethod ?? ''} placeholder={tx('Cash, bank transfer…')} maxLength={100} /></label>
          <label>{tx('Reference number')}<input name="referenceNumber" defaultValue={editing?.referenceNumber ?? ''} maxLength={160} /></label>
          <label className="finance-wide">{tx('Description')}<input name="description" defaultValue={editing?.description ?? ''} maxLength={2000} required /></label>
          <label>{tx('External receipt reference')}<input name="receiptReference" defaultValue={editing?.receiptReference ?? ''} maxLength={1000} /></label>
          <label>{tx('Receipt attachment (PDF/JPEG/PNG/WebP, max 10 MB)')}<input name="receiptFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
          {editing && <label className="finance-wide">{tx('Reason for edit')}<input name="reason" minLength={5} maxLength={1000} required placeholder={tx('Why is this record changing?')} /></label>}
          <div className="form-actions finance-wide">{editing && <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>{tx('Cancel edit')}</button>}<button className="button button-primary" disabled={save.isPending}>{save.isPending ? tx('Saving…') : editing ? tx('Save changes') : tx('Record transaction')}</button></div>
        </form>
        {members.isError && <p className="form-error">Could not load members. Member-linked contribution entries are unavailable. <button type="button" className="table-action" onClick={() => void members.refetch()}>Retry</button></p>}
        {members.isLoading && <p className="muted finance-help">Loading active choir members for member-linked records…</p>}
        {members.data && members.data.members.length === 0 && <p className="muted finance-help">No active members match this search.</p>}
      </div>
      <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Transaction ledger')}</h2><p>{query.data?.pagination.total ?? '—'} {tx('matching records')}</p></div><div className="finance-heading-actions"><a className="button button-secondary" href={csvUrl}>{tx('Export Excel-compatible CSV')}</a><a className="button button-secondary" href={financialPrintUrl} target="_blank" rel="noreferrer">{tx('Print / save filtered PDF')}</a></div></div>
        <div className="platform-toolbar-actions finance-filters"><input aria-label={tx('Search transactions')} placeholder={tx('Search payer, member, reference…')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /><select aria-label={tx('Filter by type')} value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }}><option value="">{tx('All types')}</option><option value="INCOME">{tx('Income')}</option><option value="EXPENSE">{tx('Expense')}</option></select><select aria-label={tx('Filter by payment status')} value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}><option value="">{tx('All payment statuses')}</option><option value="PAID">{tx('Paid')}</option><option value="PENDING">{tx('Pending')}</option><option value="PARTIALLY_PAID">{tx('Partially paid')}</option></select><input type="date" aria-label={tx('From date')} value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /><input type="date" aria-label={tx('To date')} value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /><input aria-label={tx('Filter by category')} placeholder={tx('Category…')} value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }} /></div>
        {query.isLoading ? <Loading /> : query.isError ? <Retry message={query.error.message} retry={() => void query.refetch()} /> : <div className="platform-table-wrap"><table className="platform-table finance-table"><thead><tr><th>{tx('Date')}</th><th>{tx('Type / category')}</th><th>{tx('Payer / member')}</th><th>{tx('Details')}</th><th>{tx('Amount')}</th><th>{tx('Status / review')}</th><th>{tx('Actions')}</th></tr></thead><tbody>{query.data?.records.length ? query.data.records.map((record) => <tr key={record.id}><td>{new Date(record.transactionDate).toLocaleDateString(localeCode(language))}</td><td>{tx(record.type === 'INCOME' ? 'Income' : 'Expense')}<small>{record.category}</small></td><td>{record.membership?.user.name ?? record.payerName ?? '—'}{record.beneficiary && <small>{tx('Beneficiary')}: {record.beneficiary}</small>}</td><td>{record.description}{record.referenceNumber && <small>{tx('Ref')}: {record.referenceNumber}</small>}{record.receiptReference && <small>{tx('Receipt ref')}: {record.receiptReference}</small>}{record.receiptStorageName && <button className="table-action" onClick={() => window.open(`/api/v1/choirs/${choirId}/finance/${record.id}/receipt`, '_blank', 'noopener')}>{tx('Download receipt')}</button>}</td><td>{asCurrency(record.amount, record.currency, language)}</td><td><Status status={record.status} language={language} />{record.type === 'EXPENSE' && <small>{tx('Approval')}: {tx(record.approvalStatus.toLowerCase().replaceAll('_', ' '))}</small>}{record.verifiedAt && <small>{tx('Independently reviewed')}</small>}{record.status === 'PAID' && !record.verifiedAt && <small>{tx('Entered as paid · unverified')}</small>}</td><td className="finance-actions"><button className="table-action" onClick={() => { setEditing(record); setMemberSearch(record.membership?.user.name ?? ''); setMessage('') }}>{tx('Edit')}</button><button className="table-action" onClick={() => setAuditRecordId(auditRecordId === record.id ? '' : record.id)}>{tx('History')}</button>{record.type === 'EXPENSE' && record.approvalStatus === 'PENDING' && <><button className="table-action" disabled={!record.receiptStorageName && !record.receiptReference} title={!record.receiptStorageName && !record.receiptReference ? tx('Attach a receipt file or reference before approval.') : undefined} onClick={() => reviewRecord(record, 'APPROVED')}>{tx('Approve')}</button><button className="table-action table-action-danger" onClick={() => reviewRecord(record, 'REJECTED')}>{tx('Reject')}</button></>}{record.status === 'PAID' && !record.verifiedAt && (record.type !== 'EXPENSE' || record.approvalStatus === 'APPROVED') && <button className="table-action" onClick={() => verifyRecord(record)}>{tx('Verify')}</button>}</td></tr>) : <tr><td colSpan={7}>{tx('No matching transactions. Record an externally completed transaction above.')}</td></tr>}</tbody></table></div>}
        {query.data && query.data.pagination.total > query.data.pagination.pageSize && <div className="platform-pagination"><span>Page {page} of {Math.ceil(query.data.pagination.total / query.data.pagination.pageSize)}</span><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-secondary" disabled={page >= Math.ceil(query.data.pagination.total / query.data.pagination.pageSize)} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
        {auditRecordId && <div className="finance-audit"><strong>Correction and review history</strong>{audit.isLoading ? <Loading /> : audit.isError ? <p className="form-error">{audit.error.message}</p> : audit.data?.entries.length ? audit.data.entries.map((entry) => <p key={entry.id}>{entry.action} by {entry.actor.name} · {new Date(entry.createdAt).toLocaleString()} · {entry.reason || 'No reason supplied'}</p>) : <p>No history recorded.</p>}</div>}
      </section>
    </section>}

    {tab === 'Contributions' && <section className="finance-section">
      <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Monthly dues and contributions')}</h2><p>{tx('Set an effective monthly amount; existing periods retain their historical policy.')}</p></div><YearSelect year={ledgerYear} setYear={setLedgerYear} currentYear={today.getFullYear()} /></div>
        <form className="platform-form finance-form" onSubmit={savePolicy}><label>{tx('Monthly amount')}<input type="number" name="monthlyAmount" min="0" step="0.01" required /></label><label>{tx('Currency')}<input name="currency" defaultValue={contributions.data?.policy?.currency ?? membership.choir.currency} pattern="[A-Za-z]{3}" maxLength={3} required /></label><label>{tx('Effective from')}<input type="month" name="effectiveFrom" defaultValue={`${ledgerYear}-${String(today.getMonth() + 1).padStart(2, '0')}`} required /></label><button className="button button-primary" disabled={createPolicy.isPending}>{tx('Save contribution policy')}</button></form>
        <div className="finance-contribution-tools"><div><input aria-label={tx('Search choir members')} value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder={tx('Find a choir member')} /></div>
          <form className="finance-inline-form" onSubmit={createContribution}><h3>{tx('Record a dues payment')}</h3><label>{tx('Member')}<select name="membershipId" required defaultValue=""><option value="" disabled>{tx('Select member')}</option>{members.data?.members.map((member) => <option key={member.id} value={member.id}>{member.user.name}</option>)}</select></label><label>{tx('Contribution month')}<input type="month" name="month" required defaultValue={`${ledgerYear}-${String(ledgerMonth + 1).padStart(2, '0')}`} /></label><label>{tx('Amount received')}<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>{tx('Date received')}<input name="date" type="date" required defaultValue={today.toISOString().slice(0, 10)} /></label><label>{tx('Reference / note')}<input name="description" maxLength={2000} /></label><label>{tx('Receipt attachment')}<input name="receiptFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></label><button className="button button-primary" disabled={save.isPending}>{tx('Record payment')}</button></form>
          <form className="finance-inline-form" onSubmit={saveExemption}><h3>{tx('Authorize an exemption')}</h3><label>{tx('Member')}<select name="membershipId" required defaultValue=""><option value="" disabled>{tx('Select member')}</option>{members.data?.members.map((member) => <option key={member.id} value={member.id}>{member.user.name}</option>)}</select></label><label>{tx('From month')}<input type="month" name="startsAt" required /></label><label>{tx('Through month (optional)')}<input type="month" name="endsAt" /></label><label>{tx('Reason')}<input name="reason" minLength={5} maxLength={1000} required /></label><button className="button button-secondary" disabled={createExemption.isPending}>{tx('Save authorized exemption')}</button></form>
        </div>
        {members.isLoading && <p className="muted finance-help">{tx('Loading active choir members…')}</p>}
        {members.isError && <p className="form-error">{tx('Unable to load the member list.')} <button type="button" className="table-action" onClick={() => void members.refetch()}>{tx('Retry')}</button></p>}
        {members.data && members.data.members.length === 0 && <p className="muted finance-help">{tx('No active members match this search.')}</p>}
      </section>
      <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Member contribution register')}</h2><p>{tx('Expected, paid, outstanding, and authorized exemption status by month.')}</p></div><div className="finance-heading-actions"><label className="finance-month-select">{tx('Month')}<select value={ledgerMonth} onChange={(event) => setLedgerMonth(Number(event.target.value))}>{monthLabels.map((label, index) => <option value={index} key={label}>{label}</option>)}</select></label><a className="button button-secondary" href={contributionCsvUrl}>{tx('Export Excel CSV')}</a><a className="button button-secondary" href={contributionPrintUrl} target="_blank" rel="noreferrer">{tx('Print / save as PDF')}</a></div></div>
        {contributions.isLoading ? <Loading /> : contributions.isError ? <Retry message={contributions.error.message} retry={() => void contributions.refetch()} /> : selectedLedgerMonth && <div className="platform-table-wrap"><table className="platform-table finance-table"><thead><tr><th>{tx('Member')}</th><th>{tx('Section')}</th><th>{tx('Monthly due')}</th><th>{tx('Paid')}</th><th>{tx('Outstanding')}</th><th>{tx('Status')}</th></tr></thead><tbody>{selectedLedgerMonth.members.length ? selectedLedgerMonth.members.map((member) => <tr key={member.membershipId}><td>{member.name}{!member.active && <small>{tx('Inactive')}</small>}</td><td>{member.section || tx('Unassigned')}</td><td>{asCurrency(member.expected, selectedLedgerMonth.currency, language)}</td><td>{asCurrency(member.paid, selectedLedgerMonth.currency, language)}</td><td>{asCurrency(member.outstanding, selectedLedgerMonth.currency, language)}</td><td>{member.exempt ? tx('Authorized exemption') : member.outstanding <= 0 ? tx('Paid') : member.paid > 0 ? tx('Partially paid') : tx('Unpaid')}</td></tr>) : <tr><td colSpan={6}>{tx('No members are registered in this choir.')}</td></tr>}</tbody></table></div>}
      </section>
      <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Authorized contribution exemptions')}</h2><p>{tx('Exemptions are logged with their reason and authorizing Treasurer.')}</p></div></div>{contributions.data?.exemptions.length ? <div className="finance-budget-list">{contributions.data.exemptions.map((exemption) => <article key={exemption.id}><div><strong>{exemption.memberName}</strong><span>{new Date(exemption.startsAt).toLocaleDateString(localeCode(language))} – {exemption.endsAt ? new Date(exemption.endsAt).toLocaleDateString(localeCode(language)) : tx('Ongoing')}</span><span>{exemption.reason}</span></div></article>)}</div> : <p className="platform-empty">{tx('No exemptions are recorded for this year.')}</p>}</section>
    </section>}

    {tab === 'Budgets' && <section className="finance-section">
      <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Create activity or event budget')}</h2><p>{tx('Spending is calculated from paid, approved expenses in the budget category and date range.')}</p></div></div>
        <form className="platform-form finance-form" onSubmit={saveBudget}><label>{tx('Budget name')}<input name="name" required maxLength={160} /></label><label>{tx('Category')}<input name="category" required maxLength={100} placeholder={tx('Event venue, transport…')} /></label><label>{tx('Budget amount')}<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>{tx('Currency')}<input name="currency" defaultValue={membership.choir.currency} pattern="[A-Za-z]{3}" maxLength={3} required /></label><label>{tx('Start date')}<input name="startsAt" type="date" required /></label><label>{tx('End date')}<input name="endsAt" type="date" required /></label><label>{tx('Related event (optional)')}<select name="eventId" defaultValue=""><option value="">{tx('No event linked')}</option>{events.data?.events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label><button className="button button-primary" disabled={createBudget.isPending}>{tx('Create budget')}</button></form>
        {events.isLoading && <p className="muted finance-help">{tx('Loading choir events…')}</p>}
        {events.isError && <p className="form-error">{tx('Could not load events for budget association.')} <button type="button" className="table-action" onClick={() => void events.refetch()}>{tx('Retry')}</button></p>}
        {events.data && events.data.events.length === 0 && <p className="muted finance-help">{tx('No choir events are available to link yet.')}</p>}
      </section>
      <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Budgets and spending')}</h2><p>{tx('Overspending is highlighted for review.')}</p></div></div>{budgets.isLoading ? <Loading /> : budgets.isError ? <Retry message={budgets.error.message} retry={() => void budgets.refetch()} /> : budgets.data?.budgets.length ? <BudgetList language={language} budgets={budgets.data.budgets} /> : <p className="platform-empty">{tx('No budgets have been created yet.')}</p>}</section>
    </section>}

    {tab === 'Reports' && <section className="finance-section">
      <section className="platform-panel"><div className="platform-panel-heading"><div><h2>Financial report exports</h2><p>Use date and category filters in Transactions for a filtered ledger report.</p></div><YearSelect year={ledgerYear} setYear={setLedgerYear} currentYear={today.getFullYear()} /></div>
        <div className="finance-report-options"><article><h3>Transactions and activity</h3><p>Income, expenses, payer/member, receipt references, approval and verification status.</p><a className="button button-secondary" href={csvUrl}>Download filtered Excel-compatible CSV</a><a className="button button-secondary" href={financialPrintUrl} target="_blank" rel="noreferrer">Open print-ready financial report</a></article><article><h3>Annual member contributions</h3><p>All choir members, each month’s paid, due and outstanding amounts, annual totals, and a signature column.</p><a className="button button-secondary" href={contributionCsvUrl}>Download contribution CSV</a><a className="button button-secondary" href={contributionPrintUrl} target="_blank" rel="noreferrer">Open print-ready contribution register</a></article></div>
        <div className="financial-notice">Print-ready financial reports and contribution registers can be saved as PDFs using your browser’s Print command. CSV files open in Excel and include currency and signature fields. PDF/Excel binary generation is not configured in this application.</div>
        {query.data?.summary.totalsByCurrency.length ? <div className="platform-stat-grid finance-stat-grid">{query.data.summary.totalsByCurrency.map((summary) => <div className="platform-panel finance-currency-summary" key={summary.currency}><strong>{summary.currency} · {tx('filtered date/category totals')}</strong><Metric language={language} label="Recorded income" value={asCurrency(summary.recordedIncome, summary.currency, language)} /><Metric language={language} label="Approved expenses" value={asCurrency(summary.recordedExpenses, summary.currency, language)} /><Metric language={language} label="Recorded balance" value={asCurrency(summary.balance, summary.currency, language)} /><Metric language={language} label="Outstanding records" value={asCurrency(summary.outstanding, summary.currency, language)} /></div>)}</div> : <p className="platform-empty">{tx('No matching financial records for this report range.')}</p>}
      </section>
    </section>}
  </div>
}

function RecentList({ language, records, onReview, onVerify, onReceipt }: {
  language: Language
  records: FinancialRecord[]
  onReview: (record: FinancialRecord, decision: 'APPROVED' | 'REJECTED') => void
  onVerify: (record: FinancialRecord) => void
  onReceipt: (record: FinancialRecord) => void
}) {
  const tx = (text: string) => translateText(language, text)
  if (!records.length) return <p className="platform-empty">{tx('No recent transactions.')}</p>
  return <div className="finance-recent-list">{records.map((record) => <article key={record.id}><div><strong>{record.category}</strong><span>{record.membership?.user.name ?? record.payerName ?? record.description} · {new Date(record.transactionDate).toLocaleDateString(localeCode(language))}</span><span>{record.receiptReference ? `${tx('Receipt reference')}: ${record.receiptReference}` : record.receiptStorageName ? tx('Receipt file attached') : tx('Receipt missing')}</span></div><strong>{record.type === 'EXPENSE' ? '−' : '+'}{asCurrency(record.amount, record.currency, language)}</strong><div className="finance-actions">{record.type === 'EXPENSE' && record.approvalStatus === 'PENDING' && <><button className="table-action" disabled={!record.receiptStorageName && !record.receiptReference} title={!record.receiptStorageName && !record.receiptReference ? tx('Attach a receipt file or reference before approval.') : undefined} onClick={() => onReview(record, 'APPROVED')}>{tx('Approve')}</button><button className="table-action" onClick={() => onReview(record, 'REJECTED')}>{tx('Reject')}</button></>}{record.receiptStorageName && <button className="table-action" onClick={() => onReceipt(record)}>{tx('Receipt')}</button>}{record.status === 'PAID' && !record.verifiedAt && (record.type !== 'EXPENSE' || record.approvalStatus === 'APPROVED') && <button className="table-action" onClick={() => onVerify(record)}>{tx('Verify')}</button>}</div></article>)}</div>
}

function BudgetList({ language, budgets }: { language: Language; budgets: { id: string; name: string; category: string; amount: string; currency: string; startsAt: string; endsAt: string; eventTitle?: string | null; spent: number; remaining: number; overspent: boolean }[] }) {
  const tx = (text: string) => translateText(language, text)
  return <div className="finance-budget-list">{budgets.map((budget) => {
    const ratio = Number(budget.amount) > 0 ? Math.min(100, budget.spent / Number(budget.amount) * 100) : 0
    return <article className={budget.overspent ? 'finance-budget-over' : ''} key={budget.id}><div><strong>{budget.name}</strong><span>{budget.category} · {new Date(budget.startsAt).toLocaleDateString(localeCode(language))} – {new Date(budget.endsAt).toLocaleDateString(localeCode(language))}{budget.eventTitle ? ` · ${budget.eventTitle}` : ''}</span></div><div className="finance-budget-values"><span>{tx('Spent')} {asCurrency(budget.spent, budget.currency, language)} {tx('of')} {asCurrency(budget.amount, budget.currency, language)}</span><span>{budget.overspent ? `${tx('Over by')} ${asCurrency(-budget.remaining, budget.currency, language)}` : `${tx('Remaining')} ${asCurrency(budget.remaining, budget.currency, language)}`}</span></div><div className="finance-budget-track"><span style={{ width: `${ratio}%` }} /></div></article>
  })}</div>
}

function Status({ status, language }: { status: string; language: Language }) {
  const label = status.toLowerCase().replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())
  return <span className={`platform-status status-${status.toLowerCase().replaceAll('_', '-')}`}>{translateText(language, label)}</span>
}

function Metric({ label, value, language = 'EN' }: { label: string; value: string; language?: Language }) {
  return <article className="platform-metric"><span>{translateText(language, label)}</span><strong>{value}</strong></article>
}

function YearSelect({ year, setYear, currentYear }: { year: number; setYear: (year: number) => void; currentYear: number }) {
  return <label className="finance-year-select">Year<select value={year} onChange={(event) => setYear(Number(event.target.value))}>{Array.from({ length: 7 }, (_, index) => currentYear - 3 + index).map((value) => <option key={value}>{value}</option>)}</select></label>
}

function Loading() {
  return <div className="finance-loading" role="status">Loading financial data…</div>
}

function Retry({ message, retry }: { message: string; retry: () => void }) {
  return <div className="error-panel"><strong>{message}</strong><button className="button button-secondary" onClick={retry}>Retry</button></div>
}

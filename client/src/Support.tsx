import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { localeCode, translateText } from './i18n'
import type { Language, Membership } from './types'

type Ticket = {
  id: string
  subject: string
  status: string
  priority: string
  createdAt: string
  updatedAt: string
  choir: { id: string; name: string } | null
  replies: { id: string; body: string; createdAt: string; author: { name: string } }[]
}

const ticketStatusLabels: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  CLOSED: 'Closed',
}
const ticketPriorityLabels: Record<string, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
}

export default function Support({ membership, language }: { membership: Membership; language: Language }) {
  const tx = (text: string) => translateText(language, text)
  const [error, setError] = useState('')
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['support-tickets'], queryFn: () => api<{ tickets: Ticket[] }>('/support/tickets') })
  const create = useMutation({
    mutationFn: (body: Record<string, string>) => api('/support/tickets', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => { setError(''); await queryClient.invalidateQueries({ queryKey: ['support-tickets'] }) },
    onError: (reason) => setError(reason.message),
  })
  const reply = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api(`/support/tickets/${id}/replies`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: () => { setError(''); void queryClient.invalidateQueries({ queryKey: ['support-tickets'] }) },
    onError: (reason) => setError(reason.message),
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    create.mutate({ choirId: membership.choir.id, subject: String(values.get('subject')), body: String(values.get('body')), priority: String(values.get('priority')) })
    event.currentTarget.reset()
  }
  return <div className="platform-stack"><div className="page-heading-row"><div><span className="eyebrow">{tx('HELP & SUPPORT')}</span><h1>{tx('Support tickets')}<span className="heading-period">.</span></h1><p className="muted">{tx('Send a request to the E-Choir support team and follow its replies.')}</p></div></div>
    <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Open a ticket')}</h2><p>{tx('This request will be associated with')} {membership.choir.name}.</p></div></div><form className="platform-form" onSubmit={submit}><label>{tx('Subject')}<input name="subject" required minLength={4} maxLength={200} /></label><label>{tx('Priority')}<select name="priority"><option value="LOW">{tx('Low')}</option><option value="NORMAL">{tx('Normal')}</option><option value="HIGH">{tx('High')}</option><option value="URGENT">{tx('Urgent')}</option></select></label><label>{tx('Message')}<textarea name="body" required minLength={10} maxLength={10000} rows={4} /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary" disabled={create.isPending}>{create.isPending ? tx('Submitting…') : tx('Submit ticket')}</button></form></section>
    <section className="platform-panel"><div className="platform-panel-heading"><div><h2>{tx('Your tickets')}</h2><p>{tx('Ticket messages are visible to your account and authorized support staff.')}</p></div></div>{query.isError ? <div className="error-panel"><strong>{query.error.message}</strong><button className="button button-secondary" onClick={() => void query.refetch()}>{tx('Retry')}</button></div> : query.isLoading ? <p>{tx('Loading tickets…')}</p> : query.data?.tickets.length ? query.data.tickets.map((ticket) => <article className="ticket-card" key={ticket.id}><div className="ticket-head"><div><strong>{ticket.subject}</strong><small><span className={`platform-status status-${ticket.status.toLowerCase().replaceAll('_', '-')}`}>{tx(ticketStatusLabels[ticket.status] ?? ticket.status.replaceAll('_', ' '))}</span> · {tx(ticketPriorityLabels[ticket.priority] ?? ticket.priority)} · {tx('updated')} {new Date(ticket.updatedAt).toLocaleString(localeCode(language))}</small></div></div>{ticket.replies.map((message) => <p className="ticket-reply" key={message.id}><strong>{message.author.name}</strong> · {new Date(message.createdAt).toLocaleString(localeCode(language))}<br />{message.body}</p>)}{ticket.status !== 'CLOSED' && <form className="ticket-reply-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const value = new FormData(form).get('reply'); if (typeof value === 'string' && value.trim()) { reply.mutate({ id: ticket.id, body: value.trim() }); form.reset() } }}><input name="reply" aria-label={`${tx('Reply to')} ${ticket.subject}`} placeholder={tx('Add a reply…')} maxLength={10000} required /><button className="button button-secondary" disabled={reply.isPending}>{tx('Reply')}</button></form>}</article>) : <p className="platform-empty">{tx('You have not submitted any tickets.')}</p>}</section>
  </div>
}

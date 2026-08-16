import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, AtSign, BookOpen, Bot, CheckCheck, ChevronDown, Clock3, Filter, Headphones, Mail, MessageCircle, Mic, MoreVertical, Paperclip, Pause, Phone, PhoneOff, Search, Send, Smile, Smartphone, StickyNote, Volume2, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { get, patch, post } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

type Identifier = { type: string; value: string; normalized_value: string; is_primary?: number }
type Consent = { channel: string; purpose: string; status?: string; action?: string }
type Contact = { id: string; display_name: string; locale: string; timezone: string; identifiers: Identifier[]; consents: Consent[] }
type MessageSource = { file_id: string; filename: string; location: Record<string, unknown>; excerpt: string; score: number }
type Message = { id: string; channel: string; direction: 'inbound' | 'outbound' | 'internal'; kind: string; body: string; created_at: string; status: string; metadata?: { ai_agent?: boolean; provider?: string; model?: string; latency_ms?: number; sources?: MessageSource[]; handoff?: boolean } }
type Conversation = { id: string; contact_id: string; contact_name: string; contact_address: string; preview: string; last_channel: string; status: string; unread_count: number; assigned_user_id?: string; last_message_at: string; contact?: Contact; messages?: Message[]; agent_state?: { widget_id: string; state: string; reason?: string } | null }

const channelIcon = (channel: string, className = 'size-4') => {
  if (channel === 'email') return <Mail className={className}/>
  if (channel === 'sms') return <Smartphone className={className}/>
  if (channel === 'whatsapp') return <MessageCircle className={cn(className, 'text-emerald-600')}/>
  if (channel === 'voice') return <Phone className={className}/>
  return <MessageCircle className={className}/>
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() }
function age(value: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000))
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`
}

function QueueList({ conversations, selected, onSelect, queue, onQueue }: { conversations: Conversation[]; selected?: string; onSelect: (id: string) => void; queue: string; onQueue: (value: string) => void }) {
  const [query, setQuery] = useState('')
  const filtered = conversations.filter((item) => `${item.contact_name} ${item.preview}`.toLowerCase().includes(query.toLowerCase()))
  return <section className={cn('min-h-0 border-e bg-card md:flex md:flex-col', selected && 'hidden md:flex')} aria-label="Conversation queue">
    <div className="border-b p-4">
      <div className="mb-3 flex items-center justify-between"><h1 className="text-lg font-semibold">Inbox</h1><Button variant="ghost" size="icon-sm" aria-label="Inbox options"><MoreVertical/></Button></div>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">{['all', 'mine', 'unassigned'].map((item) => <button key={item} className={cn('rounded-md px-2 py-1.5 text-xs font-medium capitalize', queue === item && 'bg-card text-primary shadow-sm')} onClick={() => onQueue(item)}>{item}</button>)}</div>
      <div className="mt-3 flex gap-1.5">{[['unread', 'Unread'], ['waiting', 'Waiting'], ['snoozed', 'Snoozed']].map(([value, label]) => <button key={value} className={cn('rounded-full border px-2.5 py-1 text-xs', queue === value ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground')} onClick={() => onQueue(value)}>{label}</button>)}</div>
      <div className="mt-3 flex gap-2"><div className="relative flex-1"><Search className="absolute start-2.5 top-2.5 size-4 text-muted-foreground"/><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 ps-8" placeholder="Search conversations"/></div><Button variant="outline" size="icon" className="size-9" aria-label="Filter"><Filter/></Button></div>
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      {filtered.map((item) => <button key={item.id} onClick={() => onSelect(item.id)} className={cn('grid w-full grid-cols-[auto_1fr_auto] gap-3 border-b px-3 py-3 text-start transition hover:bg-muted/60', selected === item.id && 'bg-primary/7')}>
        <span className="relative"><Avatar className="size-10"><AvatarFallback className="bg-gradient-to-br from-slate-100 to-stone-200 text-xs">{initials(item.contact_name)}</AvatarFallback></Avatar>{item.unread_count > 0 && <span className="absolute -start-2 top-4 size-1.5 rounded-full bg-primary"/>}<span className="absolute -bottom-1 -end-1 grid size-5 place-items-center rounded-full border bg-card">{channelIcon(item.last_channel, 'size-3')}</span></span>
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.contact_name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.preview}</span>{item.status === 'waiting' && <span className="mt-1 flex items-center gap-1 text-[0.68rem] text-amber-600"><span className="size-1.5 rounded-full bg-amber-500"/>Waiting</span>}</span>
        <span className="text-[0.68rem] text-muted-foreground">{age(item.last_message_at)}</span>
      </button>)}
      {!filtered.length && <div className="p-8 text-center text-sm text-muted-foreground">No conversations in this queue.</div>}
    </div>
  </section>
}

function MessageBubble({ message }: { message: Message }) {
  if (message.direction === 'internal') return <div className="mx-auto my-3 flex max-w-md items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"><StickyNote className="mt-0.5 size-4"/><span><strong>Internal note</strong><br/>{message.body}</span></div>
  if (message.channel === 'voice' || message.kind === 'call') return <div className="flex items-center gap-3 py-1 text-sm text-muted-foreground"><span className="grid size-9 shrink-0 place-items-center rounded-full border bg-card"><Phone className="size-4 text-foreground"/></span><div><div className="flex items-center gap-2"><strong className="text-foreground">Call {message.direction === 'outbound' ? 'outbound' : 'inbound'}</strong><time className="text-xs">{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><span>{message.body}</span></div></div>
  const outbound = message.direction === 'outbound', aiMessage = Boolean(message.metadata?.ai_agent)
  return <div className={cn('flex gap-2', outbound && 'justify-end')}>
    {!outbound && <Avatar className="mt-5 size-8"><AvatarFallback className="text-[0.65rem]">CM</AvatarFallback></Avatar>}
    <div className={cn('max-w-[78%]', outbound && 'text-end')}>
      <div className={cn('mb-1 flex items-center gap-2 text-[0.7rem] text-muted-foreground', outbound && 'justify-end')}><span className="flex items-center gap-1 font-medium">{channelIcon(message.channel, 'size-3')}{message.channel === 'chat' ? 'Website chat' : message.channel[0].toUpperCase() + message.channel.slice(1)}</span>{aiMessage && <Badge variant="secondary"><Bot/>AI answer</Badge>}<time>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
      <div className={cn('rounded-xl border px-3 py-2 text-start text-[0.8rem] leading-snug shadow-[0_1px_0_rgba(15,23,42,.03)] md:px-3.5 md:py-2.5 md:text-sm md:leading-relaxed', outbound ? 'border-blue-200 bg-blue-50' : message.channel === 'whatsapp' ? 'border-emerald-200 bg-emerald-50/70' : 'bg-card')}>{message.body}{outbound && <CheckCheck className="ms-auto mt-1 size-3.5 text-primary"/>}</div>{aiMessage && message.metadata?.sources?.length ? <details className="mt-1 rounded-lg border bg-card p-2 text-start"><summary className="flex cursor-pointer items-center gap-1 text-xs font-medium text-primary"><BookOpen className="size-3"/>View answer sources</summary><div className="mt-2 grid gap-2">{message.metadata.sources.map((source, index) => <div className="rounded-md border p-2" key={`${source.file_id}-${index}`}><div className="flex flex-wrap items-center gap-2 text-xs"><a className="font-medium text-primary hover:underline" href={`/files/${source.file_id}`} translate="no">{source.filename}</a><span className="text-muted-foreground">{source.location.page ? `Page ${source.location.page}` : source.location.slide ? `Slide ${source.location.slide}` : source.location.sheet ? `${source.location.sheet} · rows ${source.location.row_start ?? '?'}–${source.location.row_end ?? '?'}` : String(source.location.section ?? 'Document')}</span><Badge className="ms-auto" variant="outline">{Number(source.score).toFixed(3)}</Badge></div><p className="mt-1 line-clamp-3 text-xs text-muted-foreground" translate="no">{source.excerpt}</p></div>)}</div><p className="mt-2 text-xs text-muted-foreground">Model: <span translate="no">{message.metadata.model ?? '—'}</span> · Latency: {message.metadata.latency_ms ?? 0} ms</p></details> : null}
    </div>
  </div>
}

function CallDock({ contactName, onClose }: { contactName: string; onClose: () => void }) {
  const [seconds, setSeconds] = useState(0), [muted, setMuted] = useState(false), [hold, setHold] = useState(false), [keypad, setKeypad] = useState(false)
  useEffect(() => { const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [])
  return <div className="mx-3 mb-2 rounded-xl border bg-card shadow-lg">
    <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5"><Avatar className="size-9"><AvatarFallback>{initials(contactName)}</AvatarFallback></Avatar><div><strong className="text-sm">{contactName}</strong><div className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500"/>{hold ? 'On hold' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`} · Twilio Voice</div></div><div className="ms-auto flex gap-2"><Button variant={muted ? 'default' : 'outline'} size="sm" onClick={() => setMuted(!muted)}><Mic/>Mute</Button><Button variant={hold ? 'default' : 'outline'} size="sm" onClick={() => setHold(!hold)}><Pause/>Hold</Button><Button variant="outline" size="sm" onClick={() => setKeypad(!keypad)}><Headphones/>Keypad</Button><Button variant="destructive" size="sm" onClick={onClose}><PhoneOff/>End</Button></div></div>
    <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground"><span>Audio device</span><button className="rounded border px-2 py-1">Default — MacBook microphone <ChevronDown className="inline size-3"/></button><Volume2 className="ms-auto size-4"/><span className="h-1.5 w-24 rounded bg-gradient-to-r from-primary via-primary to-muted"/></div>
    {keypad && <div className="grid grid-cols-3 gap-1 border-t p-2">{'123456789*0#'.split('').map((key) => <button className="rounded border py-1.5 text-xs hover:bg-muted" key={key}>{key}</button>)}</div>}
  </div>
}

function ConversationPane({ conversation, onBack }: { conversation?: Conversation; onBack: () => void }) {
  const { brand, user } = useAuth(), queryClient = useQueryClient()
  const [reply, setReply] = useState(''), [channel, setChannel] = useState('whatsapp'), [internal, setInternal] = useState(false), [calling, setCalling] = useState(false)
  const detail = useQuery({ queryKey: ['conversation', brand?.id, conversation?.id], queryFn: () => get<{ data: Conversation }>(`/api/v2/brands/${brand?.id}/conversations/${conversation?.id}`).then((item) => item.data), enabled: !!brand && !!conversation })
  useEffect(() => { if (detail.data?.last_channel && detail.data.last_channel !== 'voice') setChannel(detail.data.last_channel) }, [detail.data?.last_channel])
  const sendReply = useMutation({ mutationFn: () => post(`/api/v2/brands/${brand?.id}/conversations/${conversation?.id}/replies`, { body: reply, channel, internal, media: [] }), onSuccess: async () => { setReply(''); await queryClient.invalidateQueries({ queryKey: ['conversation', brand?.id, conversation?.id] }); await queryClient.invalidateQueries({ queryKey: ['conversations', brand?.id] }) } })
  const update = useMutation({ mutationFn: (value: Record<string, unknown>) => patch(`/api/v2/brands/${brand?.id}/conversations/${conversation?.id}`, value), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversation', brand?.id, conversation?.id] }) })
  const resumeAgent = useMutation({ mutationFn: (widgetId: string) => post(`/api/v2/brands/${brand?.id}/conversations/${conversation?.id}/agent/resume`, { widget_id: widgetId }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversation', brand?.id, conversation?.id] }) })
  const current = detail.data ?? conversation
  if (!current) return <section className="hidden min-h-0 place-items-center bg-muted/10 text-sm text-muted-foreground md:grid">Select a conversation to see its history.</section>
  return <section className="flex min-h-0 flex-col bg-background">
    <header className="flex min-h-16 items-center gap-3 border-b px-3 md:px-4"><Button variant="ghost" size="icon" className="md:hidden" onClick={onBack}><ArrowLeft/></Button><Avatar className="size-9 md:hidden"><AvatarFallback>{initials(current.contact_name)}</AvatarFallback></Avatar><div className="min-w-0"><h2 className="truncate font-semibold">{current.contact_name}</h2><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500"/>Online</div></div><div className="ms-auto flex gap-1.5">{current.agent_state && current.agent_state.state !== 'active' && <Button variant="outline" size="sm" onClick={() => resumeAgent.mutate(current.agent_state!.widget_id)} disabled={resumeAgent.isPending}><Bot/><span className="hidden sm:inline">Resume AI</span></Button>}<Button variant="outline" size="sm" aria-label="Call contact" onClick={() => setCalling(true)}><Phone/> <span className="hidden sm:inline">Call</span></Button><Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => update.mutate({ status: 'snoozed', snoozed_until: new Date(Date.now() + 86400000).toISOString() })}><Clock3/>Snooze</Button><Button variant="outline" size="sm" aria-label="Close conversation" onClick={() => update.mutate({ status: 'closed' })}><X/><span className="hidden sm:inline">Close</span></Button></div></header>
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3 md:px-6 md:py-5"><div className="mx-auto max-w-2xl space-y-3 md:space-y-4"><div className="flex items-center gap-4 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border"/>Today<span className="h-px flex-1 bg-border"/></div>{current.messages?.map((message) => <MessageBubble key={message.id} message={message}/>)}</div></div>
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 md:hidden"><Avatar className="size-7"><AvatarFallback className="text-[0.65rem]">QA</AvatarFallback></Avatar><Button variant="ghost" size="sm" onClick={() => update.mutate({ assigned_user_id: current.assigned_user_id ? null : user?.id ?? null })}>{current.assigned_user_id ? 'QA Admin' : 'Assign to me'}<ChevronDown/></Button><Badge className="ms-auto bg-emerald-50 text-emerald-700">{current.status === 'closed' ? 'Closed' : 'Open'}</Badge></div>
    {calling && (
      <CallDock contactName={current.contact_name} onClose={() => setCalling(false)}/>
    )}
    <div className="border-t bg-card p-3"><div className="mx-auto max-w-3xl overflow-hidden rounded-xl border bg-background"><div className="flex items-center gap-2 border-b px-2.5 py-2"><button className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">{channelIcon(channel)}<span className="capitalize">{channel}</span><ChevronDown className="size-3"/></button><Button variant="ghost" size="icon-sm"><Paperclip/></Button><label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">Internal note<Switch checked={internal} onCheckedChange={setInternal}/></label></div><Textarea value={reply} onChange={(event) => setReply(event.target.value)} className="min-h-16 resize-none border-0 shadow-none focus-visible:ring-0 md:min-h-24" placeholder={internal ? 'Add a private note…' : `Reply on ${channel}…`}/><div className="flex items-center px-2.5 pb-2.5"><Button variant="ghost" size="icon-sm"><Smile/></Button><Button className="ms-auto" disabled={!reply.trim() || sendReply.isPending} onClick={() => sendReply.mutate()}><Send/>Send</Button></div></div></div>
  </section>
}

function ContactPanel({ conversation }: { conversation?: Conversation }) {
  const { brand, user } = useAuth(), queryClient = useQueryClient()
  const assignment = useMutation({ mutationFn: () => patch(`/api/v2/brands/${brand?.id}/conversations/${conversation?.id}`, { assigned_user_id: conversation?.assigned_user_id ? null : user?.id ?? null }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['conversation', brand?.id, conversation?.id] }); await queryClient.invalidateQueries({ queryKey: ['conversation-contact', brand?.id, conversation?.id] }); await queryClient.invalidateQueries({ queryKey: ['conversations', brand?.id] }) } })
  const contact = conversation?.contact
  if (!conversation) return null
  const email = contact?.identifiers?.find((item) => item.type === 'email')?.value ?? conversation.contact_address
  const phone = contact?.identifiers?.find((item) => item.type === 'phone')?.value
  return <aside className="hidden min-h-0 overflow-auto border-s bg-card p-4 xl:block">
    <div className="mb-4 flex items-center gap-3"><Avatar className="size-11"><AvatarFallback>{initials(conversation.contact_name)}</AvatarFallback></Avatar><div className="min-w-0"><h3 className="truncate font-semibold">{conversation.contact_name}</h3><p className="text-xs text-muted-foreground">Atlas customer</p></div><Button variant="ghost" size="icon-sm" className="ms-auto"><MoreVertical/></Button></div>
    <div className="space-y-2 border-b pb-4 text-xs text-muted-foreground"><p className="flex items-center gap-2"><Mail className="size-3.5"/>{email}</p>{phone && <p className="flex items-center gap-2"><Phone className="size-3.5"/>{phone}</p>}<p className="flex items-center gap-2"><AtSign className="size-3.5"/>{contact?.locale?.toUpperCase()} · {contact?.timezone}</p></div>
    <div className="border-b py-4"><p className="mb-2 text-xs font-medium">Channels</p><div className="flex gap-3">{['email', 'sms', 'whatsapp', 'chat', 'voice'].map((item) => <span key={item} className="relative grid size-7 place-items-center rounded-md border">{channelIcon(item, 'size-3.5')}<span className="absolute -end-1 -top-1 size-2 rounded-full border border-card bg-emerald-500"/></span>)}</div></div>
    <div className="border-b py-4"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium">Assigned to</span><button className="text-primary" onClick={() => assignment.mutate()} disabled={assignment.isPending}>{conversation.assigned_user_id ? 'Unassign' : 'Assign to me'}</button></div><div className="flex items-center gap-2 text-sm"><Avatar className="size-7"><AvatarFallback className="text-[0.65rem]">QA</AvatarFallback></Avatar>{conversation.assigned_user_id ? 'QA Admin' : 'Unassigned'}</div></div>
    <div className="border-b py-4"><p className="mb-2 text-xs font-medium">Tags</p><div className="flex flex-wrap gap-1"><Badge variant="secondary">VIP</Badge><Badge variant="outline">Product</Badge><Badge className="bg-emerald-50 text-emerald-700">Repeat buyer</Badge></div></div>
    <div className="py-4"><p className="mb-3 text-xs font-medium">Consent status</p><div className="space-y-2">{['email', 'sms', 'whatsapp', 'push'].map((item) => { const consent = contact?.consents?.find((entry) => entry.channel === item && entry.purpose === 'marketing'); return <div key={item} className="flex items-center justify-between text-xs"><span className="capitalize">{item}</span><Badge className={consent ? 'bg-emerald-50 text-emerald-700' : ''} variant={consent ? 'default' : 'secondary'}>{consent ? 'Subscribed' : 'Not subscribed'}</Badge></div> })}</div></div>
  </aside>
}

export default function InboxPage() {
  const { brand } = useAuth(), [searchParams] = useSearchParams(), [queue, setQueue] = useState('all'), [selected, setSelected] = useState<string>()
  const conversations = useQuery({ queryKey: ['conversations', brand?.id, queue], queryFn: () => get<{ data: Conversation[] }>(`/api/v2/brands/${brand?.id}/conversations?queue=${queue}`).then((item) => item.data), enabled: !!brand, refetchInterval: 15_000 })
  useEffect(() => {
    if (selected || !conversations.data?.length) return
    const conversationId = searchParams.get('conversation')
    const contactId = searchParams.get('contact')
    const requested = conversations.data.find((item) => item.id === conversationId || item.contact_id === contactId)
    setSelected(requested?.id ?? conversations.data[0].id)
  }, [conversations.data, searchParams, selected])
  const chosen = useMemo(() => conversations.data?.find((item) => item.id === selected), [conversations.data, selected])
  const details = useQuery({ queryKey: ['conversation-contact', brand?.id, selected], queryFn: () => get<{ data: Conversation }>(`/api/v2/brands/${brand?.id}/conversations/${selected}`).then((item) => item.data), enabled: !!brand && !!selected })
  return <div className="-m-4 h-[calc(100dvh-3.5rem)] min-h-0 sm:-mx-6 sm:-mb-6 sm:-mt-5 lg:-mx-8 lg:-mb-7 lg:-mt-7">
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden border-t bg-card md:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(30rem,1fr)_17rem]">
      <QueueList conversations={conversations.data ?? []} selected={selected} onSelect={setSelected} queue={queue} onQueue={(value) => { setQueue(value); setSelected(undefined) }}/>
      <ConversationPane conversation={chosen} onBack={() => setSelected(undefined)}/>
      <ContactPanel conversation={details.data}/>
    </div>
  </div>
}

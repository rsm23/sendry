import { useState } from 'react'
import { CheckCheck, MessageCircle, MoreHorizontal, Paperclip, Send, ShieldCheck, Smile, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { PreferencesMenu } from '@/components/preferences-menu'

type ChatMessage = { id: string; body: string; direction: 'inbound' | 'outbound'; time: string }

export default function ChatWidgetPage() {
  const { publicKey = '' } = useParams(), [session, setSession] = useState<{ token: string; greeting: string }>(), [name, setName] = useState(''), [email, setEmail] = useState(''), [opening, setOpening] = useState(''), [draft, setDraft] = useState(''), [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  async function start() {
    setLoading(true)
    try {
      const result = await post<{ data: { token: string; greeting: string } }>(`/api/v2/public/widget/${publicKey}/session`, { name, email: email || undefined, message: opening || undefined, bot_token: crypto.randomUUID() })
      setSession(result.data)
      setMessages([{ id: 'greeting', body: result.data.greeting, direction: 'outbound', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...(opening ? [{ id: 'opening', body: opening, direction: 'inbound' as const, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }] : [])])
    } finally { setLoading(false) }
  }
  async function send() {
    if (!draft.trim() || !session) return
    const body = draft; setDraft('')
    await fetch(`/api/v2/public/widget/${publicKey}/messages`, { method: 'POST', credentials: 'include', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ body, client_id: crypto.randomUUID() }) })
    setMessages((current) => [...current, { id: crypto.randomUUID(), body, direction: 'inbound', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
  }
  return <main className="min-h-dvh bg-background p-3 text-foreground"><section className="mx-auto flex h-[min(680px,calc(100dvh-24px))] max-w-md flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
    <header className="flex items-center gap-3 border-b px-4 py-3"><span className="grid size-10 place-items-center rounded-xl bg-foreground text-background">AC</span><div><h1 className="text-sm font-semibold">Atlas support</h1><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500"/>Online · replies in a few minutes</p></div><PreferencesMenu className="ms-auto"/><Button variant="ghost" size="icon-sm"><MoreHorizontal/></Button><Button variant="ghost" size="icon-sm"><X/></Button></header>
    {!session ? <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5"><div className="mb-6"><span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><MessageCircle/></span><h2 className="text-xl font-semibold">How can we help?</h2><p className="mt-1 text-sm text-muted-foreground">Share a few details and the Atlas team will join the conversation.</p></div><div className="space-y-4"><label className="block text-sm font-medium">Name<Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5" placeholder="Your name"/></label><label className="block text-sm font-medium">Email<Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className="mt-1.5" placeholder="you@example.com"/></label><label className="block text-sm font-medium">What do you need help with?<Textarea value={opening} onChange={(event) => setOpening(event.target.value)} className="mt-1.5 min-h-28" placeholder="Write your message…"/></label><Button className="w-full" disabled={!name.trim() || !opening.trim() || loading} onClick={() => void start()}>{loading ? 'Starting…' : 'Start conversation'}<Send/></Button></div><p className="mt-auto flex items-center justify-center gap-1 pt-8 text-[0.68rem] text-muted-foreground"><ShieldCheck className="size-3"/>Your conversation is protected.</p></div> : <>
      <div className="border-b bg-muted/50 px-4 py-3"><div className="flex items-center gap-3"><Avatar className="size-9"><AvatarFallback>QA</AvatarFallback></Avatar><div><strong className="block text-sm">QA Admin</strong><span className="text-xs text-muted-foreground">Joined the conversation</span></div><span className="ms-auto rounded-full bg-emerald-50 px-2 py-1 text-[0.65rem] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Online</span></div></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4"><div className="flex items-center gap-3 text-[0.68rem] text-muted-foreground"><span className="h-px flex-1 bg-border"/>Today<span className="h-px flex-1 bg-border"/></div>{messages.map((message) => <div key={message.id} className={message.direction === 'inbound' ? 'ms-auto max-w-[82%]' : 'max-w-[82%]'}><div className={message.direction === 'inbound' ? 'rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5 text-sm' : 'rounded-xl border bg-background px-3 py-2.5 text-sm shadow-sm'}>{message.body}<div className="mt-1 flex justify-end gap-1 text-[0.6rem] text-muted-foreground">{message.time}{message.direction === 'inbound' && <CheckCheck className="size-3 text-primary"/>}</div></div></div>)}<div className="flex items-center gap-2 text-xs text-muted-foreground"><Avatar className="size-7"><AvatarFallback className="text-[0.6rem]">QA</AvatarFallback></Avatar>QA Admin is typing… <span className="rounded-full border px-2 tracking-[.2em]">•••</span></div></div>
      <div className="border-t p-3"><div className="rounded-xl border"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} className="min-h-20 resize-none border-0 shadow-none focus-visible:ring-0" placeholder="Write a message…"/><div className="flex items-center px-2 pb-2"><Button variant="ghost" size="icon-sm"><Paperclip/></Button><Button variant="ghost" size="icon-sm"><Smile/></Button><Button size="icon" className="ms-auto" onClick={() => void send()} disabled={!draft.trim()}><Send/></Button></div></div><div className="pt-2 text-center text-[0.65rem] text-slate-400">Powered by Sendry · Privacy</div></div>
    </>}
  </section></main>
}

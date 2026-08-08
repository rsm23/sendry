import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Mail, ServerCog } from 'lucide-react'
import { get, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SetupPage() {
  const navigate = useNavigate(); const { refresh } = useAuth(); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => get<{ required: boolean }>('/api/setup/status') })
  const [value, setValue] = useState({ name: '', email: '', password: '', company: '', brand: '', from_name: '', from_email: '', reply_to: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  if (status.data && !status.data.required) return <Navigate to="/login" replace />
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await post('/api/setup', value); await refresh(); navigate('/overview', { replace: true }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Setup failed') } finally { setBusy(false) } }
  const field = (key: keyof typeof value, label: string, type = 'text', placeholder = '') => <div><Label htmlFor={key}>{label}</Label><Input id={key} className="mt-1.5" type={type} value={value[key]} placeholder={placeholder} onChange={(event) => setValue((current) => ({ ...current, [key]: event.target.value }))} required /></div>
  return <main className="min-h-svh bg-muted/40 p-5 sm:p-10"><div className="mx-auto mb-8 flex max-w-3xl items-center gap-2"><span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Mail className="size-5" /></span><strong className="text-lg">Sendry</strong></div><Card className="mx-auto max-w-3xl"><CardHeader><div className="mb-4 grid size-11 place-items-center rounded-lg bg-primary/10 text-primary"><ServerCog /></div><CardTitle className="text-2xl">Create your delivery workspace</CardTitle><CardDescription>Set the owner account and the first sender identity. The local stream provider keeps initial tests safely on this server.</CardDescription></CardHeader><CardContent><form onSubmit={submit} className="space-y-6"><div className="grid gap-4 sm:grid-cols-2">{field('name', 'Your name', 'text', 'Ada Lovelace')}{field('email', 'Administrator email', 'email', 'admin@example.com')}{field('password', 'Password', 'password', 'At least 12 characters')}{field('company', 'Workspace or company', 'text', 'Atlas Studio')}</div><div className="border-t pt-6"><h2 className="mb-4 font-semibold">First brand</h2><div className="grid gap-4 sm:grid-cols-2">{field('brand', 'Brand name', 'text', 'Atlas')}{field('from_name', 'Sender name', 'text', 'Atlas Team')}{field('from_email', 'Sender email', 'email', 'hello@example.com')}{field('reply_to', 'Reply-to email', 'email', 'support@example.com')}</div></div><div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><Check className="mr-2 inline size-4" />After setup, add SMTP or Amazon SES credentials in Settings when you are ready for external delivery.</div>{error && <p className="text-sm text-destructive">{error}</p>}<div className="flex justify-end"><Button type="submit" disabled={busy || value.password.length < 12}>{busy ? 'Creating workspace…' : 'Create workspace'}<ArrowRight /></Button></div></form></CardContent></Card></main>
}

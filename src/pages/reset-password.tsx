import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, KeyRound, Mail } from 'lucide-react'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ResetPasswordPage() {
  const [search] = useSearchParams(); const navigate = useNavigate(); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const token = search.get('token') ?? ''
  async function submit(event: FormEvent) { event.preventDefault(); if (password !== confirm) return setError('Passwords do not match'); setBusy(true); setError(''); try { await post('/api/auth/reset-password', { token, password }); navigate('/login', { replace: true }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Password reset failed') } finally { setBusy(false) } }
  return <main className="grid min-h-svh place-items-center bg-muted/40 p-5"><Card className="w-full max-w-md"><CardHeader><div className="mb-4 flex items-center gap-2"><span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><Mail className="size-4" /></span><strong>Sendry</strong></div><CardTitle>Choose a new password</CardTitle><CardDescription>The recovery link can be used once and expires after one hour.</CardDescription></CardHeader><CardContent><form onSubmit={submit} className="space-y-4"><div><Label htmlFor="password">New password</Label><Input id="password" type="password" className="mt-1.5" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></div><div><Label htmlFor="confirm">Confirm password</Label><Input id="confirm" type="password" className="mt-1.5" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={12} required /></div>{error && <p className="text-sm text-destructive">{error}</p>}<Button className="w-full" type="submit" disabled={busy || !token || password.length < 12}><KeyRound />{busy ? 'Saving…' : 'Reset password'}<ArrowRight /></Button><Button variant="ghost" className="w-full" render={<Link to="/login" />}>Return to sign in</Button></form></CardContent></Card></main>
}

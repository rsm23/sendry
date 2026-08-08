import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, KeyRound, Mail, Moon, ShieldCheck, Sun } from 'lucide-react'
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { ApiError, get, post } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const { user, login, refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('qa@sendry.local')
  const [password, setPassword] = useState('TestPass123!')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dark, setDark] = useState(false)
  const setup = useQuery({ queryKey: ['setup-status'], queryFn: () => get<{ required: boolean }>('/api/setup/status') })
  if (user) return <Navigate to="/overview" replace />
  if (setup.data?.required) return <Navigate to="/setup" replace />

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await login(email, password, needsCode ? code : undefined)
      if (result.requiresTwoFactor) setNeedsCode(true)
      else navigate((location.state as { from?: string } | null)?.from ?? '/overview', { replace: true })
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Unable to sign in') }
    finally { setBusy(false) }
  }

  async function passkey() {
    setBusy(true); setError('')
    try {
      const challenge = await post<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/api/auth/passkey/options', { email })
      const credential = await startAuthentication({ optionsJSON: challenge.options })
      await post('/api/auth/passkey/verify', { challengeId: challenge.challengeId, response: credential })
      await refresh()
      navigate('/overview', { replace: true })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Passkey sign-in failed') }
    finally { setBusy(false) }
  }

  async function forgotPassword() {
    const result = await post<{ resetUrl?: string }>('/api/auth/forgot-password', { email })
    if (result.resetUrl) navigate(result.resetUrl.replace(window.location.origin, ''))
    else toast.success('If the account exists, recovery instructions have been sent.')
  }

  return <div className={dark ? 'dark' : ''}><main className="grid min-h-svh bg-background lg:grid-cols-[1.1fr_0.9fr]">
    <section className="relative hidden overflow-hidden bg-[#11151d] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:44px_44px]"/>
      <div className="relative flex items-center gap-3 text-xl font-semibold"><span className="grid size-9 place-items-center rounded-lg bg-blue-600"><Mail className="size-5"/></span>Sendry</div>
      <div className="relative max-w-xl"><p className="eyebrow mb-5 text-blue-300">Self-hosted delivery workspace</p><h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.055em]">Campaign operations without the blind spots.</h1><p className="mt-6 max-w-lg text-lg leading-relaxed text-white/65">Compose, deliver, automate, and understand every email from one auditable workspace.</p><div className="mt-10 grid grid-cols-3 gap-3"><div className="border-l border-white/15 pl-4"><p className="text-2xl font-medium tabular-nums">99.2%</p><p className="mt-1 text-xs text-white/50">Deliverability</p></div><div className="border-l border-white/15 pl-4"><p className="text-2xl font-medium tabular-nums">14/s</p><p className="mt-1 text-xs text-white/50">Current rate</p></div><div className="border-l border-white/15 pl-4"><p className="text-2xl font-medium tabular-nums">42k</p><p className="mt-1 text-xs text-white/50">Daily capacity</p></div></div></div>
      <div className="relative flex items-center gap-2 text-sm text-white/50"><ShieldCheck className="size-4"/> Credentials and audience data remain on your infrastructure.</div>
    </section>
    <section className="flex items-center justify-center p-5 sm:p-10">
      <Button variant="ghost" size="icon-sm" className="absolute right-4 top-4" onClick={() => { document.documentElement.classList.toggle('dark'); setDark(!dark) }} aria-label="Toggle theme">{dark ? <Sun/> : <Moon/>}</Button>
      <Card className="w-full max-w-md border-0 bg-transparent shadow-none sm:border sm:bg-card sm:p-3 sm:shadow-sm">
        <CardHeader><div className="mb-5 flex items-center gap-2 lg:hidden"><span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><Mail className="size-4"/></span><strong>Sendry</strong></div><CardTitle className="text-2xl">{needsCode ? 'Confirm it is you' : 'Welcome back'}</CardTitle><CardDescription>{needsCode ? 'Enter the six-digit authentication code from your authenticator.' : 'Sign in to manage campaigns, audiences, and delivery.'}</CardDescription></CardHeader>
        <CardContent><form onSubmit={submit}><FieldGroup>{!needsCode && <><Field><FieldLabel htmlFor="email">Email address</FieldLabel><Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required/></Field><Field><div className="flex items-center justify-between"><FieldLabel htmlFor="password">Password</FieldLabel><button className="text-xs text-primary hover:underline" type="button" onClick={() => void forgotPassword()}>Forgot password?</button></div><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/></Field></>}{needsCode && <Field><FieldLabel htmlFor="code">Authentication or recovery code</FieldLabel><Input id="code" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/[^a-zA-Z0-9-]/g,'').slice(0,20))} className="text-center text-xl tracking-[.25em]" required/></Field>}{error && <FieldError>{error}</FieldError>}<Button className="mt-1 w-full" type="submit" disabled={busy}>{busy ? 'Signing in…' : needsCode ? 'Verify code' : 'Sign in'}<ArrowRight/></Button>{!needsCode && <><div className="flex items-center gap-3 py-2 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">or</div><Button type="button" variant="outline" className="w-full" disabled={busy || !email} onClick={() => void passkey()}><KeyRound/> Sign in with a passkey</Button></>}</FieldGroup></form><p className="mt-6 text-center text-xs text-muted-foreground">Local QA: qa@sendry.local / TestPass123!</p></CardContent>
      </Card>
    </section>
  </main></div>
}

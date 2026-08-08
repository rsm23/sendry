import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, Braces, Globe2, MailWarning, Plus, RefreshCw, ShieldCheck, Trash2, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { get, patch, post, remove } from '@/lib/api'
import { relative, shortDate } from '@/lib/format'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type Rule = { id: string; name: string; trigger_type: string; action_type: string; enabled: boolean; scope: Record<string, unknown>; action_config: Record<string, unknown>; created_at: string }
type WebhookLog = { id: string; rule_name?: string; endpoint: string; status_code?: number; response?: string; error?: string; attempted_at: string }
type Suppression = { id: string; email: string; reason: string; created_at: string }
type Domain = { id: string; domain: string; created_at: string }

export default function RulesPage() {
  const { brand } = useAuth()
  const [ruleOpen, setRuleOpen] = useState(false)
  const [suppressionOpen, setSuppressionOpen] = useState(false)
  const [domainOpen, setDomainOpen] = useState(false)
  const rules = useQuery({ queryKey: ['rules', brand?.id], queryFn: () => get<Rule[]>(`/api/brands/${brand?.id}/rules`), enabled: !!brand })
  const webhooks = useQuery({ queryKey: ['webhooks', brand?.id], queryFn: () => get<WebhookLog[]>(`/api/brands/${brand?.id}/webhooks`), enabled: !!brand })
  const suppressions = useQuery({ queryKey: ['suppressions', brand?.id], queryFn: () => get<Suppression[]>(`/api/brands/${brand?.id}/suppressions`), enabled: !!brand })
  const domains = useQuery({ queryKey: ['domains', brand?.id], queryFn: () => get<Domain[]>(`/api/brands/${brand?.id}/blocked-domains`), enabled: !!brand })
  const refresh = async () => Promise.all([rules.refetch(), webhooks.refetch(), suppressions.refetch(), domains.refetch()])

  return <>
    <PageHeader eyebrow={brand?.name} title="Rules & safety" description="Automate delivery events, inspect webhook attempts, and control who can receive mail." actions={<Button onClick={() => setRuleOpen(true)}><Plus /> Create rule</Button>} />
    <Tabs defaultValue="rules">
      <TabsList className="mb-5 flex h-auto w-full justify-start overflow-x-auto bg-transparent p-0">
        <TabsTrigger value="rules"><ShieldCheck /> Rules</TabsTrigger><TabsTrigger value="webhooks"><Webhook /> Webhook log</TabsTrigger><TabsTrigger value="suppressions"><MailWarning /> Suppressions</TabsTrigger><TabsTrigger value="domains"><Ban /> Blocked domains</TabsTrigger><TabsTrigger value="housekeeping"><RefreshCw /> Housekeeping</TabsTrigger>
      </TabsList>
      <TabsContent value="rules">
        <div className="data-grid"><Table><TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Status</TableHead><TableHead className="w-20" /></TableRow></TableHeader><TableBody>
          {rules.data?.map((rule) => <TableRow key={rule.id}><TableCell><p className="font-medium">{rule.name}</p><p className="text-xs text-muted-foreground">Created {shortDate(rule.created_at)}</p></TableCell><TableCell className="capitalize">{rule.trigger_type.replaceAll('_', ' ')}</TableCell><TableCell className="capitalize">{rule.action_type}</TableCell><TableCell><Switch checked={rule.enabled} onCheckedChange={async (value) => { await patch(`/api/brands/${brand?.id}/rules/${rule.id}`, { enabled: Boolean(value) }); await rules.refetch() }} aria-label={`Enable ${rule.name}`} /></TableCell><TableCell><Button variant="ghost" size="icon-sm" onClick={async () => { await remove(`/api/brands/${brand?.id}/rules/${rule.id}`); await rules.refetch(); toast.success('Rule deleted') }}><Trash2 /></Button></TableCell></TableRow>)}
          {!rules.data?.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">Create a rule to act on subscription and delivery events.</TableCell></TableRow>}
        </TableBody></Table></div>
      </TabsContent>
      <TabsContent value="webhooks"><Card><CardHeader><CardTitle>Webhook attempts</CardTitle><CardDescription>Response codes and failure bodies from the latest 200 attempts.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Endpoint</TableHead><TableHead>Result</TableHead><TableHead>Attempted</TableHead></TableRow></TableHeader><TableBody>{webhooks.data?.map((item) => <TableRow key={item.id}><TableCell>{item.rule_name ?? 'Deleted rule'}</TableCell><TableCell className="max-w-80 truncate font-mono text-xs">{item.endpoint}</TableCell><TableCell><StatusBadge status={item.status_code && item.status_code < 400 ? 'success' : 'failed'} /> <span className="ml-2 text-xs text-muted-foreground">{item.status_code ?? item.error ?? 'Pending'}</span></TableCell><TableCell>{relative(item.attempted_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
      <TabsContent value="suppressions"><SimpleRegistry title="Suppression list" description="These addresses are excluded from every campaign and automation." actionLabel="Add addresses" onAction={() => setSuppressionOpen(true)} rows={suppressions.data?.map((item) => ({ id: item.id, primary: item.email, secondary: item.reason, date: item.created_at })) ?? []} onDelete={async (id) => { await remove(`/api/brands/${brand?.id}/suppressions/${id}`); await suppressions.refetch() }} /></TabsContent>
      <TabsContent value="domains"><SimpleRegistry title="Blocked domains" description="Prevent delivery to disposable, risky, or disallowed email domains." actionLabel="Add domains" onAction={() => setDomainOpen(true)} rows={domains.data?.map((item) => ({ id: item.id, primary: item.domain, secondary: 'Every matching address', date: item.created_at })) ?? []} onDelete={async (id) => { await remove(`/api/brands/${brand?.id}/blocked-domains/${id}`); await domains.refetch() }} /></TabsContent>
      <TabsContent value="housekeeping"><Housekeeping brandId={brand?.id ?? ''} onComplete={refresh} /></TabsContent>
    </Tabs>
    <RuleDialog open={ruleOpen} onOpenChange={setRuleOpen} onCreate={async (value) => { await post(`/api/brands/${brand?.id}/rules`, value); setRuleOpen(false); await rules.refetch(); toast.success('Rule created') }} />
    <LineDialog open={suppressionOpen} onOpenChange={setSuppressionOpen} title="Add suppressed addresses" placeholder={'risk@example.test\nbounced@example.test'} onSave={async (values) => { await post(`/api/brands/${brand?.id}/suppressions`, { emails: values, reason: 'manual' }); setSuppressionOpen(false); await suppressions.refetch() }} />
    <LineDialog open={domainOpen} onOpenChange={setDomainOpen} title="Add blocked domains" placeholder={'temporary-mail.test\nrisky-domain.test'} onSave={async (values) => { await post(`/api/brands/${brand?.id}/blocked-domains`, { domains: values }); setDomainOpen(false); await domains.refetch() }} />
  </>
}

function RuleDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (value: boolean) => void; onCreate: (value: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState('Subscriber lifecycle webhook')
  const [trigger, setTrigger] = useState('subscribe')
  const [action, setAction] = useState('webhook')
  const [destination, setDestination] = useState('https://example.test/events')
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Create rule</DialogTitle><DialogDescription>Run a webhook, notification email, or unsubscribe action after a product event.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Trigger"><Select value={trigger} onValueChange={(value) => setTrigger(String(value))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{['subscribe', 'unsubscribe', 'campaign_started', 'campaign_sent', 'automation_sent'].map((value) => <SelectItem key={value} value={value}>{value.replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select></Field><Field label="Action"><Select value={action} onValueChange={(value) => setAction(String(value))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{['webhook', 'email', 'unsubscribe'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field></div><Field label={action === 'webhook' ? 'Endpoint URL' : action === 'email' ? 'Notification address' : 'Audience ID'}><Input value={destination} onChange={(event) => setDestination(event.target.value)} /></Field></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void onCreate({ name, trigger_type: trigger, action_type: action, scope: {}, action_config: action === 'webhook' ? { url: destination, method: 'POST' } : action === 'email' ? { to: destination } : { list_id: destination } })}><Braces />Create rule</Button></DialogFooter></DialogContent></Dialog>
}

function SimpleRegistry({ title, description, actionLabel, onAction, rows, onDelete }: { title: string; description: string; actionLabel: string; onAction: () => void; rows: Array<{ id: string; primary: string; secondary: string; date: string }>; onDelete: (id: string) => Promise<void> }) {
  return <Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div><Button size="sm" onClick={onAction}><Plus />{actionLabel}</Button></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Entry</TableHead><TableHead>Reason</TableHead><TableHead>Added</TableHead><TableHead className="w-16" /></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.primary}</TableCell><TableCell className="text-muted-foreground">{row.secondary}</TableCell><TableCell>{shortDate(row.date)}</TableCell><TableCell><Button variant="ghost" size="icon-sm" onClick={() => void onDelete(row.id)}><Trash2 /></Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
}

function LineDialog({ open, onOpenChange, title, placeholder, onSave }: { open: boolean; onOpenChange: (value: boolean) => void; title: string; placeholder: string; onSave: (values: string[]) => Promise<void> }) {
  const [lines, setLines] = useState(placeholder)
  const values = lines.split(/[\n,]/).map((line) => line.trim()).filter(Boolean)
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Enter one value per line. Existing entries are left unchanged.</DialogDescription></DialogHeader><Textarea rows={8} value={lines} onChange={(event) => setLines(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!values.length} onClick={() => void onSave(values)}><Plus />Add {values.length || ''}</Button></DialogFooter></DialogContent></Dialog>
}

function Housekeeping({ brandId, onComplete }: { brandId: string; onComplete: () => Promise<unknown> }) {
  const [action, setAction] = useState('unconfirmed_14d')
  const [result, setResult] = useState<number | null>(null)
  return <div className="grid gap-5 lg:grid-cols-[1fr_22rem]"><Card><CardHeader><CardTitle>Audience housekeeping</CardTitle><CardDescription>Remove stale consent records or inactive subscribers across this brand.</CardDescription></CardHeader><CardContent className="space-y-4"><Field label="Cleanup policy"><Select value={action} onValueChange={(value) => setAction(String(value))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unconfirmed_7d">Unconfirmed for 7 days</SelectItem><SelectItem value="unconfirmed_14d">Unconfirmed for 14 days</SelectItem><SelectItem value="inactive">Inactive before a date</SelectItem><SelectItem value="never_engaged">Never opened or clicked</SelectItem></SelectContent></Select></Field><div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Permanent operation.</strong> Affected subscriber records and their list membership are removed.</div><Button variant="destructive" onClick={async () => { const response = await post<{ removed: number }>(`/api/brands/${brandId}/housekeeping`, { action }); setResult(response.removed); await onComplete(); toast.success(`${response.removed} records removed`) }}><Trash2 />Run housekeeping</Button></CardContent></Card><Card><CardHeader><CardTitle>Latest result</CardTitle></CardHeader><CardContent><p className="metric-number text-5xl">{result ?? '—'}</p><p className="mt-2 text-sm text-muted-foreground">records removed in this browser session</p><Globe2 className="mt-8 size-8 text-muted-foreground/40" /></CardContent></Card></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><Label className="mb-1.5">{label}</Label>{children}</div> }

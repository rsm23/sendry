import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Download, File, Folder, LockKeyhole, ShieldCheck } from 'lucide-react'
import { FileViewer } from '@/components/file-viewer'
import { formatBytes } from '@/components/files/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/i18n/context'

type SharedItem = { id: string; root_id: string; parent_id: string | null; kind: 'file' | 'folder'; name: string; mime_type: string | null; size: number; expires_at: string | null; password_required: boolean; unlocked: boolean; allow_download: boolean; children: Array<{ id: string; parent_id: string; kind: 'file' | 'folder'; name: string; mime_type: string | null; size: number }>; preview_kind: string; preview_reason: string | null }

export default function SharedFilePage() {
  const { t } = useI18n()
  const { token = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [item, setItem] = useState<SharedItem | null>(null)
  const [password, setPassword] = useState('')
  const [submittedPassword, setSubmittedPassword] = useState('')
  const [error, setError] = useState('')
  const fileId = params.get('fileId')
  useEffect(() => {
    setError('')
    void fetch(`/api/share/files/${token}${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''}`, { headers: submittedPassword ? { 'x-share-password': submittedPassword } : undefined }).then(async (response) => { const value = await response.json() as SharedItem & { error?: string }; if (!response.ok) throw new Error(value.error ?? t('Shared item could not be loaded.')); setItem(value) }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('Shared item could not be loaded.')))
  }, [fileId, submittedPassword, t, token])
  const contentUrl = `/api/share/files/${token}/content${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''}`
  if (error) return <PublicFrame><Alert variant="destructive"><ShieldCheck /><AlertTitle>{t('Link unavailable')}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></PublicFrame>
  if (!item) return <PublicFrame><div className="h-64 animate-pulse rounded-xl bg-muted" /></PublicFrame>
  if (item.password_required && !item.unlocked) return <PublicFrame><Card className="mx-auto max-w-md"><CardHeader><span className="mb-2 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><LockKeyhole /></span><CardTitle>{t('Password required')}</CardTitle><CardDescription>{t('This secure share is password protected. Ask the sender if you do not have the password.')}</CardDescription></CardHeader><CardContent><Label htmlFor="share-password-entry">{t('Password')}</Label><Input id="share-password-entry" type="password" className="mt-1.5" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && password && setSubmittedPassword(password)} autoFocus /><Button className="mt-3 w-full" disabled={!password} onClick={() => setSubmittedPassword(password)}>{t('Open secure share')}</Button></CardContent></Card></PublicFrame>
  return <div className="flex min-h-svh flex-col bg-background"><header className="flex h-14 items-center gap-3 border-b px-4"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="size-4" /></span><strong>{t('Secure file share')}</strong><span className="ms-auto text-xs text-muted-foreground">{item.expires_at ? t('Expires {date}', { date: new Intl.DateTimeFormat().format(new Date(item.expires_at)) }) : t('No expiry')}</span>{item.allow_download && item.kind === 'file' ? <Button size="sm" variant="outline" onClick={async () => { const response = await fetch(`${contentUrl}${contentUrl.includes('?') ? '&' : '?'}download=1`, { headers: submittedPassword ? { 'x-share-password': submittedPassword } : undefined }); if (!response.ok) return; const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = item.name; link.click(); URL.revokeObjectURL(url) }}><Download />{t('Download')}</Button> : null}</header><main className="min-h-0 flex-1">{item.kind === 'file' ? <FileViewer kind={item.preview_kind} reason={item.preview_reason} source={{ url: contentUrl, name: item.name, mimeType: item.mime_type ?? '', password: submittedPassword, allowDownload: item.allow_download }} /> : <div className="mx-auto max-w-5xl p-5"><div className="mb-5"><h1 className="text-2xl font-semibold" translate="no">{item.name}</h1><p className="mt-1 text-sm text-muted-foreground">{t('Shared folder · view-only access')}</p></div>{item.id !== item.root_id ? <Button className="mb-3" variant="ghost" onClick={() => { const next = new URLSearchParams(params); if (item.parent_id === item.root_id) next.delete('fileId'); else if (item.parent_id) next.set('fileId', item.parent_id); setParams(next) }}>{t('Back to parent')}</Button> : null}<div className="overflow-hidden rounded-xl border">{item.children.map((child) => <Button key={child.id} variant="ghost" className="flex h-auto w-full justify-start rounded-none border-b p-3 last:border-b-0" onClick={() => { const next = new URLSearchParams(params); next.set('fileId', child.id); setParams(next) }}><span className="grid size-9 place-items-center rounded-lg bg-muted">{child.kind === 'folder' ? <Folder className="text-amber-600" /> : <File className="text-primary" />}</span><span className="min-w-0 flex-1 text-start"><strong className="block truncate text-sm" translate="no">{child.name}</strong><span className="text-xs text-muted-foreground">{child.kind === 'folder' ? t('Folder') : formatBytes(child.size)}</span></span></Button>)}</div></div>}</main><footer className="border-t px-4 py-3 text-center text-xs text-muted-foreground">{t('Anonymous visitors cannot comment or browse other brand files. Content is served with secure response headers.')}</footer></div>
}

function PublicFrame({ children }: { children: React.ReactNode }) { return <div className="grid min-h-svh place-items-center bg-muted/30 p-5"><div className="w-full max-w-2xl">{children}</div></div> }

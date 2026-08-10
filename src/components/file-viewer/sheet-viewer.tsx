import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Download, MessageSquarePlus, Search } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n/context'
import type { ViewerAdapter, ViewerComponentProps } from './types'

type Sheet = { name: string; rows: Array<Array<string | number | boolean | null>>; merges: string[] }

export default function SheetViewer({ source, onAnchor }: ViewerComponentProps) {
  const { t } = useI18n()
  const scroll = useRef<HTMLDivElement>(null)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [active, setActive] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const sheet = sheets.find((item) => item.name === active) ?? sheets[0]
  const matches = useMemo(() => {
    if (!sheet || !query.trim()) return []
    const found: Array<{ row: number; column: number }> = []
    sheet.rows.forEach((row, rowIndex) => row.forEach((cell, column) => { if (String(cell).toLocaleLowerCase().includes(query.toLocaleLowerCase())) found.push({ row: rowIndex, column }) }))
    return found.slice(0, 500)
  }, [query, sheet])
  const virtualizer = useVirtualizer({ count: sheet?.rows.length ?? 0, getScrollElement: () => scroll.current, estimateSize: () => 34, overscan: 12 })

  useEffect(() => {
    const worker = new Worker(new URL('./sheet.worker.ts', import.meta.url), { type: 'module' })
    const timeout = window.setTimeout(() => { worker.terminate(); setError(t('Workbook parsing exceeded the 15 second safety limit.')) }, 15_000)
    worker.onmessage = (event: MessageEvent<{ sheets?: Sheet[]; error?: string }>) => {
      window.clearTimeout(timeout)
      if (event.data.error) setError(event.data.error)
      else { setSheets(event.data.sheets ?? []); setActive(event.data.sheets?.[0]?.name ?? '') }
    }
    void fetch(source.url, { credentials: 'include', headers: source.password ? { 'x-share-password': source.password } : undefined }).then(async (response) => {
      if (!response.ok) throw new Error(t('The workbook could not be loaded.'))
      worker.postMessage(await response.arrayBuffer())
    }).catch((reason: unknown) => { window.clearTimeout(timeout); setError(reason instanceof Error ? reason.message : t('The workbook could not be loaded.')) })
    return () => { window.clearTimeout(timeout); worker.terminate() }
  }, [source.password, source.url, t])

  useEffect(() => { if (matches[0]) virtualizer.scrollToIndex(matches[0].row, { align: 'center' }) }, [matches, virtualizer])
  const columns = Math.min(sheet?.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0) ?? 0, 200)
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex flex-wrap items-center gap-1.5 border-b p-2"><div className="flex min-w-56 flex-1 items-center gap-1.5"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search workbook')} aria-label={t('Search workbook')} /><Button size="icon-sm" variant="ghost" aria-label={t('Search')}><Search /></Button>{query ? <span className="text-xs text-muted-foreground">{t('{count} matches', { count: matches.length })}</span> : null}</div>{onAnchor && sheet ? <Button size="sm" variant="outline" onClick={() => onAnchor({ kind: 'sheet', sheet: sheet.name, range: matches[0] ? address(matches[0].row, matches[0].column) : 'A1' })}><MessageSquarePlus />{t('Comment on cell')}</Button> : null}{source.allowDownload !== false ? <Button nativeButton={false} size="icon-sm" variant="ghost" render={<a href={`${source.url}${source.url.includes('?') ? '&' : '?'}download=1`} download />} aria-label={t('Download')}><Download /></Button> : null}</div>
    <Alert className="m-3 mb-0"><AlertDescription>{t('Workbook data and cached formula results are read-only. Styling and advanced Excel features are best-effort.')}</AlertDescription></Alert>
    {error ? <div className="grid flex-1 place-items-center p-6 text-sm text-destructive">{error}</div> : <div ref={scroll} className="min-h-0 flex-1 overflow-auto" role="grid" aria-label={source.name}><div className="sticky top-0 z-20 flex min-w-max border-b bg-muted text-xs font-medium"><div className="sticky start-0 z-30 w-14 shrink-0 border-e bg-muted p-2" />{Array.from({ length: columns }, (_, column) => <div key={column} className="w-40 shrink-0 border-e p-2">{columnName(column)}</div>)}</div><div className="relative min-w-max" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtualRow) => <div key={virtualRow.key} className="absolute start-0 top-0 flex h-[34px]" style={{ transform: `translateY(${virtualRow.start}px)` }} role="row"><div className="sticky start-0 z-10 w-14 shrink-0 border-e border-b bg-muted/90 p-2 text-end text-xs tabular-nums">{virtualRow.index + 1}</div>{Array.from({ length: columns }, (_, column) => { const value = sheet?.rows[virtualRow.index]?.[column] ?? ''; const hit = query && String(value).toLocaleLowerCase().includes(query.toLocaleLowerCase()); return <Button variant="ghost" key={column} className={`h-[34px] w-40 shrink-0 justify-start truncate rounded-none border-e border-b px-2 text-start text-sm font-normal ${hit ? 'bg-amber-200/60 dark:bg-amber-900/50' : 'bg-background hover:bg-muted/50'}`} title={String(value)} onClick={() => onAnchor?.({ kind: 'sheet', sheet: sheet.name, range: address(virtualRow.index, column) })} translate="no">{String(value)}</Button> })}</div>)}</div></div>}
    {sheets.length ? <Tabs value={active} onValueChange={setActive} className="border-t px-2"><TabsList variant="line" className="max-w-full justify-start overflow-x-auto">{sheets.map((item) => <TabsTrigger key={item.name} value={item.name} translate="no">{item.name}</TabsTrigger>)}</TabsList></Tabs> : null}
  </div>
}

function columnName(index: number) { let value = ''; for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) value = String.fromCharCode(65 + ((number - 1) % 26)) + value; return value }
function address(row: number, column: number) { return `${columnName(column)}${row + 1}` }

export const adapter: ViewerAdapter = { kind: 'sheet', capabilities: { search: true, navigation: true, zoom: false, contextualComments: true }, load: () => import('./sheet-viewer'), render: SheetViewer }

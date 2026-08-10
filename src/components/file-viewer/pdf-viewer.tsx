import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, PasswordResponses, TextLayer, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'
import { ChevronDown, ChevronUp, Download, Scan, MessageSquarePlus, Printer, RotateCw, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import type { ViewerAdapter, ViewerComponentProps } from './types'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export default function PDFViewer({ source, onAnchor }: ViewerComponentProps) {
  const { t } = useI18n()
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.15)
  const [rotation, setRotation] = useState(0)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<number[]>([])
  const [error, setError] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [password, setPassword] = useState('')
  const passwordUpdate = useRef<((password: string) => void) | null>(null)

  useEffect(() => {
    const task = getDocument({ url: source.url, password: source.password, withCredentials: true })
    task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      passwordUpdate.current = updatePassword
      setPasswordOpen(true)
      if (reason === PasswordResponses.INCORRECT_PASSWORD) setError(t('The PDF password is incorrect.'))
    }
    task.promise.then(setDocument).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('The PDF could not be opened.')))
    return () => { void task.destroy() }
  }, [source.password, source.url, t])

  async function search() {
    if (!document || !query.trim()) { setMatches([]); return }
    const found: number[] = []
    for (let index = 1; index <= document.numPages; index += 1) {
      const target = await document.getPage(index)
      const content = await target.getTextContent()
      if (content.items.map((item) => 'str' in item ? item.str : '').join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())) found.push(index)
    }
    setMatches(found)
    if (found[0]) setPage(found[0])
  }

  if (error && !passwordOpen) return <div className="grid h-full place-items-center p-6 text-sm text-destructive">{error}</div>
  return <div className="flex h-full min-h-0 flex-col bg-muted/25">
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-background p-2">
      <div className="flex min-w-48 flex-1 items-center gap-1.5"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void search()} placeholder={t('Search in PDF')} aria-label={t('Search in PDF')} /><Button size="icon-sm" variant="ghost" onClick={() => void search()} aria-label={t('Search')}><Search /></Button>{matches.length ? <span className="text-xs text-muted-foreground">{t('{count} matches', { count: matches.length })}</span> : null}</div>
      <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label={t('Previous page')}><ChevronUp /></Button>
      <span className="min-w-20 text-center text-xs tabular-nums">{page} / {document?.numPages ?? '—'}</span>
      <Button size="icon-sm" variant="ghost" disabled={!document || page >= document.numPages} onClick={() => setPage((value) => value + 1)} aria-label={t('Next page')}><ChevronDown /></Button>
      <Button size="icon-sm" variant="ghost" onClick={() => setScale((value) => Math.max(.5, value - .15))} aria-label={t('Zoom out')}><ZoomOut /></Button>
      <Button size="icon-sm" variant="ghost" onClick={() => setScale(1.15)} aria-label={t('Fit page')}><Scan /></Button>
      <Button size="icon-sm" variant="ghost" onClick={() => setScale((value) => Math.min(3, value + .15))} aria-label={t('Zoom in')}><ZoomIn /></Button>
      <Button size="icon-sm" variant="ghost" onClick={() => setRotation((value) => (value + 90) % 360)} aria-label={t('Rotate')}><RotateCw /></Button>
      {onAnchor ? <Button size="icon-sm" variant="ghost" onClick={() => onAnchor({ kind: 'page', page, rect: [0, 0, 1, 1] })} aria-label={t('Comment on this page')}><MessageSquarePlus /></Button> : null}
      {source.allowDownload !== false ? <Button size="icon-sm" variant="ghost" onClick={() => window.open(source.url, '_blank', 'noopener,noreferrer')} aria-label={t('Print')}><Printer /></Button> : null}
      {source.allowDownload !== false ? <Button size="icon-sm" variant="ghost" render={<a href={`${source.url}${source.url.includes('?') ? '&' : '?'}download=1`} download />} aria-label={t('Download')}><Download /></Button> : null}
    </div>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {document ? <aside className="hidden w-36 shrink-0 overflow-y-auto border-e bg-background p-2 md:block">{Array.from({ length: document.numPages }, (_, index) => <PDFThumbnail key={index + 1} document={document} page={index + 1} selected={page === index + 1} onSelect={setPage} />)}</aside> : null}
      <div className="min-w-0 flex-1 overflow-auto p-4"><div className="mx-auto w-fit shadow-xl"><PDFCanvas document={document} page={page} scale={scale} rotation={rotation} /></div></div>
    </div>
    <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}><DialogContent><DialogHeader><DialogTitle>{t('Password-protected PDF')}</DialogTitle><DialogDescription>{t('Enter the document password to preview it. The password is not stored.')}</DialogDescription></DialogHeader><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && password) { passwordUpdate.current?.(password); setPasswordOpen(false); setError('') } }} autoFocus /><DialogFooter><Button disabled={!password} onClick={() => { passwordUpdate.current?.(password); setPasswordOpen(false); setError('') }}>{t('Open PDF')}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function PDFCanvas({ document, page, scale, rotation }: { document: PDFDocumentProxy | null; page: number; scale: number; rotation: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const textLayer = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    let rendered: { cancel: () => void; promise: Promise<unknown> } | undefined
    let layer: TextLayer | undefined
    void document?.getPage(page).then(async (pdfPage) => {
      if (cancelled || !canvas.current || !textLayer.current) return
      const view = pdfPage.getViewport({ scale, rotation })
      const context = canvas.current.getContext('2d')
      if (!context) return
      const ratio = window.devicePixelRatio || 1
      canvas.current.width = Math.floor(view.width * ratio)
      canvas.current.height = Math.floor(view.height * ratio)
      canvas.current.style.width = `${view.width}px`
      canvas.current.style.height = `${view.height}px`
      setViewport({ width: view.width, height: view.height })
      rendered = pdfPage.render({ canvas: canvas.current, canvasContext: context, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      await rendered.promise
      if (cancelled || !textLayer.current) return
      textLayer.current.replaceChildren()
      layer = new TextLayer({ textContentSource: await pdfPage.getTextContent(), container: textLayer.current, viewport: view })
      await layer.render()
    })
    return () => { cancelled = true; rendered?.cancel(); layer?.cancel() }
  }, [document, page, rotation, scale])
  if (!document) return <div className="h-[70vh] w-[min(70vw,800px)] animate-pulse bg-muted" />
  return <div className="relative bg-white" style={viewport ?? undefined}><canvas ref={canvas} /><div ref={textLayer} className="textLayer" /></div>
}

function PDFThumbnail({ document, page, selected, onSelect }: { document: PDFDocumentProxy; page: number; selected: boolean; onSelect: (page: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let render: { cancel: () => void } | undefined
    void document.getPage(page).then((pdfPage: PDFPageProxy) => {
      if (!canvas.current) return
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: 108 / base.width })
      const context = canvas.current.getContext('2d')
      if (!context) return
      canvas.current.width = viewport.width
      canvas.current.height = viewport.height
      render = pdfPage.render({ canvas: canvas.current, canvasContext: context, viewport })
    })
    return () => render?.cancel()
  }, [document, page])
  return <Button variant="ghost" onClick={() => onSelect(page)} className={`mb-2 h-auto w-full flex-col rounded-md border p-1 text-center text-xs ${selected ? 'border-primary bg-primary/5' : 'bg-card'}`} aria-label={`Page ${page}`}><canvas ref={canvas} className="mx-auto max-w-full bg-white" /><span>{page}</span></Button>
}

export const adapter: ViewerAdapter = { kind: 'pdf', capabilities: { search: true, navigation: true, zoom: true, rotate: true, print: true, contextualComments: true }, load: () => import('./pdf-viewer'), render: PDFViewer }

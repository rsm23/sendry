import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { ChevronLeft, ChevronRight, Download, Maximize2, MessageSquarePlus, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import type { ViewerAdapter, ViewerComponentProps } from './types'

type Slide = { index: number; svg: string; width: number; height: number; text: string }

function sanitizeSlide(svg: string) {
  const cleaned = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'], FORBID_ATTR: ['onload', 'onclick', 'onerror'] })
  const document = new DOMParser().parseFromString(cleaned, 'image/svg+xml')
  document.querySelectorAll('[href],[xlink\\:href]').forEach((element) => {
    for (const attribute of ['href', 'xlink:href']) {
      const value = element.getAttribute(attribute)
      if (value && !/^(data:|#)/i.test(value)) element.removeAttribute(attribute)
    }
  })
  return new XMLSerializer().serializeToString(document.documentElement)
}

export default function PPTXViewer({ source, onAnchor }: ViewerComponentProps) {
  const { t } = useI18n()
  const stage = useRef<HTMLDivElement>(null)
  const [slides, setSlides] = useState<Slide[]>([])
  const [current, setCurrent] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const matches = useMemo(() => query ? slides.filter((slide) => slide.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((slide) => slide.index) : [], [query, slides])
  const slide = slides[current - 1]
  useEffect(() => {
    const worker = new Worker(new URL('./pptx.worker.ts', import.meta.url), { type: 'module' })
    const timeout = window.setTimeout(() => { worker.terminate(); setError(t('Presentation parsing exceeded the 15 second safety limit.')) }, 15_000)
    worker.onmessage = (event: MessageEvent<{ slides?: Slide[]; error?: string }>) => { window.clearTimeout(timeout); if (event.data.error) setError(event.data.error); else setSlides((event.data.slides ?? []).map((item) => ({ ...item, svg: sanitizeSlide(item.svg) }))) }
    void fetch(source.url, { credentials: 'include', headers: source.password ? { 'x-share-password': source.password } : undefined }).then(async (response) => { if (!response.ok) throw new Error(t('The presentation could not be loaded.')); worker.postMessage(await response.arrayBuffer()) }).catch((reason: unknown) => { window.clearTimeout(timeout); setError(reason instanceof Error ? reason.message : t('The presentation could not be loaded.')) })
    return () => { window.clearTimeout(timeout); worker.terminate() }
  }, [source.password, source.url, t])
  useEffect(() => { if (matches[0]) setCurrent(matches[0]) }, [matches])
  return <div className="flex h-full min-h-0 flex-col bg-muted/30">
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-background p-2"><div className="flex min-w-52 flex-1 items-center gap-1.5"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search slides')} aria-label={t('Search slides')} /><Button size="icon-sm" variant="ghost" aria-label={t('Search')}><Search /></Button>{query ? <span className="text-xs text-muted-foreground">{t('{count} matches', { count: matches.length })}</span> : null}</div><Button size="icon-sm" variant="ghost" disabled={current <= 1} onClick={() => setCurrent((value) => value - 1)} aria-label={t('Previous slide')}><ChevronLeft /></Button><span className="min-w-20 text-center text-xs tabular-nums">{current} / {slides.length || '—'}</span><Button size="icon-sm" variant="ghost" disabled={current >= slides.length} onClick={() => setCurrent((value) => value + 1)} aria-label={t('Next slide')}><ChevronRight /></Button><Button size="icon-sm" variant="ghost" onClick={() => setZoom((value) => Math.max(.5, value - .1))} aria-label={t('Zoom out')}><ZoomOut /></Button><Button size="icon-sm" variant="ghost" onClick={() => setZoom((value) => Math.min(2.5, value + .1))} aria-label={t('Zoom in')}><ZoomIn /></Button><Button size="icon-sm" variant="ghost" onClick={() => void stage.current?.requestFullscreen()} aria-label={t('Presentation mode')}><Maximize2 /></Button>{onAnchor ? <Button size="icon-sm" variant="ghost" onClick={() => onAnchor({ kind: 'slide', slide: current, rect: [0, 0, 1, 1] })} aria-label={t('Comment on this slide')}><MessageSquarePlus /></Button> : null}{source.allowDownload !== false ? <Button size="icon-sm" variant="ghost" render={<a href={`${source.url}${source.url.includes('?') ? '&' : '?'}download=1`} download />} aria-label={t('Download')}><Download /></Button> : null}</div>
    {error ? <div className="grid flex-1 place-items-center p-6 text-sm text-destructive">{error}</div> : <div className="flex min-h-0 flex-1"><aside className="hidden w-40 shrink-0 overflow-y-auto border-e bg-background p-2 md:block">{slides.map((item) => <Button variant="ghost" key={item.index} onClick={() => setCurrent(item.index)} className={`mb-2 h-auto w-full flex-col rounded-md border p-1 ${current === item.index ? 'border-primary bg-primary/5' : 'bg-card'}`}><div dangerouslySetInnerHTML={{ __html: item.svg }} /><span className="text-xs">{item.index}</span></Button>)}</aside><div ref={stage} className="grid min-w-0 flex-1 place-items-center overflow-auto bg-neutral-950 p-5"><div className="origin-center bg-white shadow-2xl" style={{ transform: `scale(${zoom})`, width: slide?.width, height: slide?.height }} dangerouslySetInnerHTML={slide ? { __html: slide.svg } : undefined} /></div></div>}
  </div>
}

export const adapter: ViewerAdapter = { kind: 'pptx', capabilities: { search: true, navigation: true, zoom: true, contextualComments: true }, load: () => import('./pptx-viewer'), render: PPTXViewer }

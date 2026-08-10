import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import DOMPurify from 'dompurify'
import { Download, MessageSquarePlus, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import type { ViewerAdapter, ViewerComponentProps } from './types'

export default function DOCXViewer({ source, onAnchor }: ViewerComponentProps) {
  const { t } = useI18n()
  const container = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void fetch(source.url, { credentials: 'include', headers: source.password ? { 'x-share-password': source.password } : undefined }).then(async (response) => {
      if (!response.ok) throw new Error(t('The document could not be loaded.'))
      if (!container.current || cancelled) return
      await renderAsync(await response.arrayBuffer(), container.current, undefined, { breakPages: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, useBase64URL: true, ignoreWidth: false, ignoreHeight: false })
      if (!container.current || cancelled) return
      container.current.innerHTML = DOMPurify.sanitize(container.current.innerHTML, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'], FORBID_ATTR: ['onerror', 'onload', 'onclick'] })
      for (const element of container.current.querySelectorAll<HTMLElement>('[src],[href],[xlink\\:href]')) {
        for (const attribute of ['src', 'href', 'xlink:href']) {
          const value = element.getAttribute(attribute)
          if (value && !/^(data:|blob:|#)/i.test(value)) element.removeAttribute(attribute)
        }
      }
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('The document could not be loaded.')))
    return () => { cancelled = true }
  }, [source.password, source.url, t])

  function search() {
    if (!container.current || !query.trim()) return
    container.current.querySelectorAll('mark[data-viewer-search]').forEach((mark) => mark.replaceWith(mark.textContent ?? ''))
    const walker = document.createTreeWalker(container.current, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const index = node.data.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
      if (index < 0 || !node.parentElement) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + query.length)
      const mark = document.createElement('mark')
      mark.dataset.viewerSearch = 'true'
      range.surroundContents(mark)
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
      break
    }
  }

  return <div className="flex h-full min-h-0 flex-col bg-muted/25">
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-background p-2"><div className="flex min-w-56 flex-1 items-center gap-1.5"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder={t('Search in document')} aria-label={t('Search in document')} /><Button size="icon-sm" variant="ghost" onClick={search} aria-label={t('Search')}><Search /></Button></div><Button size="icon-sm" variant="ghost" onClick={() => setZoom((value) => Math.max(.6, value - .1))} aria-label={t('Zoom out')}><ZoomOut /></Button><span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="ghost" onClick={() => setZoom((value) => Math.min(2, value + .1))} aria-label={t('Zoom in')}><ZoomIn /></Button>{onAnchor ? <Button size="icon-sm" variant="ghost" onClick={() => { const selection = window.getSelection()?.toString().trim(); onAnchor({ kind: 'docx', paragraph: 0, quote: selection || source.name }) }} aria-label={t('Comment on selected text')}><MessageSquarePlus /></Button> : null}{source.allowDownload !== false ? <Button nativeButton={false} size="icon-sm" variant="ghost" render={<a href={`${source.url}${source.url.includes('?') ? '&' : '?'}download=1`} download />} aria-label={t('Download')}><Download /></Button> : null}</div>
    <Alert className="m-3 mb-0"><AlertDescription>{t('Browser preview is best-effort. Pagination and advanced Word layout may differ from the original document.')}</AlertDescription></Alert>
    {error ? <div className="grid flex-1 place-items-center p-6 text-sm text-destructive">{error}</div> : <div className="min-h-0 flex-1 overflow-auto p-4"><div className="mx-auto origin-top" style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }}><div ref={container} className="docx-viewer isolate" /></div></div>}
  </div>
}

export const adapter: ViewerAdapter = { kind: 'docx', capabilities: { search: true, navigation: true, zoom: true, contextualComments: true }, load: () => import('./docx-viewer'), render: DOCXViewer }

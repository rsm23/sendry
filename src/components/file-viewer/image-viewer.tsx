import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Download, Scan, MessageSquarePlus, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import type { ViewerAdapter, ViewerComponentProps } from './types'

export default function ImageViewer({ source, onAnchor }: ViewerComponentProps) {
  const { t } = useI18n()
  const [url, setUrl] = useState('')
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let objectUrl = ''
    void fetch(source.url, { credentials: 'include', headers: source.password ? { 'x-share-password': source.password } : undefined }).then(async (response) => {
      if (!response.ok) throw new Error(t('The image could not be loaded.'))
      const blob = await response.blob()
      if (blob.type === 'image/svg+xml' || source.name.toLowerCase().endsWith('.svg')) {
        const safe = DOMPurify.sanitize(await blob.text(), { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject', 'iframe'], FORBID_ATTR: ['onload', 'onclick', 'onerror'] })
        const document = new DOMParser().parseFromString(safe, 'image/svg+xml')
        document.querySelectorAll('[href],[xlink\\:href]').forEach((element) => { const value = element.getAttribute('href') ?? element.getAttribute('xlink:href'); if (value && !/^(data:|#)/i.test(value)) { element.removeAttribute('href'); element.removeAttribute('xlink:href') } })
        objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(document.documentElement)], { type: 'image/svg+xml' }))
      } else objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('The image could not be loaded.')))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [source.name, source.password, source.url, t])
  return <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-size-[18px_18px]">
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-background p-2"><Button size="icon-sm" variant="ghost" onClick={() => setZoom((value) => Math.max(.1, value - .15))} aria-label={t('Zoom out')}><ZoomOut /></Button><span className="w-14 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="ghost" onClick={() => setZoom((value) => Math.min(8, value + .15))} aria-label={t('Zoom in')}><ZoomIn /></Button><Button size="icon-sm" variant="ghost" onClick={() => { setZoom(1); setPosition({ x: 0, y: 0 }) }} aria-label={t('Fit image')}><Scan /></Button><Button size="icon-sm" variant="ghost" onClick={() => setRotation((value) => (value + 90) % 360)} aria-label={t('Rotate')}><RotateCw /></Button>{dimensions.width ? <span className="ms-auto text-xs text-muted-foreground" translate="no">{dimensions.width} × {dimensions.height}px</span> : <span className="ms-auto" />}{onAnchor ? <Button size="sm" variant="outline" onClick={() => onAnchor({ kind: 'image', rect: [0, 0, 1, 1] })}><MessageSquarePlus />{t('Comment on image')}</Button> : null}{source.allowDownload !== false ? <Button nativeButton={false} size="icon-sm" variant="ghost" render={<a href={`${source.url}${source.url.includes('?') ? '&' : '?'}download=1`} download />} aria-label={t('Download')}><Download /></Button> : null}</div>
    {error ? <div className="grid flex-1 place-items-center p-6 text-sm text-destructive">{error}</div> : <div className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing" onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, startX: position.x, startY: position.y }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { if (drag.current) setPosition({ x: drag.current.startX + event.clientX - drag.current.x, y: drag.current.startY + event.clientY - drag.current.y }) }} onPointerUp={() => { drag.current = null }}><div className="absolute inset-0 grid place-items-center"><img src={url} alt={source.name} onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} draggable={false} className="max-h-[88%] max-w-[88%] select-none object-contain shadow-2xl" style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)` }} /></div></div>}
  </div>
}

export const adapter: ViewerAdapter = { kind: 'image', capabilities: { search: false, navigation: false, zoom: true, rotate: true, contextualComments: true }, load: () => import('./image-viewer'), render: ImageViewer }

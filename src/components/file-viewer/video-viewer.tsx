import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import type { ViewerAdapter, ViewerComponentProps } from './types'

export default function VideoViewer({ source }: ViewerComponentProps) {
  const { t } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const [url, setUrl] = useState(source.password ? '' : source.url)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl = ''
    let cancelled = false
    setError('')
    if (!source.password) {
      setUrl(source.url)
      return () => undefined
    }
    setUrl('')
    void fetch(source.url, { credentials: 'include', headers: { 'x-share-password': source.password } }).then(async (response) => {
      if (!response.ok) throw new Error(t('The video could not be loaded.'))
      objectUrl = URL.createObjectURL(await response.blob())
      if (!cancelled) setUrl(objectUrl)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : t('The video could not be loaded.'))
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source.password, source.url, t])

  useEffect(() => {
    setReady(false)
    const element = video.current
    if (!element || !url) return
    const markReady = () => setReady(true)
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) markReady()
    element.addEventListener('loadedmetadata', markReady)
    element.addEventListener('canplay', markReady)
    return () => {
      element.removeEventListener('loadedmetadata', markReady)
      element.removeEventListener('canplay', markReady)
    }
  }, [url])

  if (error) return <div className="grid h-full place-items-center bg-neutral-950 p-6"><Alert className="max-w-xl bg-card"><AlertTriangle /><AlertTitle>{t('Video preview unavailable')}</AlertTitle><AlertDescription className="space-y-4"><p>{error}</p>{source.allowDownload !== false ? <Button nativeButton={false} render={<a href={`${source.url}${source.url.includes('?') ? '&' : '?'}download=1`} download />}><Download />{t('Download original')}</Button> : null}</AlertDescription></Alert></div>

  return <div className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-neutral-950 p-3" data-video-viewer>
    {!ready ? <div className="absolute inset-0 grid place-items-center text-sm text-neutral-300"><span><LoaderCircle className="me-2 inline size-5 animate-spin" />{t('Loading secure preview…')}</span></div> : null}
    {url ? <video ref={video} className="max-h-full max-w-full rounded-md bg-black shadow-2xl" src={url} controls playsInline preload="metadata" aria-label={t('Video preview')} onError={() => setError(t('This video uses a codec that this browser cannot play.'))} /> : null}
  </div>
}

export const adapter: ViewerAdapter = { kind: 'video', capabilities: { search: false, navigation: false, zoom: false, contextualComments: false }, load: () => import('./video-viewer'), render: VideoViewer }

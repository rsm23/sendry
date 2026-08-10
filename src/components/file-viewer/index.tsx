import { lazy, Suspense, useMemo } from 'react'
import { AlertTriangle, Download, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useI18n } from '@/i18n/context'
import type { ViewerComponentProps } from './types'

const PDFViewer = lazy(() => import('./pdf-viewer'))
const DOCXViewer = lazy(() => import('./docx-viewer'))
const SheetViewer = lazy(() => import('./sheet-viewer'))
const PPTXViewer = lazy(() => import('./pptx-viewer'))
const ImageViewer = lazy(() => import('./image-viewer'))
const VideoViewer = lazy(() => import('./video-viewer'))
const CodeViewer = lazy(() => import('./code-viewer'))

export function FileViewer({ kind, reason, ...props }: ViewerComponentProps & { kind: string; reason?: string | null }) {
  const { t } = useI18n()
  const Component = useMemo(() => ({ pdf: PDFViewer, docx: DOCXViewer, sheet: SheetViewer, pptx: PPTXViewer, image: ImageViewer, video: VideoViewer, code: CodeViewer }[kind]), [kind])
  if (!Component) return <div className="grid h-full place-items-center p-6"><Alert className="max-w-xl"><AlertTriangle /><AlertTitle>{t('Preview unavailable')}</AlertTitle><AlertDescription className="space-y-4"><p>{reason || t('This file type does not have a safe browser preview.')}</p>{props.source.allowDownload !== false ? <Button nativeButton={false} render={<a href={`${props.source.url}${props.source.url.includes('?') ? '&' : '?'}download=1`} download />}><Download />{t('Download original')}</Button> : null}</AlertDescription></Alert></div>
  return <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground"><LoaderCircle className="me-2 inline size-5 animate-spin" />{t('Loading secure preview…')}</div>}><Component {...props} /></Suspense>
}

export type { ViewerAdapter, ViewerAnchor, ViewerCapabilities, ViewerSource } from './types'

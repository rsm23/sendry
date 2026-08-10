import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { openSearchPanel, searchKeymap } from '@codemirror/search'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { Copy, Download, MessageSquarePlus, Search, WrapText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import type { ViewerAdapter, ViewerComponentProps } from './types'

function language(name: string) {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'json') return json()
  if (['html', 'htm', 'xml', 'svg'].includes(extension ?? '')) return html()
  if (extension === 'css') return css()
  if (['js', 'jsx', 'ts', 'tsx'].includes(extension ?? '')) return javascript({ typescript: extension === 'ts' || extension === 'tsx', jsx: extension === 'jsx' || extension === 'tsx' })
  if (extension === 'py') return python()
  if (extension === 'sql') return sql()
  if (['md', 'markdown'].includes(extension ?? '')) return markdown()
  return []
}

export default function CodeViewer({ source, onAnchor }: ViewerComponentProps) {
  const { t } = useI18n()
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const [wrap, setWrap] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void fetch(source.url, { credentials: 'include', headers: source.password ? { 'x-share-password': source.password } : undefined }).then(async (response) => {
      if (!response.ok) throw new Error(t('The text file could not be loaded.'))
      const text = await response.text()
      if (cancelled || !root.current) return
      editor.current = new EditorView({ parent: root.current, state: EditorState.create({ doc: text, extensions: [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), keymap.of(searchKeymap), EditorState.readOnly.of(true), EditorView.editable.of(false), language(source.name), wrap ? EditorView.lineWrapping : []] }) })
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('The text file could not be loaded.')))
    return () => { cancelled = true; editor.current?.destroy(); editor.current = null }
  }, [source.name, source.password, source.url, t, wrap])

  function selectedLines() {
    const view = editor.current
    if (!view) return { from: 1, to: 1 }
    return { from: view.state.doc.lineAt(view.state.selection.main.from).number, to: view.state.doc.lineAt(view.state.selection.main.to).number }
  }
  return <div className="flex h-full min-h-0 flex-col bg-background"><div className="flex items-center gap-1.5 border-b p-2"><Button size="sm" variant="outline" onClick={() => editor.current && openSearchPanel(editor.current)}><Search />{t('Search')}</Button><Button size="sm" variant={wrap ? 'secondary' : 'outline'} onClick={() => setWrap((value) => !value)}><WrapText />{t('Wrap lines')}</Button><Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(editor.current?.state.sliceDoc(editor.current.state.selection.main.from, editor.current.state.selection.main.to) || editor.current?.state.doc.toString() || '')}><Copy />{t('Copy')}</Button>{onAnchor ? <Button size="sm" variant="outline" onClick={() => { const lines = selectedLines(); onAnchor({ kind: 'code', from_line: lines.from, to_line: lines.to }) }}><MessageSquarePlus />{t('Comment on lines')}</Button> : null}{source.allowDownload !== false ? <Button nativeButton={false} className="ms-auto" size="icon-sm" variant="ghost" render={<a href={`${source.url}${source.url.includes('?') ? '&' : '?'}download=1`} download />} aria-label={t('Download')}><Download /></Button> : <span className="ms-auto" />}</div>{error ? <div className="grid flex-1 place-items-center p-6 text-sm text-destructive">{error}</div> : <div ref={root} className="min-h-0 flex-1 overflow-auto font-mono text-sm [&_.cm-editor]:min-h-full [&_.cm-editor]:bg-background [&_.cm-gutters]:bg-muted/40 [&_.cm-gutters]:text-muted-foreground [&_.cm-scroller]:min-h-full" translate="no" />}</div>
}

export const adapter: ViewerAdapter = { kind: 'code', capabilities: { search: true, navigation: true, zoom: false, contextualComments: true }, load: () => import('./code-viewer'), render: CodeViewer }

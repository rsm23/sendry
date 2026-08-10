import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArchiveRestore, ArrowDownAZ, ChevronDown, Clock3, Columns3, Copy, Download, File, FileArchive, FileCode2, FileImage, FileSpreadsheet, FileText, Filter, Folder, FolderInput, FolderPlus, Grid2X2, HardDriveUpload, Info, Link2, List, LoaderCircle, MessageSquare, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Share2, Star, Trash2, Upload, Video, X } from 'lucide-react'
import { toast } from 'sonner'
import { get, patch, post, remove } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { shortDate } from '@/lib/format'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { FileDetailsPanel } from '@/components/files/file-details-panel'
import { formatBytes, type FileItem } from '@/components/files/types'
import { FileViewer, type ViewerAnchor } from '@/components/file-viewer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type ViewMode = 'grid' | 'list' | 'compact'
type UploadState = { id: string; name: string; percent: number; status: 'uploading' | 'done' | 'error'; error?: string }
type Preference = { view_mode: ViewMode; sort_key: string; sort_direction: string; details_width: number }
const views = [{ id: 'all', icon: Folder, label: 'All files' }, { id: 'recent', icon: Clock3, label: 'Recent' }, { id: 'starred', icon: Star, label: 'Starred' }, { id: 'shared', icon: Share2, label: 'Shared' }, { id: 'trash', icon: Trash2, label: 'Trash' }] as const

function setFileDragImage(event: DragEvent<HTMLElement>, item: FileItem) {
  const width = 280
  const height = 64
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.style.position = 'fixed'
  canvas.style.insetInlineStart = '-10000px'
  canvas.style.insetBlockStart = '0'
  canvas.style.pointerEvents = 'none'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.dataset.fileDragImage = 'true'
  document.body.append(canvas)

  const context = canvas.getContext('2d')
  if (context) {
    const sourceStyle = window.getComputedStyle(event.currentTarget)
    const bodyStyle = window.getComputedStyle(document.body)
    const transparent = sourceStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
    const background = transparent ? bodyStyle.backgroundColor : sourceStyle.backgroundColor
    const foreground = sourceStyle.color || bodyStyle.color
    const iconElement = event.currentTarget.querySelector<SVGElement>('[data-file-drag-icon]')
    const iconColor = iconElement ? window.getComputedStyle(iconElement).color : foreground
    const rtl = document.documentElement.dir === 'rtl'
    const iconX = rtl ? width - 48 : 20
    const textX = rtl ? width - 62 : 62

    context.scale(scale, scale)
    context.shadowColor = 'rgba(0, 0, 0, 0.22)'
    context.shadowBlur = 12
    context.shadowOffsetY = 4
    context.fillStyle = background
    context.beginPath()
    context.roundRect(6, 6, width - 12, height - 12, 10)
    context.fill()
    context.shadowColor = 'transparent'
    context.strokeStyle = sourceStyle.borderColor || 'rgba(127, 127, 127, 0.35)'
    context.lineWidth = 1
    context.stroke()

    context.strokeStyle = iconColor
    context.lineWidth = 2.4
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.beginPath()
    if (item.kind === 'folder') {
      context.moveTo(iconX, 25)
      context.lineTo(iconX + 10, 25)
      context.lineTo(iconX + 14, 29)
      context.lineTo(iconX + 30, 29)
      context.quadraticCurveTo(iconX + 33, 29, iconX + 33, 32)
      context.lineTo(iconX + 33, 44)
      context.quadraticCurveTo(iconX + 33, 47, iconX + 30, 47)
      context.lineTo(iconX + 3, 47)
      context.quadraticCurveTo(iconX, 47, iconX, 44)
      context.closePath()
    } else {
      context.moveTo(iconX + 5, 20)
      context.lineTo(iconX + 23, 20)
      context.lineTo(iconX + 31, 28)
      context.lineTo(iconX + 31, 47)
      context.lineTo(iconX + 5, 47)
      context.closePath()
      context.moveTo(iconX + 23, 20)
      context.lineTo(iconX + 23, 28)
      context.lineTo(iconX + 31, 28)
    }
    context.stroke()

    context.direction = rtl ? 'rtl' : 'ltr'
    context.textAlign = rtl ? 'right' : 'left'
    context.textBaseline = 'middle'
    context.fillStyle = foreground
    context.font = `600 14px ${bodyStyle.fontFamily || 'sans-serif'}`
    const availableWidth = width - 84
    let label = item.name
    while (context.measureText(label).width > availableWidth && label.length > 1) label = `${label.slice(0, -2)}…`
    context.fillText(label, textX, height / 2)
  }

  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-sendry-file-id', item.id)
  event.dataTransfer.setData('text/plain', item.name)
  event.dataTransfer.setDragImage(canvas, document.documentElement.dir === 'rtl' ? width - 28 : 28, height / 2)
  window.setTimeout(() => canvas.remove(), 0)
}

export default function FilesPage() {
  const { t } = useI18n()
  const { brand } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { fileId: routeFileId } = useParams()
  const [params, setParams] = useSearchParams()
  const uploadInput = useRef<HTMLInputElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const lastSelected = useRef<number | null>(null)
  const pendingSelection = useRef<number | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [folderDialog, setFolderDialog] = useState(false)
  const [renameItem, setRenameItem] = useState<FileItem | null>(null)
  const [moveItems, setMoveItems] = useState<FileItem[]>([])
  const [trashItem, setTrashItem] = useState<FileItem | null>(null)
  const [deleteForeverItem, setDeleteForeverItem] = useState<FileItem | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [mobileDetails, setMobileDetails] = useState(false)
  const [detailsTab, setDetailsTab] = useState('details')
  const [uploads, setUploads] = useState<UploadState[]>([])
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [viewerDetails, setViewerDetails] = useState(true)
  const [pendingAnchor, setPendingAnchor] = useState<ViewerAnchor | null>(null)
  const view = params.get('view') ?? 'all'
  const parentId = params.get('parentId')
  const type = params.get('type') ?? ''
  const owner = params.get('owner') ?? ''
  const sort = params.get('sort') ?? 'name'
  const direction = params.get('direction') ?? 'asc'
  const queryString = useMemo(() => { const value = new URLSearchParams(); if (view !== 'all') value.set('view', view); if (parentId) value.set('parentId', parentId); if (params.get('q')) value.set('q', params.get('q')!); if (type) value.set('type', type); if (owner) value.set('owner', owner); value.set('sort', sort); value.set('direction', direction); return value.toString() }, [direction, owner, params, parentId, sort, type, view])
  const files = useQuery({ queryKey: ['files', brand?.id, queryString], queryFn: () => get<FileItem[]>(`/api/brands/${brand?.id}/files?${queryString}`), enabled: !!brand })
  const preferences = useQuery({ queryKey: ['file-preferences', brand?.id], queryFn: () => get<Preference>(`/api/brands/${brand?.id}/files/preferences`), enabled: !!brand })
  const selectedId = [...selection][0]
  const selectedFromList = files.data?.find((item) => item.id === selectedId)
  const selectedDetails = useQuery({ queryKey: ['file-details', brand?.id, selectedId], queryFn: () => get<FileItem>(`/api/brands/${brand?.id}/files/${selectedId}`), enabled: !!brand && !!selectedId && !selectedFromList })
  const selected = selectedFromList ?? selectedDetails.data
  const viewer = useQuery({ queryKey: ['file-viewer-details', brand?.id, routeFileId], queryFn: () => get<FileItem>(`/api/brands/${brand?.id}/files/${routeFileId}`), enabled: !!brand && !!routeFileId })
  const parent = useQuery({ queryKey: ['file-parent', brand?.id, parentId], queryFn: () => get<FileItem>(`/api/brands/${brand?.id}/files/${parentId}`), enabled: !!brand && !!parentId })

  const updateParam = useCallback((key: string, value: string | null, replace = false) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key === 'view' && value !== 'all') next.delete('parentId'); setParams(next, { replace }) }, [params, setParams])
  useEffect(() => { if (preferences.data) setViewMode(preferences.data.view_mode) }, [preferences.data])
  useEffect(() => { if ((params.get('q') ?? '') === search) return; const timeout = window.setTimeout(() => updateParam('q', search || null, true), 300); return () => window.clearTimeout(timeout) }, [params, search, updateParam])
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) } }, [])
  useEffect(() => () => { if (pendingSelection.current !== null) window.clearTimeout(pendingSelection.current) }, [])
  useEffect(() => { setSelection((current) => new Set([...current].filter((id) => files.data?.some((item) => item.id === id)))) }, [files.data])
  useEffect(() => { if (routeFileId && viewer.data?.kind === 'folder') { const next = new URLSearchParams(params); next.set('parentId', routeFileId); navigate(`/files?${next}`, { replace: true }) } }, [navigate, params, routeFileId, viewer.data?.kind])

  async function refresh() {
    if (!brand) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['files', brand.id] }),
      queryClient.invalidateQueries({ queryKey: ['file-details', brand.id] }),
      queryClient.invalidateQueries({ queryKey: ['file-viewer-details', brand.id] }),
      queryClient.invalidateQueries({ queryKey: ['file-parent', brand.id] }),
    ])
  }
  async function persistMode(next: ViewMode) { setViewMode(next); if (!brand) return; await patch(`/api/brands/${brand.id}/files/preferences`, { view_mode: next, sort_key: sort, sort_direction: direction, details_width: preferences.data?.details_width ?? 360 }) }
  function clearPendingSelection() { if (pendingSelection.current !== null) { window.clearTimeout(pendingSelection.current); pendingSelection.current = null } }
  function openItem(item: FileItem) { clearPendingSelection(); setSelection(new Set()); lastSelected.current = null; if (item.kind === 'folder') { const next = new URLSearchParams(params); next.delete('view'); next.set('parentId', item.id); navigate(`/files?${next}`) } else navigate(`/files/${item.id}?${params}`) }
  function select(item: FileItem, index: number, event?: MouseEvent) {
    clearPendingSelection()
    if (event && event.detail > 1) return
    const shiftKey = Boolean(event?.shiftKey)
    const additive = Boolean(event?.metaKey || event?.ctrlKey)
    const update = () => {
      pendingSelection.current = null
      setSelection((current) => {
        if (shiftKey && lastSelected.current !== null && files.data) { const next = new Set(additive ? current : []); const [from, to] = [lastSelected.current, index].sort((a, b) => a - b); files.data.slice(from, to + 1).forEach((row) => next.add(row.id)); return next }
        if (additive) { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); lastSelected.current = index; return next }
        if (current.size === 1 && current.has(item.id)) { lastSelected.current = null; return new Set() }
        lastSelected.current = index; return new Set([item.id])
      })
      setDetailsOpen(true)
    }
    if (event?.detail === 1) pendingSelection.current = window.setTimeout(update, 300)
    else update()
  }
  async function bulk(action: 'trash' | 'restore' | 'star' | 'unstar' | 'move' | 'copy', ids = [...selection], target?: string | null) { if (!brand || !ids.length) return; await post(`/api/brands/${brand.id}/files/bulk`, { ids, action, parent_id: target }); setSelection(new Set()); await refresh(); toast.success(t(bulkSuccess(action, ids.length), { count: ids.length })) }
  function download(ids = [...selection]) { window.location.assign(`/api/brands/${brand?.id}/files/bulk/download?ids=${encodeURIComponent(ids.join(','))}`) }
  async function trash(item: FileItem) { await remove(`/api/brands/${brand?.id}/files/${item.id}`); setTrashItem(null); setSelection(new Set()); await refresh(); toast.success(t('Moved to Trash')) }
  async function deleteForever(item: FileItem) { await remove(`/api/brands/${brand?.id}/files/${item.id}/forever`); setDeleteForeverItem(null); setSelection(new Set()); await refresh(); toast.success(t('Deleted forever')) }
  function askFolderUpload() { if (!uploadInput.current) return; uploadInput.current.setAttribute('webkitdirectory', ''); uploadInput.current.click() }
  function askFilesUpload() { if (!uploadInput.current) return; uploadInput.current.removeAttribute('webkitdirectory'); uploadInput.current.click() }

  async function uploadSelected(fileList: FileList | File[]) {
    const selectedFiles = Array.from(fileList)
    if (!selectedFiles.length || !brand) return
    if (!online) { toast.error(t('You are offline. Reconnect before uploading.')); return }
    const folders = new Map<string, string | null>([['', parentId]])
    for (const file of selectedFiles) {
      const parts = file.webkitRelativePath?.split('/').filter(Boolean) ?? []
      if (parts.length > 1) {
        let path = ''
        for (const part of parts.slice(0, -1)) {
          const next = path ? `${path}/${part}` : part
          if (!folders.has(next)) { const folder = await post<FileItem>(`/api/brands/${brand.id}/files/folder`, { name: part, parent_id: folders.get(path) ?? parentId }); folders.set(next, folder.id) }
          path = next
        }
      }
      const directory = parts.slice(0, -1).join('/')
      await uploadOne(file, folders.get(directory) ?? parentId)
    }
    if (uploadInput.current) uploadInput.current.value = ''
    await refresh()
  }

  function uploadOne(file: File, destination: string | null) {
    return new Promise<void>((resolve) => {
      const id = crypto.randomUUID()
      setUploads((current) => [...current, { id, name: file.name, percent: 0, status: 'uploading' }])
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/brands/${brand?.id}/files/upload`)
      xhr.withCredentials = true
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploads((current) => current.map((upload) => upload.id === id ? { ...upload, percent: Math.round(event.loaded / event.total * 100) } : upload)) }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { setUploads((current) => current.map((upload) => upload.id === id ? { ...upload, percent: 100, status: 'done' } : upload)); window.setTimeout(() => setUploads((current) => current.filter((upload) => upload.id !== id)), 2500) }
        else { let message = t('Upload failed'); try { message = JSON.parse(xhr.responseText).error ?? message } catch { /* response was not JSON */ } setUploads((current) => current.map((upload) => upload.id === id ? { ...upload, status: 'error', error: message } : upload)); toast.error(message) }
        resolve()
      }
      xhr.onerror = () => { setUploads((current) => current.map((upload) => upload.id === id ? { ...upload, status: 'error', error: t('Network error') } : upload)); resolve() }
      const data = new FormData(); data.set('files', file); if (destination) data.set('parent_id', destination); xhr.send(data)
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.matches('input,textarea,[contenteditable=true]')) return
    const rows = files.data ?? []
    const current = rows.findIndex((item) => selection.has(item.id))
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelection(new Set(rows.map((item) => item.id))); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.min(Math.max((current < 0 ? 0 : current) + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1); if (rows[next]) { setSelection(new Set([rows[next].id])); lastSelected.current = next } }
    if ((event.key === 'Enter' || event.key === ' ') && current >= 0) { event.preventDefault(); openItem(rows[current]) }
    if (event.key === 'F2' && current >= 0 && ['editor', 'manager'].includes(rows[current].effective_role)) { event.preventDefault(); setRenameItem(rows[current]) }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection.size && view !== 'trash') { event.preventDefault(); if (selection.size === 1) setTrashItem(rows.find((item) => selection.has(item.id)) ?? null); else void bulk('trash') }
  }

  function itemAction(item: FileItem, action: string) {
    if (action === 'open') openItem(item)
    if (action === 'rename') setRenameItem(item)
    if (action === 'details') { setSelection(new Set([item.id])); setDetailsOpen(true); setMobileDetails(true); setDetailsTab('details') }
    if (action === 'comments') { setSelection(new Set([item.id])); setDetailsOpen(true); setMobileDetails(true); setDetailsTab('comments') }
    if (action === 'share') { setSelection(new Set([item.id])); setDetailsOpen(true); setMobileDetails(true); setDetailsTab('access') }
    if (action === 'move') setMoveItems([item])
    if (action === 'copy') void bulk('copy', [item.id])
    if (action === 'star') void bulk(item.starred ? 'unstar' : 'star', [item.id])
    if (action === 'trash') setTrashItem(item)
    if (action === 'restore') void bulk('restore', [item.id])
    if (action === 'delete') setDeleteForeverItem(item)
    if (action === 'download' && item.kind === 'file') window.location.assign(`/api/brands/${brand?.id}/files/${item.id}/content?download=1`)
  }

  const ownerOptions = useMemo(() => [...new Map((files.data ?? []).filter((item) => item.creator).map((item) => [item.creator!.id, item.creator!])).values()], [files.data])
  const crumbs = parent.data?.breadcrumbs ?? (parent.data ? [{ id: parent.data.id, name: parent.data.name }] : [])
  const viewLabel = t(views.find((item) => item.id === view)?.label ?? 'All files')
  const typeLabel = t(({ folder: 'Folders', document: 'Documents', spreadsheet: 'Spreadsheets', presentation: 'Presentations', image: 'Images' } as Record<string, string>)[type] ?? 'All types')
  const ownerLabel = owner ? (ownerOptions.find((user) => user.id === owner)?.name ?? t('Owner')) : t('Any owner')
  const sortLabel = t(({ 'name:asc': 'Name A–Z', 'name:desc': 'Name Z–A', 'updated_at:desc': 'Newest first', 'updated_at:asc': 'Oldest first', 'size:desc': 'Largest first' } as Record<string, string>)[`${sort}:${direction}`] ?? 'Name A–Z')
  return <div ref={workspace} tabIndex={-1} onKeyDown={onKeyDown} className="flex h-[calc(100svh-6.5rem)] min-h-[34rem] flex-col overflow-hidden rounded-xl border bg-card shadow-sm outline-none">
    <Input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => void uploadSelected(event.target.files ?? [])} />
    <header className="border-b bg-background"><div className="flex flex-wrap items-center gap-2 p-3"><div className="me-auto flex items-center gap-2"><span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><HardDriveUpload className="size-5" /></span><div><h1 className="font-heading text-lg leading-tight">{t('Files')}</h1><p className="hidden text-xs text-muted-foreground sm:block">{t('Organize, preview, share, and discuss brand files.')}</p></div></div><DropdownMenu><DropdownMenuTrigger render={<Button size="sm" />}><Plus />{t('New')}<ChevronDown /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuLabel>{t('Create or upload')}</DropdownMenuLabel><DropdownMenuItem onClick={() => setFolderDialog(true)}><FolderPlus />{t('New folder')}</DropdownMenuItem><DropdownMenuItem onClick={askFilesUpload}><Upload />{t('Upload files')}</DropdownMenuItem><DropdownMenuItem onClick={askFolderUpload}><FolderInput />{t('Upload folder')}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></div>
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2"><Select value={view} onValueChange={(value) => updateParam('view', String(value))}><SelectTrigger size="sm" className="w-36 lg:hidden" aria-label={t('File view')}><SelectValue>{viewLabel}</SelectValue></SelectTrigger><SelectContent><SelectGroup>{views.map((item) => <SelectItem key={item.id} value={item.id}>{t(item.label)}</SelectItem>)}</SelectGroup></SelectContent></Select><div className="relative min-w-48 flex-1"><Search className="absolute start-2.5 top-2 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search files and folders…')} className="h-8 ps-8" /></div><Select value={type || 'all'} onValueChange={(value) => updateParam('type', value === 'all' ? null : String(value))}><SelectTrigger size="sm" className="w-32" aria-label={t('File type')}><Filter /><SelectValue>{typeLabel}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">{t('All types')}</SelectItem><SelectItem value="folder">{t('Folders')}</SelectItem><SelectItem value="document">{t('Documents')}</SelectItem><SelectItem value="spreadsheet">{t('Spreadsheets')}</SelectItem><SelectItem value="presentation">{t('Presentations')}</SelectItem><SelectItem value="image">{t('Images')}</SelectItem></SelectGroup></SelectContent></Select><Select value={owner || 'all'} onValueChange={(value) => updateParam('owner', value === 'all' ? null : String(value))}><SelectTrigger size="sm" className="hidden w-36 sm:flex" aria-label={t('Owner')}><SelectValue>{ownerLabel}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">{t('Any owner')}</SelectItem>{ownerOptions.map((user) => <SelectItem key={user.id} value={user.id} translate="no">{user.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={`${sort}:${direction}`} onValueChange={(value) => { const [key, order] = String(value).split(':'); const next = new URLSearchParams(params); next.set('sort', key); next.set('direction', order); setParams(next) }}><SelectTrigger size="sm" className="w-36" aria-label={t('Sort files')}><ArrowDownAZ /><SelectValue>{sortLabel}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="name:asc">{t('Name A–Z')}</SelectItem><SelectItem value="name:desc">{t('Name Z–A')}</SelectItem><SelectItem value="updated_at:desc">{t('Newest first')}</SelectItem><SelectItem value="updated_at:asc">{t('Oldest first')}</SelectItem><SelectItem value="size:desc">{t('Largest first')}</SelectItem></SelectGroup></SelectContent></Select><ToggleGroup value={[viewMode]} onValueChange={(values) => values[0] && void persistMode(values[0] as ViewMode)} aria-label={t('File view')}><ToggleGroupItem value="grid" aria-label={t('Grid view')}><Grid2X2 /></ToggleGroupItem><ToggleGroupItem value="list" aria-label={t('List view')}><List /></ToggleGroupItem><ToggleGroupItem value="compact" aria-label={t('Compact view')}><Columns3 /></ToggleGroupItem></ToggleGroup></div>
      {selection.size ? <SelectionBar count={selection.size} trash={view === 'trash'} onClear={() => setSelection(new Set())} onAction={(action) => { if (action === 'download') download(); else if (action === 'move') setMoveItems((files.data ?? []).filter((item) => selection.has(item.id))); else if (action === 'delete') setDeleteForeverItem((files.data ?? []).find((item) => selection.has(item.id)) ?? null); else void bulk(action as 'trash' | 'restore' | 'star' | 'copy') }} onDetails={() => { setDetailsOpen(true); setMobileDetails(true) }} /> : null}
    </header>
    {!online ? <Alert className="m-3 mb-0 rounded-lg border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"><ArchiveRestore /><AlertTitle>{t('You are offline')}</AlertTitle><AlertDescription>{t('Existing metadata may remain visible, but uploads and changes require a connection.')}</AlertDescription></Alert> : null}
    {uploads.length ? <UploadQueue uploads={uploads} onDismiss={(id) => setUploads((current) => current.filter((upload) => upload.id !== id))} /> : null}
    <div className="hidden min-h-0 flex-1 lg:block"><ResizablePanelGroup orientation="horizontal" className="min-h-0"><ResizablePanel id="files-main" minSize="55%"><WorkspaceBody view={view} params={params} crumbs={crumbs} files={files.data ?? []} loading={files.isLoading} error={files.error} viewMode={viewMode} selection={selection} onSelect={select} onOpen={openItem} onAction={itemAction} draggedId={draggedId} setDraggedId={setDraggedId} onMove={async (id, target) => { await bulk('move', [id], target) }} dropActive={dropActive} setDropActive={setDropActive} onUpload={uploadSelected} onCreateFolder={() => setFolderDialog(true)} /></ResizablePanel>{selected && detailsOpen ? <><ResizableHandle withHandle /><ResizablePanel id="files-details" defaultSize={`${preferences.data?.details_width ?? 360}px`} minSize="300px" maxSize="520px"><FileDetailsPanel key={`${selected.id}:${detailsTab}`} brandId={brand?.id ?? ''} item={selected} onClose={() => setDetailsOpen(false)} initialTab={detailsTab} onChanged={() => void refresh()} /></ResizablePanel></> : null}</ResizablePanelGroup></div>
    <div className="min-h-0 flex-1 lg:hidden"><WorkspaceBody view={view} params={params} crumbs={crumbs} files={files.data ?? []} loading={files.isLoading} error={files.error} viewMode={viewMode} selection={selection} onSelect={select} onOpen={openItem} onAction={itemAction} draggedId={draggedId} setDraggedId={setDraggedId} onMove={async (id, target) => { await bulk('move', [id], target) }} dropActive={dropActive} setDropActive={setDropActive} onUpload={uploadSelected} onCreateFolder={() => setFolderDialog(true)} /></div>
    <Sheet open={mobileDetails && !!selected} onOpenChange={setMobileDetails}><SheetContent side="bottom" className="h-[85svh] rounded-t-2xl"><SheetHeader className="sr-only"><SheetTitle>{t('File details')}</SheetTitle><SheetDescription>{t('Details, activity, comments, access, and versions')}</SheetDescription></SheetHeader>{selected ? <FileDetailsPanel key={`${selected.id}:${detailsTab}:mobile`} brandId={brand?.id ?? ''} item={selected} initialTab={detailsTab} onChanged={() => void refresh()} /> : null}</SheetContent></Sheet>
    <NameDialog open={folderDialog} onOpenChange={setFolderDialog} title={t('Create folder')} description={t('Folders keep files organized and inherit access by default.')} initial={t('Untitled folder')} action={t('Create')} color onSave={async (name, color) => { await post(`/api/brands/${brand?.id}/files/folder`, { name, parent_id: parentId, color }); setFolderDialog(false); await refresh() }} />
    <NameDialog open={!!renameItem} onOpenChange={(open) => !open && setRenameItem(null)} title={t('Rename item')} description={t('The new name is visible to everyone with access.')} initial={renameItem?.name ?? ''} action={t('Save')} onSave={async (name) => { if (!renameItem) return; await patch(`/api/brands/${brand?.id}/files/${renameItem.id}`, { name }); setRenameItem(null); await refresh(); toast.success(t('Renamed')) }} />
    <MoveDialog open={moveItems.length > 0} onOpenChange={(open) => !open && setMoveItems([])} brandId={brand?.id ?? ''} items={moveItems} onMove={async (target) => { await bulk('move', moveItems.map((item) => item.id), target); setMoveItems([]) }} />
    <AlertDialog open={!!trashItem} onOpenChange={(open) => !open && setTrashItem(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('Move to Trash?')}</AlertDialogTitle><AlertDialogDescription>{t('The item and any folder descendants will be hidden. You can restore them later.')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('Cancel')}</AlertDialogCancel><AlertDialogAction onClick={() => trashItem && void trash(trashItem)}>{t('Move to Trash')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!deleteForeverItem} onOpenChange={(open) => !open && setDeleteForeverItem(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('Delete forever?')}</AlertDialogTitle><AlertDialogDescription>{t('This cannot be undone. Stored objects are removed only when no other version references them.')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('Cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleteForeverItem && void deleteForever(deleteForeverItem)}>{t('Delete forever')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {routeFileId ? <ViewerDialog brandId={brand?.id ?? ''} item={viewer.data} loading={viewer.isLoading} error={viewer.error} open onOpenChange={(open) => { if (!open) navigate(`/files?${params}`) }} details={viewerDetails} onDetailsChange={setViewerDetails} pendingAnchor={pendingAnchor} onAnchor={setPendingAnchor} onAnchorConsumed={() => setPendingAnchor(null)} onChanged={() => void refresh()} version={params.get('version')} comment={params.get('comment')} /> : null}
  </div>
}

function WorkspaceBody({ view, params, crumbs, files, loading, error, viewMode, selection, onSelect, onOpen, onAction, draggedId, setDraggedId, onMove, dropActive, setDropActive, onUpload, onCreateFolder }: { view: string; params: URLSearchParams; crumbs: Array<{ id: string; name: string }>; files: FileItem[]; loading: boolean; error: Error | null; viewMode: ViewMode; selection: Set<string>; onSelect: (item: FileItem, index: number, event?: MouseEvent) => void; onOpen: (item: FileItem) => void; onAction: (item: FileItem, action: string) => void; draggedId: string | null; setDraggedId: (id: string | null) => void; onMove: (id: string, target: string) => Promise<void>; dropActive: boolean; setDropActive: (value: boolean) => void; onUpload: (files: FileList | File[]) => Promise<void>; onCreateFolder: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDropActive(false); if (event.dataTransfer.files.length) void onUpload(event.dataTransfer.files) }
  return <div className="flex h-full min-h-0"><aside className="hidden w-48 shrink-0 border-e bg-muted/20 p-2 lg:block"><nav aria-label={t('File views')} className="space-y-1">{views.map((item) => <Button key={item.id} variant={view === item.id ? 'secondary' : 'ghost'} className="w-full justify-start" onClick={() => { const next = new URLSearchParams(params); if (item.id === 'all') next.delete('view'); else next.set('view', item.id); next.delete('parentId'); navigate(`/files?${next}`) }}><item.icon />{t(item.label)}</Button>)}</nav><div className="mt-6 rounded-lg border bg-card p-3 text-xs"><div className="mb-2 flex items-center gap-2"><HardDriveUpload className="size-4 text-primary" /><strong>{t('Secure library')}</strong></div><p className="text-muted-foreground">{t('100 MB per file · quarantine and malware scan')}</p></div></aside><main className="relative flex min-w-0 flex-1 flex-col" onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDropActive(true) }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false) }} onDrop={drop}><div className="flex h-11 items-center gap-2 border-b px-3"><Breadcrumb className="min-w-0 flex-1"><BreadcrumbList className="flex-nowrap overflow-hidden"><BreadcrumbItem><BreadcrumbLink render={<Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { const next = new URLSearchParams(params); next.delete('parentId'); next.delete('view'); navigate(`/files?${next}`) }} />}>{t('All files')}</BreadcrumbLink></BreadcrumbItem>{crumbs.map((crumb, index) => <span key={crumb.id} className="contents"><BreadcrumbSeparator /><BreadcrumbItem className="min-w-0">{index === crumbs.length - 1 ? <BreadcrumbPage className="truncate" translate="no">{crumb.name}</BreadcrumbPage> : <BreadcrumbLink render={<Button size="sm" variant="ghost" className="h-7 max-w-40 truncate px-2" onClick={() => { const next = new URLSearchParams(params); next.set('parentId', crumb.id); navigate(`/files?${next}`) }} />}>{crumb.name}</BreadcrumbLink>}</BreadcrumbItem></span>)}</BreadcrumbList></Breadcrumb><span className="text-xs text-muted-foreground">{t('{count} items', { count: files.length })}</span></div><div className="min-h-0 flex-1 overflow-auto p-3">{loading ? <FilesSkeleton mode={viewMode} /> : error ? <Alert variant="destructive"><ArchiveRestore /><AlertTitle>{t('Files could not be loaded')}</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert> : !files.length ? <EmptyFiles view={view} onUpload={() => document.querySelector<HTMLInputElement>('input[data-slot="input"][type="file"]')?.click()} onCreateFolder={onCreateFolder} /> : viewMode === 'grid' ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{files.map((item, index) => <GridItem key={item.id} item={item} index={index} selected={selection.has(item.id)} onSelect={onSelect} onOpen={onOpen} onAction={onAction} setDraggedId={setDraggedId} draggedId={draggedId} onMove={onMove} />)}</div> : <ListItems compact={viewMode === 'compact'} files={files} selection={selection} onSelect={onSelect} onOpen={onOpen} onAction={onAction} setDraggedId={setDraggedId} draggedId={draggedId} onMove={onMove} />}</div>{dropActive ? <div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm"><div className="text-center"><Upload className="mx-auto size-10 text-primary" /><strong className="mt-2 block">{t('Drop files to upload')}</strong><span className="text-sm text-muted-foreground">{t('They will be added to the current folder.')}</span></div></div> : null}</main></div>
}

function GridItem({ item, index, selected, onSelect, onOpen, onAction, setDraggedId, draggedId, onMove }: { item: FileItem; index: number; selected: boolean; onSelect: (item: FileItem, index: number, event?: MouseEvent) => void; onOpen: (item: FileItem) => void; onAction: (item: FileItem, action: string) => void; setDraggedId: (id: string | null) => void; draggedId: string | null; onMove: (id: string, target: string) => Promise<void> }) {
  const { t } = useI18n()
  const content = <div draggable data-dragging={draggedId === item.id ? 'true' : undefined} onDragStart={(event) => { setDraggedId(item.id); setFileDragImage(event, item) }} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => { if (item.kind === 'folder' && draggedId && draggedId !== item.id) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (item.kind === 'folder' && draggedId && draggedId !== item.id) void onMove(draggedId, item.id) }} className={cn('group cursor-grab select-none overflow-hidden rounded-xl border bg-card transition hover:border-foreground/20 hover:shadow-sm active:cursor-grabbing', selected && 'border-primary ring-2 ring-primary/20', draggedId === item.id && 'opacity-60')}><div className="relative"><Button variant="ghost" className="h-36 w-full rounded-none bg-muted/20 p-0 hover:bg-muted/40" onClick={(event) => onSelect(item, index, event)} onDoubleClick={() => onOpen(item)} aria-label={`${selected ? t('Selected') : t('Select')} ${item.name}`}>{item.kind === 'file' && item.preview_kind === 'image' ? <img src={`/api/brands/${item.brand_id}/files/${item.id}/content`} alt="" className="h-full w-full object-cover" loading="lazy" /> : <FileIcon item={item} large />}</Button><Checkbox checked={selected} onCheckedChange={() => onSelect(item, index)} aria-label={t('Select {name}', { name: item.name })} className="absolute start-3 top-3 bg-background/90" /><Button size="icon-sm" variant="secondary" className="absolute end-2 top-2 opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => onAction(item, 'details')} aria-label={t('Show details for {name}', { name: item.name })}><Info /></Button>{item.starred ? <Star className="absolute bottom-2 end-2 size-4 fill-current text-amber-500" aria-label={t('Starred')} /> : null}</div><div className="flex items-center gap-2 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" translate="no">{item.name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.kind === 'folder' ? t('Folder') : formatBytes(item.size)} · {shortDate(item.updated_at)}</p></div><ItemMenu item={item} onAction={onAction} /></div></div>
  return <ItemContextMenu item={item} onAction={onAction}>{content}</ItemContextMenu>
}

function ListItems({ files, compact, selection, onSelect, onOpen, onAction, setDraggedId, draggedId, onMove }: { files: FileItem[]; compact: boolean; selection: Set<string>; onSelect: (item: FileItem, index: number, event?: MouseEvent) => void; onOpen: (item: FileItem) => void; onAction: (item: FileItem, action: string) => void; setDraggedId: (id: string | null) => void; draggedId: string | null; onMove: (id: string, target: string) => Promise<void> }) {
  const { t } = useI18n()
  return <div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead className="w-10"><span className="sr-only">{t('Select')}</span></TableHead><TableHead>{t('Name')}</TableHead>{!compact ? <><TableHead className="hidden md:table-cell">{t('Owner')}</TableHead><TableHead className="hidden sm:table-cell">{t('Modified')}</TableHead><TableHead className="hidden sm:table-cell">{t('Size')}</TableHead></> : null}<TableHead className="w-12" /></TableRow></TableHeader><TableBody>{files.map((item, index) => { const row = <TableRow key={item.id} data-state={selection.has(item.id) ? 'selected' : undefined} data-dragging={draggedId === item.id ? 'true' : undefined} draggable className={cn('cursor-grab select-none active:cursor-grabbing', draggedId === item.id && 'opacity-60')} onDragStart={(event) => { setDraggedId(item.id); setFileDragImage(event, item) }} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => { if (item.kind === 'folder' && draggedId && draggedId !== item.id) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (item.kind === 'folder' && draggedId && draggedId !== item.id) void onMove(draggedId, item.id) }}><TableCell><Checkbox checked={selection.has(item.id)} onCheckedChange={() => onSelect(item, index)} aria-label={t('Select {name}', { name: item.name })} /></TableCell><TableCell><Button variant="ghost" className={cn('h-auto max-w-full justify-start px-1 font-medium', compact ? 'py-0.5' : 'py-1.5')} onClick={(event) => onSelect(item, index, event)} onDoubleClick={() => onOpen(item)}><FileIcon item={item} /><span className="truncate" translate="no">{item.name}</span>{item.starred ? <Star className="ms-1 size-3.5 fill-current text-amber-500" /> : null}{item.shared ? <Link2 className="ms-1 size-3.5 text-muted-foreground" /> : null}</Button></TableCell>{!compact ? <><TableCell className="hidden max-w-40 truncate text-muted-foreground md:table-cell" translate="no">{item.creator?.name ?? '—'}</TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{shortDate(item.updated_at)}</TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{item.kind === 'folder' ? '—' : formatBytes(item.size)}</TableCell></> : null}<TableCell><ItemMenu item={item} onAction={onAction} /></TableCell></TableRow>; return <ItemContextMenu key={item.id} item={item} onAction={onAction}>{row}</ItemContextMenu> })}</TableBody></Table></div>
}

function ItemMenu({ item, onAction }: { item: FileItem; onAction: (item: FileItem, action: string) => void }) {
  const { t } = useI18n()
  return <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('Actions for {name}', { name: item.name })} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuLabel translate="no">{item.name}</DropdownMenuLabel><DropdownMenuItem onClick={() => onAction(item, 'open')}><FileText />{item.kind === 'folder' ? t('Open') : t('Preview')}</DropdownMenuItem>{item.kind === 'file' ? <DropdownMenuItem onClick={() => onAction(item, 'download')}><Download />{t('Download')}</DropdownMenuItem> : null}<DropdownMenuItem onClick={() => onAction(item, 'details')}><Info />{t('Details')}</DropdownMenuItem><DropdownMenuItem onClick={() => onAction(item, 'comments')}><MessageSquare />{t('Comments')}</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup>{['editor', 'manager'].includes(item.effective_role) ? <><DropdownMenuItem onClick={() => onAction(item, 'rename')}><Pencil />{t('Rename')}</DropdownMenuItem><DropdownMenuItem onClick={() => onAction(item, 'move')}><FolderInput />{t('Move')}</DropdownMenuItem><DropdownMenuItem onClick={() => onAction(item, 'copy')}><Copy />{t('Make a copy')}</DropdownMenuItem></> : null}<DropdownMenuItem onClick={() => onAction(item, 'star')}><Star />{item.starred ? t('Remove star') : t('Add star')}</DropdownMenuItem>{item.effective_role === 'manager' ? <DropdownMenuItem onClick={() => onAction(item, 'share')}><Share2 />{t('Share')}</DropdownMenuItem> : null}</DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup>{item.trashed_at ? <><DropdownMenuItem onClick={() => onAction(item, 'restore')}><RotateCcw />{t('Restore')}</DropdownMenuItem>{item.effective_role === 'manager' ? <DropdownMenuItem variant="destructive" onClick={() => onAction(item, 'delete')}><Trash2 />{t('Delete forever')}</DropdownMenuItem> : null}</> : ['editor', 'manager'].includes(item.effective_role) ? <DropdownMenuItem variant="destructive" onClick={() => onAction(item, 'trash')}><Trash2 />{t('Move to Trash')}</DropdownMenuItem> : null}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
}

function ItemContextMenu({ item, onAction, children }: { item: FileItem; onAction: (item: FileItem, action: string) => void; children: React.ReactElement }) {
  const { t } = useI18n()
  return <ContextMenu><ContextMenuTrigger render={children} /><ContextMenuContent><ContextMenuGroup><ContextMenuLabel translate="no">{item.name}</ContextMenuLabel><ContextMenuItem onClick={() => onAction(item, 'open')}>{item.kind === 'folder' ? <Folder /> : <FileText />}{item.kind === 'folder' ? t('Open') : t('Preview')}<ContextMenuShortcut>{item.kind === 'folder' ? '↵' : 'Space'}</ContextMenuShortcut></ContextMenuItem>{item.kind === 'file' ? <ContextMenuItem onClick={() => onAction(item, 'download')}><Download />{t('Download')}</ContextMenuItem> : null}<ContextMenuItem onClick={() => onAction(item, 'details')}><Info />{t('Details')}</ContextMenuItem></ContextMenuGroup><ContextMenuSeparator /><ContextMenuGroup>{['editor', 'manager'].includes(item.effective_role) ? <><ContextMenuItem onClick={() => onAction(item, 'rename')}><Pencil />{t('Rename')}<ContextMenuShortcut>F2</ContextMenuShortcut></ContextMenuItem><ContextMenuItem onClick={() => onAction(item, 'move')}><FolderInput />{t('Move')}</ContextMenuItem><ContextMenuItem onClick={() => onAction(item, 'copy')}><Copy />{t('Make a copy')}</ContextMenuItem></> : null}<ContextMenuItem onClick={() => onAction(item, 'star')}><Star />{item.starred ? t('Remove star') : t('Add star')}</ContextMenuItem>{item.effective_role === 'manager' ? <ContextMenuItem onClick={() => onAction(item, 'share')}><Share2 />{t('Share')}</ContextMenuItem> : null}</ContextMenuGroup><ContextMenuSeparator /><ContextMenuGroup>{item.trashed_at ? <ContextMenuItem onClick={() => onAction(item, 'restore')}><RotateCcw />{t('Restore')}</ContextMenuItem> : ['editor', 'manager'].includes(item.effective_role) ? <ContextMenuItem variant="destructive" onClick={() => onAction(item, 'trash')}><Trash2 />{t('Move to Trash')}<ContextMenuShortcut>⌫</ContextMenuShortcut></ContextMenuItem> : null}</ContextMenuGroup></ContextMenuContent></ContextMenu>
}

function SelectionBar({ count, trash, onClear, onAction, onDetails }: { count: number; trash: boolean; onClear: () => void; onAction: (action: string) => void; onDetails: () => void }) {
  const { t } = useI18n()
  return <div className="flex items-center gap-1.5 border-t bg-primary/5 px-3 py-2"><Button size="icon-sm" variant="ghost" onClick={onClear} aria-label={t('Clear selection')}><X /></Button><strong className="me-auto text-sm">{t('{count} selected', { count })}</strong>{trash ? <><Button size="sm" variant="outline" onClick={() => onAction('restore')}><RotateCcw />{t('Restore')}</Button>{count === 1 ? <Button size="sm" variant="destructive" onClick={() => onAction('delete')}><Trash2 />{t('Delete forever')}</Button> : null}</> : <><Button size="icon-sm" variant="ghost" onClick={() => onAction('download')} aria-label={t('Download ZIP')}><Download /></Button><Button size="icon-sm" variant="ghost" onClick={() => onAction('star')} aria-label={t('Add star')}><Star /></Button><Button size="icon-sm" variant="ghost" onClick={() => onAction('copy')} aria-label={t('Make copies')}><Copy /></Button><Button size="icon-sm" variant="ghost" onClick={() => onAction('move')} aria-label={t('Move')}><FolderInput /></Button><Button size="icon-sm" variant="ghost" onClick={onDetails} disabled={count !== 1} aria-label={t('Details')}><Info /></Button><Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => onAction('trash')} aria-label={t('Move to Trash')}><Trash2 /></Button></>}</div>
}

function UploadQueue({ uploads, onDismiss }: { uploads: UploadState[]; onDismiss: (id: string) => void }) {
  const { t } = useI18n()
  return <div className="absolute bottom-4 end-4 z-40 w-[min(22rem,calc(100%-2rem))] overflow-hidden rounded-xl border bg-popover shadow-xl"><div className="flex items-center justify-between border-b px-3 py-2"><strong className="text-sm">{t('Uploads')}</strong><Badge variant="secondary">{uploads.length}</Badge></div><div className="max-h-52 overflow-y-auto p-2">{uploads.map((upload) => <div key={upload.id} className="mb-1 rounded-lg p-2 last:mb-0"><div className="flex items-center gap-2"><File className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate text-xs" translate="no">{upload.name}</span>{upload.status === 'uploading' ? <span className="text-xs tabular-nums">{upload.percent}%</span> : upload.status === 'done' ? <Badge>{t('Done')}</Badge> : <Button size="icon-xs" variant="ghost" onClick={() => onDismiss(upload.id)}><X /></Button>}</div><Progress value={upload.percent} className="mt-2 h-1.5" />{upload.error ? <p className="mt-1 text-xs text-destructive">{upload.error}</p> : null}</div>)}</div></div>
}

function EmptyFiles({ view, onUpload, onCreateFolder }: { view: string; onUpload: () => void; onCreateFolder: () => void }) {
  const { t } = useI18n()
  const content = ({ trash: [Trash2, 'Trash is empty', 'Items moved to Trash appear here until they are restored or deleted forever.'], starred: [Star, 'No starred files', 'Add a star to keep important files close.'], shared: [Share2, 'Nothing shared yet', 'Restricted items and active external links appear here.'], recent: [Clock3, 'No recent files', 'Files you upload or update will appear here.'] } as Record<string, [typeof Trash2, string, string]>)[view] ?? [HardDriveUpload, 'Build your file library', 'Upload documents, images, spreadsheets, presentations, code, or create a folder.']
  const Icon = content[0]
  return <div className="grid min-h-80 place-items-center rounded-xl border border-dashed bg-muted/10 p-8 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-muted"><Icon className="size-7 text-muted-foreground" /></span><h2 className="mt-4 font-medium">{t(content[1])}</h2><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t(content[2])}</p>{view === 'all' ? <div className="mt-4 flex justify-center gap-2"><Button variant="outline" onClick={onCreateFolder}><FolderPlus />{t('New folder')}</Button><Button onClick={onUpload}><Upload />{t('Upload files')}</Button></div> : null}</div></div>
}

function FilesSkeleton({ mode }: { mode: ViewMode }) { return mode === 'grid' ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-52 rounded-xl" />)}</div> : <div className="space-y-2">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-12 rounded-lg" />)}</div> }

function FileIcon({ item, large = false }: { item: FileItem; large?: boolean }) {
  const className = large ? 'size-16' : 'size-5'
  if (item.kind === 'folder') return <Folder data-file-drag-icon className={className} style={{ color: item.color ?? undefined, fill: item.color ? `${item.color}25` : undefined }} />
  if (item.preview_kind === 'image') return <FileImage data-file-drag-icon className={cn(className, 'text-emerald-600')} />
  if (item.preview_kind === 'video') return <Video data-file-drag-icon className={cn(className, 'text-sky-600')} />
  if (item.preview_kind === 'sheet') return <FileSpreadsheet data-file-drag-icon className={cn(className, 'text-emerald-600')} />
  if (item.preview_kind === 'code') return <FileCode2 data-file-drag-icon className={cn(className, 'text-violet-600')} />
  if (item.mime_type?.includes('zip')) return <FileArchive data-file-drag-icon className={cn(className, 'text-amber-600')} />
  if (['pdf', 'docx', 'pptx'].includes(item.preview_kind)) return <FileText data-file-drag-icon className={cn(className, item.preview_kind === 'pdf' ? 'text-rose-600' : 'text-primary')} />
  return <File data-file-drag-icon className={cn(className, 'text-muted-foreground')} />
}

function NameDialog({ open, onOpenChange, title, description, initial, action, color = false, onSave }: { open: boolean; onOpenChange: (value: boolean) => void; title: string; description: string; initial: string; action: string; color?: boolean; onSave: (name: string, color?: string | null) => Promise<void> }) {
  const { t } = useI18n()
  const [name, setName] = useState(initial)
  const [folderColor, setFolderColor] = useState<string | null>(null)
  useEffect(() => setName(initial), [initial, open])
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div><Label htmlFor="file-name">{t('Name')}</Label><Input id="file-name" className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} autoFocus onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) void onSave(name.trim(), folderColor) }} /></div>{color ? <div><Label>{t('Folder color')}</Label><div className="mt-2 flex gap-2">{[null, '#d97706', '#2563eb', '#059669', '#7c3aed', '#db2777'].map((value) => <Button key={value ?? 'default'} size="icon-sm" variant={folderColor === value ? 'secondary' : 'outline'} onClick={() => setFolderColor(value)} aria-label={value ? t('Choose folder color') : t('Default folder color')}><Folder style={{ color: value ?? undefined, fill: value ? `${value}25` : undefined }} /></Button>)}</div></div> : null}<DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button><Button disabled={!name.trim()} onClick={() => void onSave(name.trim(), folderColor)}>{action}</Button></DialogFooter></DialogContent></Dialog>
}

function MoveDialog({ open, onOpenChange, brandId, items, onMove }: { open: boolean; onOpenChange: (open: boolean) => void; brandId: string; items: FileItem[]; onMove: (target: string | null) => Promise<void> }) {
  const { t } = useI18n()
  const [target, setTarget] = useState('root')
  const folders = useQuery({ queryKey: ['move-folders', brandId, open], queryFn: () => get<FileItem[]>(`/api/brands/${brandId}/files?view=recent&type=folder&limit=200`), enabled: open && !!brandId })
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{t('Move {count} items', { count: items.length })}</DialogTitle><DialogDescription>{t('Choose a destination folder. Folder cycles are blocked automatically.')}</DialogDescription></DialogHeader><Select value={target} onValueChange={(value) => setTarget(String(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="root">{t('All files')}</SelectItem>{folders.data?.filter((folder) => !items.some((item) => item.id === folder.id)).map((folder) => <SelectItem key={folder.id} value={folder.id} translate="no">{folder.name}</SelectItem>)}</SelectGroup></SelectContent></Select><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button><Button onClick={() => void onMove(target === 'root' ? null : target)}>{t('Move here')}</Button></DialogFooter></DialogContent></Dialog>
}

function ViewerDialog({ brandId, item, loading, error, open, onOpenChange, details, onDetailsChange, pendingAnchor, onAnchor, onAnchorConsumed, onChanged, version, comment }: { brandId: string; item?: FileItem; loading: boolean; error: Error | null; open: boolean; onOpenChange: (open: boolean) => void; details: boolean; onDetailsChange: (value: boolean) => void; pendingAnchor: ViewerAnchor | null; onAnchor: (anchor: ViewerAnchor) => void; onAnchorConsumed: () => void; onChanged: () => void; version: string | null; comment: string | null }) {
  const { t } = useI18n()
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent showCloseButton={false} className="flex h-svh max-h-svh w-screen max-w-none translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden rounded-none p-0 ring-0 sm:max-w-none"><DialogHeader className="sr-only"><DialogTitle>{item?.name ?? t('File preview')}</DialogTitle><DialogDescription>{t('Secure read-only file preview')}</DialogDescription></DialogHeader><div className="flex h-14 shrink-0 items-center gap-2 border-b px-3"><Button size="icon-sm" variant="ghost" onClick={() => onOpenChange(false)} aria-label={t('Close preview')}><X /></Button>{item ? <FileIcon item={item} /> : null}<strong className="min-w-0 flex-1 truncate" translate="no">{item?.name ?? t('Loading…')}</strong>{item?.current_version ? <Badge variant="secondary">v{item.current_version.version_number}</Badge> : null}{item ? <Button size="sm" variant={details ? 'secondary' : 'ghost'} onClick={() => onDetailsChange(!details)}><Info />{t('Details')}</Button> : null}{item ? <Button nativeButton={false} size="icon-sm" variant="ghost" render={<a href={`/api/brands/${brandId}/files/${item.id}/content?download=1`} download />} aria-label={t('Download')}><Download /></Button> : null}</div><div className="min-h-0 flex-1">{loading ? <div className="grid h-full place-items-center"><LoaderCircle className="size-7 animate-spin text-muted-foreground" /></div> : error || !item ? <div className="grid h-full place-items-center p-6 text-sm text-destructive">{error?.message ?? t('File not found')}</div> : <><div className="hidden h-full lg:block"><ResizablePanelGroup className="min-h-0" orientation="horizontal"><ResizablePanel id="viewer-main" minSize="55%"><FileViewer kind={item.preview_kind} reason={item.preview_reason} source={{ url: `/api/brands/${brandId}/files/${item.id}/content${version ? `?version=${encodeURIComponent(version)}` : ''}`, name: item.name, mimeType: item.current_version?.mime_type ?? item.mime_type ?? '', versionId: version ?? item.current_version_id ?? undefined }} onAnchor={(anchor) => { onAnchor(anchor); onDetailsChange(true) }} /></ResizablePanel>{details ? <><ResizableHandle withHandle /><ResizablePanel id="viewer-details" defaultSize="380px" minSize="320px" maxSize="520px"><FileDetailsPanel key={`${item.id}:${comment ?? ''}`} brandId={brandId} item={item} initialTab={comment || pendingAnchor ? 'comments' : 'details'} pendingAnchor={pendingAnchor} onAnchorConsumed={onAnchorConsumed} onClose={() => onDetailsChange(false)} onChanged={onChanged} /></ResizablePanel></> : null}</ResizablePanelGroup></div><div className="h-full lg:hidden"><FileViewer kind={item.preview_kind} reason={item.preview_reason} source={{ url: `/api/brands/${brandId}/files/${item.id}/content${version ? `?version=${encodeURIComponent(version)}` : ''}`, name: item.name, mimeType: item.current_version?.mime_type ?? item.mime_type ?? '' }} onAnchor={(anchor) => { onAnchor(anchor); onDetailsChange(true) }} /></div><Sheet open={details} onOpenChange={onDetailsChange}><SheetContent side="bottom" className="h-[85svh] rounded-t-2xl lg:hidden"><SheetHeader className="sr-only"><SheetTitle>{t('File details')}</SheetTitle><SheetDescription>{t('Details and collaboration')}</SheetDescription></SheetHeader><FileDetailsPanel key={`${item.id}:${comment ?? ''}:viewer-mobile`} brandId={brandId} item={item} initialTab={comment || pendingAnchor ? 'comments' : 'details'} pendingAnchor={pendingAnchor} onAnchorConsumed={onAnchorConsumed} onChanged={onChanged} /></SheetContent></Sheet></>}</div></DialogContent></Dialog>
}

function bulkSuccess(action: string, count: number) { return ({ trash: count === 1 ? 'Moved to Trash' : '{count} items moved to Trash', restore: count === 1 ? 'Item restored' : '{count} items restored', star: count === 1 ? 'Star added' : 'Stars added', unstar: count === 1 ? 'Star removed' : 'Stars removed', move: count === 1 ? 'Item moved' : '{count} items moved', copy: count === 1 ? 'Copy created' : '{count} copies created' } as Record<string, string>)[action] ?? 'Files updated' }

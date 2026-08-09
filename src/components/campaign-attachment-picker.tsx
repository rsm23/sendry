import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, File, FileArchive, FileImage, FileText, Folder, LoaderCircle, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api, get } from '@/lib/api'
import { useI18n } from '@/i18n/context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export type LibraryAsset = {
  id: string
  parent_id: string | null
  kind: 'file' | 'folder'
  name: string
  mime_type?: string
  size: number
}

type Crumb = { id: string | null; name: string }

export function CampaignAttachmentPicker({ brandId, open, selectedIds, onOpenChange, onSelectedIdsChange, onConfirm }: {
  brandId: string
  open: boolean
  selectedIds: string[]
  onOpenChange: (open: boolean) => void
  onSelectedIdsChange: Dispatch<SetStateAction<string[]>>
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const uploadInput = useRef<HTMLInputElement>(null)
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: 'All files' }])
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const parentId = crumbs.at(-1)?.id ?? null
  const query = useQuery({
    queryKey: ['files', brandId, parentId],
    queryFn: () => get<LibraryAsset[]>(`/api/brands/${brandId}/files${parentId ? `?parentId=${parentId}` : ''}`),
    enabled: open,
  })
  const visibleItems = useMemo(() => {
    const value = search.trim().toLocaleLowerCase()
    return value ? query.data?.filter((item) => item.name.toLocaleLowerCase().includes(value)) ?? [] : query.data ?? []
  }, [query.data, search])

  function changeOpen(next: boolean) {
    if (!next) {
      setCrumbs([{ id: null, name: 'All files' }])
      setSearch('')
    }
    onOpenChange(next)
  }

  function openFolder(folder: LibraryAsset) {
    setCrumbs((current) => [...current, { id: folder.id, name: folder.name }])
    setSearch('')
  }

  function toggleFile(fileId: string, checked: boolean) {
    onSelectedIdsChange((current) => checked ? [...new Set([...current, fileId])] : current.filter((id) => id !== fileId))
  }

  function confirmSelection() {
    setCrumbs([{ id: null, name: 'All files' }])
    setSearch('')
    onConfirm()
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      const data = new FormData()
      for (const file of files) data.append('files', file)
      if (parentId) data.set('parent_id', parentId)
      const created = await api<LibraryAsset[]>(`/api/brands/${brandId}/files/upload`, { method: 'POST', body: data })
      if (!created.length) {
        toast.error(t('No files were uploaded. Check the allowed file types.'))
        return
      }
      onSelectedIdsChange((current) => [...new Set([...current, ...created.map((file) => file.id)])])
      await queryClient.invalidateQueries({ queryKey: ['files', brandId] })
      toast.success(t(created.length === 1 ? '{count} file uploaded' : '{count} files uploaded', { count: created.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Files could not be uploaded'))
    } finally {
      setUploading(false)
      if (uploadInput.current) uploadInput.current.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="flex max-h-[88svh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Campaign attachments</DialogTitle>
          <DialogDescription>Browse folders, select files, or upload new attachments without leaving this campaign.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav className="flex min-w-0 flex-1 items-center overflow-x-auto text-sm" aria-label="File location">
              {crumbs.map((crumb, index) => (
                <span key={crumb.id ?? 'root'} className="flex shrink-0 items-center">
                  <button type="button" className={index === crumbs.length - 1 ? 'font-medium' : 'text-muted-foreground hover:text-foreground'} onClick={() => { setCrumbs((current) => current.slice(0, index + 1)); setSearch('') }}>
                    <span translate={crumb.id ? 'no' : undefined}>{crumb.id ? crumb.name : t(crumb.name)}</span>
                  </button>
                  {index < crumbs.length - 1 ? <ChevronRight data-icon="inline-end" className="mx-1 size-4 text-muted-foreground" aria-hidden="true" /> : null}
                </span>
              ))}
            </nav>
            <input ref={uploadInput} type="file" multiple className="hidden" aria-label="Upload files" onChange={(event) => void upload(event.target.files)} />
            <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => uploadInput.current?.click()}>
              {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="ps-8" placeholder="Search files" aria-label="Search files" />
          </div>

          <div className="min-h-72 flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-2" aria-label="File library">
            {query.isLoading ? <div className="grid min-h-64 place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />Loading files…</span></div> : null}
            {query.isError ? <div className="grid min-h-64 place-items-center p-6 text-center"><div><File className="mx-auto mb-2 size-7 text-muted-foreground" /><p className="text-sm font-medium">Files could not be loaded</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>Try again</Button></div></div> : null}
            {!query.isLoading && !query.isError && visibleItems.length ? <div className="grid gap-2 sm:grid-cols-2">
              {visibleItems.map((item) => item.kind === 'folder' ? (
                <button key={item.id} type="button" className="flex min-w-0 items-center gap-3 rounded-md border bg-card p-3 text-start outline-none transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openFolder(item)} aria-label={`${t('Open folder')} ${item.name}`}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400"><Folder className="size-5" /></span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium" translate="no">{item.name}</strong><span className="text-xs text-muted-foreground">Folder</span></span>
                  <ChevronRight data-icon="inline-end" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              ) : (
                <label key={item.id} className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${selectedIds.includes(item.id) ? 'border-primary bg-primary/5' : 'bg-card hover:border-primary/40'}`}>
                  <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={(checked) => toggleFile(item.id, Boolean(checked))} aria-label={`${t('Select')} ${item.name}`} />
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><LibraryFileIcon item={item} /></span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium" translate="no">{item.name}</strong><span className="text-xs text-muted-foreground">{formatSize(item.size)}</span></span>
                </label>
              ))}
            </div> : null}
            {!query.isLoading && !query.isError && !visibleItems.length ? <div className="grid min-h-64 place-items-center p-6 text-center text-sm text-muted-foreground"><div><Folder className="mx-auto mb-2 size-7" /><p className="font-medium text-foreground">{search ? 'No matching files' : 'No files in this folder'}</p><p className="mt-1">{search ? 'Try a different search.' : 'Upload a file here or return to another folder.'}</p></div></div> : null}
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-4 sm:justify-between">
          <span className="self-center text-xs text-muted-foreground">{selectedIds.length} {selectedIds.length === 1 ? 'file selected' : 'files selected'}</span>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancel</Button><Button type="button" onClick={confirmSelection}>Use selected files</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LibraryFileIcon({ item }: { item: LibraryAsset }) {
  if (item.mime_type?.startsWith('image/')) return <FileImage className="size-5" />
  if (item.mime_type?.includes('pdf') || item.mime_type?.startsWith('text/')) return <FileText className="size-5" />
  if (item.mime_type?.includes('zip')) return <FileArchive className="size-5" />
  return <File className="size-5" />
}

function formatSize(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, File, FileArchive, FileImage, FileText, Folder, FolderPlus, Grid2X2, List, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api, get, patch, post, remove } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { shortDate } from '@/lib/format'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type Asset = { id: string; parent_id: string | null; kind: 'file' | 'folder'; name: string; storage_name?: string; mime_type?: string; size: number; created_at: string; updated_at: string }
type Crumb = { id: string | null; name: string }

export default function FilesPage() {
  const { brand } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: 'All files' }])
  const [view, setView] = useState('grid')
  const [folderOpen, setFolderOpen] = useState(false)
  const [rename, setRename] = useState<Asset | null>(null)
  const parentId = crumbs.at(-1)?.id ?? null
  const query = useQuery({ queryKey: ['files', brand?.id, parentId], queryFn: () => get<Asset[]>(`/api/brands/${brand?.id}/files${parentId ? `?parentId=${parentId}` : ''}`), enabled: !!brand })

  async function upload(files: FileList | null) {
    if (!files?.length) return
    const data = new FormData()
    for (const file of files) data.append('files', file)
    if (parentId) data.set('parent_id', parentId)
    await api(`/api/brands/${brand?.id}/files/upload`, { method: 'POST', body: data })
    await query.refetch()
    toast.success(`${files.length} file${files.length === 1 ? '' : 's'} uploaded`)
  }
  function openFolder(item: Asset) { setCrumbs((current) => [...current, { id: item.id, name: item.name }]) }
  async function deleteItem(item: Asset) { await remove(`/api/brands/${brand?.id}/files/${item.id}`); await query.refetch(); toast.success(`${item.kind === 'folder' ? 'Folder' : 'File'} deleted`) }

  return <>
    <PageHeader eyebrow={brand?.name} eyebrowTranslatable={false} title="Files" description="A shared library for campaign images, downloads, and attachments." actions={<><input ref={input} className="hidden" type="file" multiple onChange={(event) => void upload(event.target.files)} /><Button variant="outline" onClick={() => setFolderOpen(true)}><FolderPlus /> New folder</Button><Button onClick={() => input.current?.click()}><Upload /> Upload</Button></>} />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav className="flex items-center text-sm" aria-label="File location">{crumbs.map((crumb, index) => <span key={crumb.id ?? 'root'} className="flex items-center"><button className={index === crumbs.length - 1 ? 'font-medium' : 'text-muted-foreground hover:text-foreground'} onClick={() => setCrumbs((current) => current.slice(0, index + 1))}>{crumb.name}</button>{index < crumbs.length - 1 && <ChevronRight className="mx-1 size-4 text-muted-foreground" />}</span>)}</nav>
      <ToggleGroup value={[view]} onValueChange={(values) => values[0] && setView(values[0])} aria-label="File view"><ToggleGroupItem value="grid" aria-label="Grid view"><Grid2X2 /></ToggleGroupItem><ToggleGroupItem value="list" aria-label="List view"><List /></ToggleGroupItem></ToggleGroup>
    </div>
    {view === 'grid' ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{query.data?.map((item) => <Card key={item.id} className="group overflow-hidden"><button className="flex aspect-[4/2.4] w-full items-center justify-center bg-muted/50" onClick={() => item.kind === 'folder' && openFolder(item)}>{item.kind === 'folder' ? <Folder className="size-14 fill-amber-100 text-amber-500" /> : <AssetIcon item={item} large />}</button><CardContent className="flex items-center gap-2 p-3"><button className="min-w-0 flex-1 text-start" onClick={() => item.kind === 'folder' && openFolder(item)}><p className="truncate text-sm font-medium" translate="no">{item.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.kind === 'folder' ? 'Folder' : size(item.size)} · {shortDate(item.updated_at)}</p></button><AssetMenu item={item} onRename={() => setRename(item)} onDelete={() => void deleteItem(item)} /></CardContent></Card>)}</div> : <div className="data-grid"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Size</TableHead><TableHead>Modified</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{query.data?.map((item) => <TableRow key={item.id}><TableCell><button className="flex items-center gap-3 font-medium" onClick={() => item.kind === 'folder' && openFolder(item)}><AssetIcon item={item} /><span translate="no">{item.name}</span></button></TableCell><TableCell className="capitalize text-muted-foreground">{item.mime_type || item.kind}</TableCell><TableCell>{item.kind === 'folder' ? '—' : size(item.size)}</TableCell><TableCell>{shortDate(item.updated_at)}</TableCell><TableCell><AssetMenu item={item} onRename={() => setRename(item)} onDelete={() => void deleteItem(item)} /></TableCell></TableRow>)}</TableBody></Table></div>}
    {!query.isLoading && !query.data?.length && <button onClick={() => input.current?.click()} className="mt-4 grid min-h-64 w-full place-items-center rounded-xl border border-dashed bg-card text-center"><span><Upload className="mx-auto mb-3 size-8 text-muted-foreground" /><strong className="block">Upload your first file</strong><span className="mt-1 block text-sm text-muted-foreground">Images, documents, archives, and campaign attachments up to 25 MB.</span></span></button>}
    <NameDialog open={folderOpen} onOpenChange={setFolderOpen} title="Create folder" initial="Campaign assets" action="Create folder" onSave={async (name) => { await post(`/api/brands/${brand?.id}/files/folder`, { name, parent_id: parentId }); setFolderOpen(false); await query.refetch() }} />
    <NameDialog open={!!rename} onOpenChange={(open) => !open && setRename(null)} title={`Rename ${rename?.kind ?? 'item'}`} initial={rename?.name ?? ''} action="Save name" onSave={async (name) => { if (!rename) return; await patch(`/api/brands/${brand?.id}/files/${rename.id}`, { name }); setRename(null); await query.refetch() }} />
  </>
}

function AssetMenu({ item, onRename, onDelete }: { item: Asset; onRename: () => void; onDelete: () => void }) { return <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onRename}><Pencil />Rename</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu> }
function AssetIcon({ item, large = false }: { item: Asset; large?: boolean }) { const className = large ? 'size-14 text-primary/65' : 'size-5 text-primary/70'; if (item.kind === 'folder') return <Folder className={className} />; if (item.mime_type?.startsWith('image/')) return <FileImage className={className} />; if (item.mime_type?.includes('pdf') || item.mime_type?.includes('text')) return <FileText className={className} />; if (item.mime_type?.includes('zip')) return <FileArchive className={className} />; return <File className={className} /> }
function size(bytes: number) { if (!bytes) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
function NameDialog({ open, onOpenChange, title, initial, action, onSave }: { open: boolean; onOpenChange: (value: boolean) => void; title: string; initial: string; action: string; onSave: (name: string) => Promise<void> }) { const [name, setName] = useState(initial); return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Names are shown to everyone with access to this brand.</DialogDescription></DialogHeader><div><Label>Name</Label><Input className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} autoFocus /></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!name.trim()} onClick={() => void onSave(name.trim())}>{action}</Button></DialogFooter></DialogContent></Dialog> }

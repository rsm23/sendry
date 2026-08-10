import { ZipArchive, type ArchiverError } from 'archiver'
import { compare, hash } from 'bcryptjs'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import type { AppConfig } from './config'
import { audit, tokenHash, type AppDatabase } from './db'
import { MediaStorage } from './multichannel/storage'
import { nowIso } from './serialize'

export type FileRole = 'viewer' | 'commenter' | 'editor' | 'manager'
type FileRow = Record<string, unknown> & {
  id: string
  brand_id: string
  parent_id: string | null
  kind: 'file' | 'folder'
  name: string
  created_by: string | null
  visibility: string
  inherit_permissions: number
  current_version_id: string | null
  trashed_at: string | null
}

const roleWeight: Record<FileRole, number> = { viewer: 1, commenter: 2, editor: 3, manager: 4 }
const publicAttempts = new Map<string, { count: number; resetAt: number }>()
const route = (request: Request, key: string) => String(request.params[key] ?? '')
const fileId = () => `fil_${randomUUID().replaceAll('-', '')}`
const versionId = () => `ver_${randomUUID().replaceAll('-', '')}`
const entityId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`

function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next)
}

function parsePermissions(value: string) {
  try { return new Set(JSON.parse(value) as string[]) } catch { return new Set<string>() }
}

function brandMembership(db: AppDatabase, request: Request, brandId: string) {
  if (request.authKind === 'api') {
    const brand = db.prepare('SELECT id FROM brands WHERE id=? AND workspace_id=?').get(brandId, request.apiWorkspaceId)
    return brand ? { userId: null, manager: request.apiScopes?.includes('*') || request.apiScopes?.includes('settings') || request.apiScopes?.includes('files'), files: request.apiScopes?.includes('*') || request.apiScopes?.includes('files') } : null
  }
  const member = db.prepare('SELECT role,permissions FROM brand_members WHERE brand_id=? AND user_id=?').get(brandId, request.authUser?.id) as { role: string; permissions: string } | undefined
  if (!member || !request.authUser) return null
  const permissions = parsePermissions(member.permissions)
  return {
    userId: request.authUser.id,
    manager: member.role === 'owner' || permissions.has('*') || permissions.has('settings'),
    files: permissions.has('*') || permissions.has('files') || member.role === 'owner',
  }
}

function inheritedPermission(db: AppDatabase, file: FileRow, userId: string) {
  const rows = db.prepare(`WITH RECURSIVE lineage(id,parent_id,inherit_permissions,depth) AS (
    SELECT id,parent_id,inherit_permissions,0 FROM files WHERE id=?
    UNION ALL SELECT f.id,f.parent_id,f.inherit_permissions,lineage.depth+1 FROM files f JOIN lineage ON lineage.parent_id=f.id WHERE lineage.inherit_permissions=1
  ) SELECT fp.role,lineage.depth FROM lineage JOIN file_permissions fp ON fp.file_id=lineage.id WHERE fp.user_id=? ORDER BY lineage.depth LIMIT 1`).all(file.id, userId) as Array<{ role: FileRole; depth: number }>
  return rows[0]?.role
}

export function effectiveFileRole(db: AppDatabase, request: Request, file: FileRow): FileRole | null {
  const membership = brandMembership(db, request, file.brand_id)
  if (!membership) return null
  if (membership.manager || (membership.userId && file.created_by === membership.userId)) return 'manager'
  if (membership.userId) {
    const assigned = inheritedPermission(db, file, membership.userId)
    if (assigned) return assigned
  }
  if (file.visibility === 'brand' && membership.files) return 'editor'
  return null
}

export function userCanAccessFile(db: AppDatabase, userId: string, requestedFileId: string) {
  const file = db.prepare('SELECT * FROM files WHERE id=?').get(requestedFileId) as FileRow | undefined
  if (!file) return false
  const request = { authKind: 'session', authUser: { id: userId } } as unknown as Request
  return Boolean(effectiveFileRole(db, request, file))
}

function requireRole(db: AppDatabase, request: Request, response: Response, minimum: FileRole) {
  const file = db.prepare('SELECT * FROM files WHERE id=? AND brand_id=?').get(route(request, 'fileId'), route(request, 'brandId')) as FileRow | undefined
  if (!file) { response.status(404).json({ error: 'File not found' }); return null }
  const role = effectiveFileRole(db, request, file)
  if (!role || roleWeight[role] < roleWeight[minimum]) { response.status(403).json({ error: 'File access denied' }); return null }
  return { file, role }
}

function preview(file: Record<string, unknown>, config: AppConfig) {
  if (file.kind === 'folder') return { preview_kind: 'folder', preview_reason: null }
  const mime = String(file.version_mime_type ?? file.mime_type ?? '').toLowerCase()
  const name = String(file.name).toLowerCase()
  const size = Number(file.version_size ?? file.size ?? 0)
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return { preview_kind: 'pdf', preview_reason: null }
  if (mime.startsWith('image/') && !mime.includes('tiff')) return { preview_kind: 'image', preview_reason: null }
  if (mime.startsWith('video/') || /\.(mp4|m4v|mov|webm|ogv|ogg)$/.test(name)) return { preview_kind: 'video', preview_reason: null }
  const office = name.endsWith('.docx') ? 'docx' : name.endsWith('.pptx') ? 'pptx' : /\.(xlsx|xls|csv|ods)$/.test(name) ? 'sheet' : null
  if (office) return size <= config.fileOfficePreviewMaxBytes ? { preview_kind: office, preview_reason: null } : { preview_kind: 'unsupported', preview_reason: 'Office preview exceeds the configured 50 MB browser limit.' }
  if (/\.(doc|ppt)$/.test(name)) return { preview_kind: 'unsupported', preview_reason: 'Legacy Word and PowerPoint files can be downloaded but are not previewed.' }
  const code = mime.startsWith('text/') || /\.(txt|log|json|xml|ya?ml|html?|css|jsx?|tsx?|php|py|sql|md)$/.test(name)
  if (code) return size <= config.fileCodePreviewMaxBytes ? { preview_kind: 'code', preview_reason: null } : { preview_kind: 'unsupported', preview_reason: 'Text preview exceeds the configured 5 MB browser limit.' }
  return { preview_kind: 'unsupported', preview_reason: 'This file type does not have a safe browser preview.' }
}

function decorate(db: AppDatabase, request: Request, config: AppConfig, row: FileRow) {
  const version = row.current_version_id ? db.prepare('SELECT * FROM file_versions WHERE id=?').get(row.current_version_id) as Record<string, unknown> | undefined : undefined
  const starred = request.authUser ? Boolean(db.prepare('SELECT 1 FROM file_stars WHERE file_id=? AND user_id=?').get(row.id, request.authUser.id)) : false
  const comments = db.prepare("SELECT COUNT(*) count FROM file_comments WHERE file_id=? AND (visibility='team' OR author_id=?)").get(row.id, request.authUser?.id ?? '') as { count: number }
  const shares = db.prepare("SELECT COUNT(*) count FROM file_share_links WHERE file_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)").get(row.id, nowIso()) as { count: number }
  const creator = row.created_by ? db.prepare('SELECT id,name,email FROM users WHERE id=?').get(row.created_by) : null
  return {
    ...row,
    current_version: version ?? null,
    effective_role: effectiveFileRole(db, request, row),
    starred,
    shared: shares.count > 0 || row.visibility === 'restricted',
    comment_count: comments.count,
    creator,
    ...preview({ ...row, version_mime_type: version?.mime_type, version_size: version?.size }, config),
  }
}

function breadcrumbs(db: AppDatabase, file: FileRow) {
  const rows = db.prepare(`WITH RECURSIVE lineage(id,parent_id,name,depth) AS (
    SELECT id,parent_id,name,0 FROM files WHERE id=?
    UNION ALL SELECT f.id,f.parent_id,f.name,lineage.depth+1 FROM files f JOIN lineage ON lineage.parent_id=f.id
  ) SELECT id,name,depth FROM lineage ORDER BY depth DESC`).all(file.id) as Array<{ id: string; name: string; depth: number }>
  return rows.map(({ id, name }) => ({ id, name }))
}

function hasTrashedAncestor(db: AppDatabase, file: FileRow) {
  return Boolean(db.prepare(`WITH RECURSIVE parents(id,parent_id,trashed_at) AS (
    SELECT id,parent_id,trashed_at FROM files WHERE id=? UNION ALL SELECT f.id,f.parent_id,f.trashed_at FROM files f JOIN parents p ON p.parent_id=f.id
  ) SELECT 1 FROM parents WHERE id<>? AND trashed_at IS NOT NULL LIMIT 1`).get(file.id, file.id))
}

function notify(db: AppDatabase, userId: string, brandId: string, kind: string, title: string, detail: string, path: string) {
  db.prepare('INSERT INTO notifications (id,user_id,brand_id,kind,title,detail,path,created_at) VALUES (?,?,?,?,?,?,?,?)').run(entityId('ntf'), userId, brandId, kind, title, detail, path, nowIso())
}

function auditFile(db: AppDatabase, request: Request, action: string, file: FileRow, metadata: unknown = {}) {
  audit(db, action, 'file', file.id, request.authUser?.id, file.brand_id, metadata)
}

function contentVersion(db: AppDatabase, file: FileRow, requested?: string) {
  return db.prepare('SELECT * FROM file_versions WHERE file_id=? AND id=?').get(file.id, requested || file.current_version_id) as Record<string, unknown> | undefined
}

type ArchiveEntry = { file: FileRow; path: string; version?: Record<string, unknown> }

function safeArchiveSegment(value: string) {
  const safe = value.normalize('NFC').replace(/[\\/\0]/g, '_').trim()
  return !safe || safe === '.' || safe === '..' ? 'untitled' : safe
}

function uniqueArchivePath(preferred: string, claimed: Set<string>) {
  let candidate = preferred
  let index = 2
  while (claimed.has(candidate.toLocaleLowerCase())) {
    const separator = preferred.lastIndexOf('/')
    const directory = separator >= 0 ? preferred.slice(0, separator + 1) : ''
    const name = separator >= 0 ? preferred.slice(separator + 1) : preferred
    const extension = name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')) : ''
    const stem = extension ? name.slice(0, -extension.length) : name
    candidate = `${directory}${stem} (${index})${extension}`
    index += 1
  }
  claimed.add(candidate.toLocaleLowerCase())
  return candidate
}

function archiveEntries(db: AppDatabase, roots: FileRow[], canInclude: (file: FileRow) => boolean, inheritedOnly = false) {
  const entries: ArchiveEntry[] = []
  const claimed = new Set<string>()
  for (const root of roots) {
    const rows = db.prepare(`WITH RECURSIVE descendants AS (
      SELECT f.*,0 AS depth FROM files f WHERE f.id=? AND f.trashed_at IS NULL
      UNION ALL
      SELECT f.*,d.depth+1 FROM files f JOIN descendants d ON f.parent_id=d.id
      WHERE f.trashed_at IS NULL${inheritedOnly ? ' AND f.inherit_permissions=1' : ''}
    ) SELECT * FROM descendants ORDER BY depth,kind DESC,name,id`).all(root.id) as Array<FileRow & { depth: number }>
    const paths = new Map<string, string>()
    const included = new Set<string>()
    for (const row of rows) {
      if (row.id !== root.id && row.parent_id && !included.has(row.parent_id)) continue
      if (!canInclude(row)) continue
      const parentPath = row.id === root.id ? '' : paths.get(row.parent_id ?? '') ?? ''
      const preferred = parentPath ? `${parentPath}/${safeArchiveSegment(row.name)}` : safeArchiveSegment(row.name)
      const path = uniqueArchivePath(preferred, claimed)
      paths.set(row.id, path)
      included.add(row.id)
      entries.push({ file: row, path, version: row.kind === 'file' ? contentVersion(db, row) : undefined })
      if (entries.length > 10_000) throw new Error('Folder archive exceeds the 10,000 item limit')
    }
  }
  return entries
}

function objectDownloadStream(storage: MediaStorage, storageKey: string) {
  return Readable.from((async function* () {
    const result = await fetch(await storage.signedDownload(storageKey))
    if (!result.ok || !result.body) throw new Error('Stored file bytes are unavailable')
    for await (const chunk of Readable.fromWeb(result.body as never)) yield chunk
  })())
}

async function streamArchive(storage: MediaStorage, config: AppConfig, entries: ArchiveEntry[], response: Response, filename: string) {
  response.setHeader('Cache-Control', 'private, no-store')
  response.attachment(`${safeArchiveSegment(filename)}.zip`)
  const zip = new ZipArchive({ zlib: { level: 6 } })
  zip.on('warning', (error: ArchiverError) => response.destroy(error))
  zip.on('error', (error: ArchiverError) => response.destroy(error))
  zip.pipe(response)
  for (const entry of entries) {
    if (entry.file.kind === 'folder') {
      zip.append(Buffer.alloc(0), { name: `${entry.path}/` })
      continue
    }
    if (!entry.version) continue
    const backend = String(entry.version.storage_backend)
    const key = String(entry.version.storage_key)
    if (backend === 'object') zip.append(objectDownloadStream(storage, key), { name: entry.path })
    else {
      const path = backend === 'legacy' ? join(config.uploadDir, basename(key)) : storage.localPath(key)
      if (existsSync(path)) zip.file(path, { name: entry.path })
    }
  }
  await zip.finalize()
}

async function sendContent(storage: MediaStorage, config: AppConfig, file: FileRow, version: Record<string, unknown>, response: Response, download = false) {
  const backend = String(version.storage_backend)
  const key = String(version.storage_key)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  response.setHeader('Cache-Control', 'private, no-store')
  response.setHeader('Content-Type', String(version.mime_type || 'application/octet-stream'))
  response.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
  if (backend === 'object') return response.redirect(302, await storage.signedDownload(key))
  const path = backend === 'legacy' ? join(config.uploadDir, basename(key)) : storage.localPath(key)
  if (!existsSync(path)) return response.status(404).json({ error: 'Stored file bytes are unavailable' })
  return response.sendFile(path)
}

export function createFilesRouter(db: AppDatabase, config: AppConfig) {
  const router = Router({ mergeParams: true })
  const storage = new MediaStorage(config)
  const quarantine = join(config.uploadDir, '.quarantine')
  mkdirSync(quarantine, { recursive: true })
  const upload = multer({ dest: quarantine, limits: { fileSize: config.fileLibraryMaxBytes, files: 25 } })

  router.use((request, response, next) => {
    if (!request.authUser && request.authKind !== 'api') return response.status(401).json({ error: 'Authentication required' })
    if (!brandMembership(db, request, route(request, 'brandId'))) return response.status(403).json({ error: 'Brand access denied' })
    next()
  })

  router.get('/', (request, response) => {
    const brandId = route(request, 'brandId')
    const view = String(request.query.view ?? 'all')
    const q = String(request.query.q ?? '').trim()
    const type = String(request.query.type ?? '')
    const owner = String(request.query.owner ?? '')
    const parentId = request.query.parentId ? String(request.query.parentId) : null
    const sort = ['name', 'updated_at', 'size', 'created_at'].includes(String(request.query.sort)) ? String(request.query.sort) : 'name'
    const direction = request.query.direction === 'desc' ? 'DESC' : 'ASC'
    const limit = Math.min(Math.max(Number(request.query.limit ?? 100), 1), 200)
    const offset = Math.max(Number(Buffer.from(String(request.query.cursor ?? ''), 'base64url').toString('utf8') || 0), 0)
    let sql = 'SELECT DISTINCT f.* FROM files f'
    const where = ['f.brand_id=?']
    const values: unknown[] = [brandId]
    if (view === 'starred') { sql += ' JOIN file_stars fs ON fs.file_id=f.id'; where.push('fs.user_id=?'); values.push(request.authUser?.id ?? '') }
    if (view === 'shared') { sql += ' LEFT JOIN file_share_links sl ON sl.file_id=f.id AND sl.revoked_at IS NULL'; where.push("(f.visibility='restricted' OR sl.id IS NOT NULL)") }
    if (view === 'trash') where.push('f.trashed_at IS NOT NULL')
    else where.push('f.trashed_at IS NULL')
    if (q) { where.push('f.name LIKE ? ESCAPE \'\\\' COLLATE NOCASE'); values.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`) }
    else if (view === 'all') { where.push('f.parent_id IS ?'); values.push(parentId) }
    if (type === 'folder') where.push("f.kind='folder'")
    else if (type === 'image') where.push("f.mime_type LIKE 'image/%'")
    else if (type === 'document') where.push("(f.mime_type LIKE 'text/%' OR f.mime_type LIKE '%pdf%' OR f.name LIKE '%.docx')")
    else if (type === 'spreadsheet') where.push("(f.name LIKE '%.xlsx' OR f.name LIKE '%.xls' OR f.name LIKE '%.csv' OR f.name LIKE '%.ods')")
    else if (type === 'presentation') where.push("f.name LIKE '%.pptx'")
    if (owner) { where.push('f.created_by=?'); values.push(owner) }
    if (view === 'recent') sql += ''
    sql += ` WHERE ${where.join(' AND ')} ORDER BY f.kind DESC, f.${sort} ${direction}, f.id ${direction} LIMIT ? OFFSET ?`
    values.push(limit + 1, offset)
    const raw = db.prepare(sql).all(...values) as FileRow[]
    const visible = raw.filter((file) => effectiveFileRole(db, request, file) && (view === 'trash' || !hasTrashedAncestor(db, file)))
    const page = visible.slice(0, limit).map((file) => decorate(db, request, config, file))
    if (visible.length > limit) response.setHeader('X-Next-Cursor', Buffer.from(String(offset + limit)).toString('base64url'))
    response.json(page)
  })

  router.get('/preferences', (request, response) => {
    const row = request.authUser ? db.prepare('SELECT * FROM file_view_preferences WHERE brand_id=? AND user_id=?').get(route(request, 'brandId'), request.authUser.id) : null
    response.json(row ?? { view_mode: 'list', sort_key: 'name', sort_direction: 'asc', details_width: 360 })
  })

  router.patch('/preferences', (request, response) => {
    if (!request.authUser) return response.status(403).json({ error: 'User preferences require a member session' })
    const value = z.object({ view_mode: z.enum(['grid', 'list', 'compact']), sort_key: z.enum(['name', 'updated_at', 'size', 'created_at']), sort_direction: z.enum(['asc', 'desc']), details_width: z.number().int().min(280).max(640).default(360) }).parse(request.body)
    db.prepare(`INSERT INTO file_view_preferences (brand_id,user_id,view_mode,sort_key,sort_direction,details_width,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(brand_id,user_id) DO UPDATE SET view_mode=excluded.view_mode,sort_key=excluded.sort_key,sort_direction=excluded.sort_direction,details_width=excluded.details_width,updated_at=excluded.updated_at`).run(route(request, 'brandId'), request.authUser.id, value.view_mode, value.sort_key, value.sort_direction, value.details_width, nowIso())
    response.json(value)
  })

  router.get('/notifications', (request, response) => {
    if (!request.authUser) return response.json([])
    response.json(db.prepare('SELECT * FROM notifications WHERE brand_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50').all(route(request, 'brandId'), request.authUser.id))
  })

  router.post('/notifications/read', (request, response) => {
    if (!request.authUser) return response.status(403).json({ error: 'Member session required' })
    const ids = z.object({ ids: z.array(z.string()).optional() }).parse(request.body).ids
    if (ids?.length) {
      const placeholders = ids.map(() => '?').join(',')
      db.prepare(`UPDATE notifications SET read_at=? WHERE user_id=? AND brand_id=? AND id IN (${placeholders})`).run(nowIso(), request.authUser.id, route(request, 'brandId'), ...ids)
    } else db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND brand_id=? AND read_at IS NULL').run(nowIso(), request.authUser.id, route(request, 'brandId'))
    response.status(204).end()
  })

  router.post('/folder', (request, response) => {
    const value = z.object({ name: z.string().trim().min(1).max(255), parent_id: z.string().nullable().default(null), color: z.string().nullable().optional() }).parse(request.body)
    if (value.parent_id) {
      const parent = db.prepare("SELECT * FROM files WHERE id=? AND brand_id=? AND kind='folder' AND trashed_at IS NULL").get(value.parent_id, route(request, 'brandId')) as FileRow | undefined
      if (!parent) return response.status(404).json({ error: 'Parent folder not found' })
      const role = effectiveFileRole(db, request, parent)
      if (!role || roleWeight[role] < roleWeight.editor) return response.status(403).json({ error: 'Editor access is required' })
    }
    const id = fileId()
    const now = nowIso()
    db.prepare('INSERT INTO files (id,brand_id,parent_id,kind,name,color,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, route(request, 'brandId'), value.parent_id, 'folder', basename(value.name), value.color ?? null, request.authUser?.id ?? null, now, now)
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(id) as FileRow
    auditFile(db, request, 'create_folder', file)
    response.status(201).json(decorate(db, request, config, file))
  })

  router.post('/upload', upload.array('files', 25), asyncRoute(async (request, response) => {
    const parentId = request.body.parent_id ? String(request.body.parent_id) : null
    const incoming = (request.files ?? []) as Express.Multer.File[]
    if (parentId) {
      const parent = db.prepare("SELECT * FROM files WHERE id=? AND brand_id=? AND kind='folder' AND trashed_at IS NULL").get(parentId, route(request, 'brandId')) as FileRow | undefined
      const role = parent && effectiveFileRole(db, request, parent)
      if (!parent || !role || roleWeight[role] < roleWeight.editor) {
        for (const file of incoming) unlinkSync(file.path)
        return response.status(parent ? 403 : 404).json({ error: parent ? 'Editor access is required' : 'Parent folder not found' })
      }
    }
    const created: unknown[] = []
    const rejected: Array<{ name: string; error: string }> = []
    for (const uploadFile of incoming) {
      try {
        const promoted = await storage.promote({ path: uploadFile.path, brandId: route(request, 'brandId'), originalName: basename(uploadFile.originalname), declaredMime: uploadFile.mimetype, maxSize: config.fileLibraryMaxBytes, policy: 'library' })
        const id = fileId(), version = versionId(), now = nowIso()
        db.transaction(() => {
          db.prepare('INSERT INTO files (id,brand_id,parent_id,kind,name,storage_name,mime_type,size,created_by,current_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, route(request, 'brandId'), parentId, 'file', basename(uploadFile.originalname), promoted.storage_key, promoted.mime_type, promoted.size, request.authUser?.id ?? null, version, now, now)
          db.prepare('INSERT INTO file_versions (id,file_id,version_number,storage_backend,storage_key,original_name,mime_type,size,sha256,scan_state,scan_detail,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(version, id, 1, promoted.storage_backend, promoted.storage_key, basename(uploadFile.originalname), promoted.mime_type, promoted.size, promoted.sha256, 'available', promoted.scan, request.authUser?.id ?? null, now)
        })()
        const file = db.prepare('SELECT * FROM files WHERE id=?').get(id) as FileRow
        auditFile(db, request, 'upload', file, { version: 1, sha256: promoted.sha256 })
        created.push(decorate(db, request, config, file))
      } catch (error) {
        unlinkSync(uploadFile.path)
        rejected.push({ name: basename(uploadFile.originalname), error: error instanceof Error ? error.message : 'Upload rejected' })
      }
    }
    if (rejected.length) response.setHeader('X-Rejected-Files', Buffer.from(JSON.stringify(rejected)).toString('base64url'))
    if (!created.length && rejected.length) return response.status(422).json({ error: rejected[0].error, rejected })
    response.status(201).json(created)
  }))

  router.post('/bulk', asyncRoute(async (request, response) => {
    const value = z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(['trash', 'restore', 'star', 'unstar', 'move', 'copy']), parent_id: z.string().nullable().optional() }).parse(request.body)
    const results: Array<{ id: string; ok: boolean; error?: string }> = []
    for (const id of value.ids) {
      const file = db.prepare('SELECT * FROM files WHERE id=? AND brand_id=?').get(id, route(request, 'brandId')) as FileRow | undefined
      const role = file && effectiveFileRole(db, request, file)
      if (!file || !role || (['trash', 'restore', 'move', 'copy'].includes(value.action) && roleWeight[role] < roleWeight.editor)) { results.push({ id, ok: false, error: 'Access denied' }); continue }
      if (!request.authUser && ['star', 'unstar'].includes(value.action)) { results.push({ id, ok: false, error: 'Member session required' }); continue }
      const now = nowIso()
      if (value.action === 'trash') db.prepare('UPDATE files SET original_parent_id=parent_id,trashed_at=?,trashed_by=?,updated_at=? WHERE id=?').run(now, request.authUser?.id ?? null, now, id)
      if (value.action === 'restore') {
        const original = file.original_parent_id ? db.prepare("SELECT id FROM files WHERE id=? AND brand_id=? AND kind='folder' AND trashed_at IS NULL").get(file.original_parent_id, file.brand_id) : null
        db.prepare('UPDATE files SET parent_id=?,trashed_at=NULL,trashed_by=NULL,updated_at=? WHERE id=?').run(original ? file.original_parent_id : null, now, id)
      }
      if (value.action === 'star') db.prepare('INSERT OR IGNORE INTO file_stars (file_id,user_id,created_at) VALUES (?,?,?)').run(id, request.authUser!.id, now)
      if (value.action === 'unstar') db.prepare('DELETE FROM file_stars WHERE file_id=? AND user_id=?').run(id, request.authUser!.id)
      if (value.action === 'move') {
        if (value.parent_id === id || (value.parent_id && db.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM files WHERE parent_id=? UNION ALL SELECT f.id FROM files f JOIN descendants d ON f.parent_id=d.id) SELECT 1 FROM descendants WHERE id=?`).get(id, value.parent_id))) { results.push({ id, ok: false, error: 'A folder cannot be moved into itself' }); continue }
        db.prepare('UPDATE files SET parent_id=?,updated_at=? WHERE id=?').run(value.parent_id ?? null, now, id)
      }
      if (value.action === 'copy') {
        const copyId = fileId()
        const copyVersion = file.current_version_id ? db.prepare('SELECT * FROM file_versions WHERE id=?').get(file.current_version_id) as Record<string, unknown> : null
        db.prepare(`INSERT INTO files (id,brand_id,parent_id,kind,name,storage_name,mime_type,size,description,color,created_by,visibility,inherit_permissions,current_version_id,created_at,updated_at)
          SELECT ?,brand_id,?,kind,?,storage_name,mime_type,size,description,color,?,'brand',1,?, ?,? FROM files WHERE id=?`).run(copyId, value.parent_id ?? file.parent_id, `${file.name} copy`, request.authUser?.id ?? null, copyVersion ? versionId() : null, now, now, id)
        const copied = db.prepare('SELECT * FROM files WHERE id=?').get(copyId) as FileRow
        if (copyVersion && copied.current_version_id) db.prepare('INSERT INTO file_versions (id,file_id,version_number,storage_backend,storage_key,original_name,mime_type,size,sha256,scan_state,scan_detail,created_by,created_at) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?)').run(copied.current_version_id, copyId, copyVersion.storage_backend, copyVersion.storage_key, copyVersion.original_name, copyVersion.mime_type, copyVersion.size, copyVersion.sha256, copyVersion.scan_state, 'Copied from immutable storage object', request.authUser?.id ?? null, now)
        auditFile(db, request, 'copy', copied, { source_id: id })
      } else auditFile(db, request, value.action, file, { parent_id: value.parent_id })
      results.push({ id, ok: true })
    }
    response.json({ results })
  }))

  router.get('/bulk/download', asyncRoute(async (request, response) => {
    const ids = String(request.query.ids ?? '').split(',').filter(Boolean).slice(0, 100)
    if (!ids.length) return response.status(422).json({ error: 'Select at least one item' })
    const roots: FileRow[] = []
    for (const id of ids) {
      const file = db.prepare('SELECT * FROM files WHERE id=? AND brand_id=? AND trashed_at IS NULL').get(id, route(request, 'brandId')) as FileRow | undefined
      const role = file && effectiveFileRole(db, request, file)
      if (file && role) roots.push(file)
    }
    if (!roots.length) return response.status(404).json({ error: 'No accessible items were found' })
    const entries = archiveEntries(db, roots, (file) => Boolean(effectiveFileRole(db, request, file)))
    const filename = roots.length === 1 && roots[0].kind === 'folder' ? roots[0].name : 'sendry-files'
    for (const root of roots) auditFile(db, request, 'download_archive', root, { entries: entries.length })
    await streamArchive(storage, config, entries, response, filename)
  }))

  router.get('/:fileId', (request, response) => {
    const access = requireRole(db, request, response, 'viewer')
    if (!access) return
    response.json({ ...decorate(db, request, config, access.file), breadcrumbs: breadcrumbs(db, access.file) })
  })

  router.get('/:fileId/content', asyncRoute(async (request, response) => {
    const access = requireRole(db, request, response, 'viewer')
    if (!access || access.file.kind !== 'file') return
    const version = contentVersion(db, access.file, request.query.version ? String(request.query.version) : undefined)
    if (!version) return response.status(404).json({ error: 'File version not found' })
    await sendContent(storage, config, access.file, version, response, request.query.download === '1')
  }))

  router.patch('/:fileId', (request, response) => {
    const access = requireRole(db, request, response, 'editor')
    if (!access) return
    const value = z.object({ name: z.string().trim().min(1).max(255).optional(), parent_id: z.string().nullable().optional(), description: z.string().max(4000).optional(), color: z.string().nullable().optional(), visibility: z.enum(['brand', 'restricted']).optional(), inherit_permissions: z.boolean().optional(), starred: z.boolean().optional() }).parse(request.body)
    if (value.visibility !== undefined || value.inherit_permissions === false) {
      if (roleWeight[access.role] < roleWeight.manager) return response.status(403).json({ error: 'Manager access is required to change visibility or inheritance' })
    }
    if (value.parent_id !== undefined && (value.parent_id === access.file.id || (value.parent_id && db.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM files WHERE parent_id=? UNION ALL SELECT f.id FROM files f JOIN descendants d ON f.parent_id=d.id) SELECT 1 FROM descendants WHERE id=?`).get(access.file.id, value.parent_id)))) return response.status(409).json({ error: 'A folder cannot be moved into itself' })
    const updates: string[] = [], values: unknown[] = []
    for (const key of ['name', 'parent_id', 'description', 'color', 'visibility'] as const) if (value[key] !== undefined) { updates.push(`${key}=?`); values.push(key === 'name' ? basename(String(value[key])) : value[key]) }
    if (value.inherit_permissions !== undefined) { updates.push('inherit_permissions=?'); values.push(value.inherit_permissions ? 1 : 0) }
    if (updates.length) db.prepare(`UPDATE files SET ${updates.join(',')},updated_at=? WHERE id=?`).run(...values, nowIso(), access.file.id)
    if (value.starred !== undefined && request.authUser) {
      if (value.starred) db.prepare('INSERT OR IGNORE INTO file_stars (file_id,user_id,created_at) VALUES (?,?,?)').run(access.file.id, request.authUser.id, nowIso())
      else db.prepare('DELETE FROM file_stars WHERE file_id=? AND user_id=?').run(access.file.id, request.authUser.id)
    }
    auditFile(db, request, 'update', access.file, value)
    response.json(decorate(db, request, config, db.prepare('SELECT * FROM files WHERE id=?').get(access.file.id) as FileRow))
  })

  router.delete('/:fileId', (request, response) => {
    const access = requireRole(db, request, response, 'editor')
    if (!access) return
    const now = nowIso()
    db.prepare('UPDATE files SET original_parent_id=parent_id,trashed_at=?,trashed_by=?,updated_at=? WHERE id=?').run(now, request.authUser?.id ?? null, now, access.file.id)
    auditFile(db, request, 'trash', access.file)
    response.status(204).end()
  })

  router.post('/:fileId/restore', (request, response) => {
    const access = requireRole(db, request, response, 'editor')
    if (!access) return
    const parent = access.file.original_parent_id ? db.prepare("SELECT id FROM files WHERE id=? AND brand_id=? AND kind='folder' AND trashed_at IS NULL").get(access.file.original_parent_id, access.file.brand_id) : null
    db.prepare('UPDATE files SET parent_id=?,trashed_at=NULL,trashed_by=NULL,updated_at=? WHERE id=?').run(parent ? access.file.original_parent_id : null, nowIso(), access.file.id)
    auditFile(db, request, 'restore', access.file)
    response.json(decorate(db, request, config, db.prepare('SELECT * FROM files WHERE id=?').get(access.file.id) as FileRow))
  })

  router.delete('/:fileId/forever', asyncRoute(async (request, response) => {
    const access = requireRole(db, request, response, 'manager')
    if (!access || !access.file.trashed_at) return access ? response.status(409).json({ error: 'Move the item to Trash before deleting it forever' }) : undefined
    const versions = db.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM files WHERE id=? UNION ALL SELECT f.id FROM files f JOIN descendants d ON f.parent_id=d.id)
      SELECT v.storage_backend,v.storage_key FROM file_versions v JOIN descendants d ON d.id=v.file_id`).all(access.file.id) as Array<{ storage_backend: string; storage_key: string }>
    db.prepare('DELETE FROM files WHERE id=?').run(access.file.id)
    for (const version of versions) {
      const stillUsed = db.prepare('SELECT 1 FROM file_versions WHERE storage_backend=? AND storage_key=? LIMIT 1').get(version.storage_backend, version.storage_key)
      if (!stillUsed && version.storage_backend !== 'legacy') await storage.remove(version.storage_key)
      if (!stillUsed && version.storage_backend === 'legacy') { try { unlinkSync(join(config.uploadDir, basename(version.storage_key))) } catch { /* already removed */ } }
    }
    auditFile(db, request, 'delete_forever', access.file)
    response.status(204).end()
  }))

  router.get('/:fileId/versions', (request, response) => {
    const access = requireRole(db, request, response, 'viewer')
    if (!access) return
    response.json(db.prepare(`SELECT v.*,u.name creator_name FROM file_versions v LEFT JOIN users u ON u.id=v.created_by WHERE v.file_id=? ORDER BY v.version_number DESC`).all(access.file.id))
  })

  router.post('/:fileId/versions', upload.single('file'), asyncRoute(async (request, response) => {
    const access = requireRole(db, request, response, 'editor')
    const incoming = request.file
    if (!access || !incoming) { if (incoming) unlinkSync(incoming.path); return access ? response.status(422).json({ error: 'Choose a file' }) : undefined }
    try {
      const promoted = await storage.promote({ path: incoming.path, brandId: access.file.brand_id, originalName: basename(incoming.originalname), declaredMime: incoming.mimetype, maxSize: config.fileLibraryMaxBytes, policy: 'library' })
      const next = db.prepare('SELECT COALESCE(MAX(version_number),0)+1 number FROM file_versions WHERE file_id=?').get(access.file.id) as { number: number }
      const id = versionId(), now = nowIso()
      db.transaction(() => {
        db.prepare('INSERT INTO file_versions (id,file_id,version_number,storage_backend,storage_key,original_name,mime_type,size,sha256,scan_state,scan_detail,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, access.file.id, next.number, promoted.storage_backend, promoted.storage_key, basename(incoming.originalname), promoted.mime_type, promoted.size, promoted.sha256, 'available', promoted.scan, request.authUser?.id ?? null, now)
        db.prepare('UPDATE files SET current_version_id=?,storage_name=?,mime_type=?,size=?,updated_at=? WHERE id=?').run(id, promoted.storage_key, promoted.mime_type, promoted.size, now, access.file.id)
      })()
      auditFile(db, request, 'upload_version', access.file, { version: next.number })
      response.status(201).json(db.prepare('SELECT * FROM file_versions WHERE id=?').get(id))
    } catch (error) {
      unlinkSync(incoming.path)
      response.status(422).json({ error: error instanceof Error ? error.message : 'Version upload rejected' })
    }
  }))

  router.post('/:fileId/versions/:versionId/restore', (request, response) => {
    const access = requireRole(db, request, response, 'editor')
    if (!access) return
    const source = db.prepare('SELECT * FROM file_versions WHERE id=? AND file_id=?').get(route(request, 'versionId'), access.file.id) as Record<string, unknown> | undefined
    if (!source) return response.status(404).json({ error: 'Version not found' })
    const next = db.prepare('SELECT COALESCE(MAX(version_number),0)+1 number FROM file_versions WHERE file_id=?').get(access.file.id) as { number: number }
    const id = versionId(), now = nowIso()
    db.transaction(() => {
      db.prepare('INSERT INTO file_versions (id,file_id,version_number,storage_backend,storage_key,original_name,mime_type,size,sha256,scan_state,scan_detail,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, access.file.id, next.number, source.storage_backend, source.storage_key, source.original_name, source.mime_type, source.size, source.sha256, source.scan_state, `Restored from version ${source.version_number}`, request.authUser?.id ?? null, now)
      db.prepare('UPDATE files SET current_version_id=?,storage_name=?,mime_type=?,size=?,updated_at=? WHERE id=?').run(id, source.storage_key, source.mime_type, source.size, now, access.file.id)
    })()
    auditFile(db, request, 'restore_version', access.file, { source_version: source.version_number, version: next.number })
    response.status(201).json(db.prepare('SELECT * FROM file_versions WHERE id=?').get(id))
  })

  router.delete('/:fileId/versions/:versionId', asyncRoute(async (request, response) => {
    const access = requireRole(db, request, response, 'manager')
    if (!access) return
    if (access.file.current_version_id === route(request, 'versionId')) return response.status(409).json({ error: 'The current version cannot be deleted' })
    const version = db.prepare('SELECT * FROM file_versions WHERE id=? AND file_id=?').get(route(request, 'versionId'), access.file.id) as Record<string, unknown> | undefined
    if (!version) return response.status(404).json({ error: 'Version not found' })
    db.prepare('DELETE FROM file_versions WHERE id=?').run(version.id)
    const stillUsed = db.prepare('SELECT 1 FROM file_versions WHERE storage_backend=? AND storage_key=?').get(version.storage_backend, version.storage_key)
    if (!stillUsed && version.storage_backend !== 'legacy') await storage.remove(String(version.storage_key))
    auditFile(db, request, 'delete_version', access.file, { version: version.version_number })
    response.status(204).end()
  }))

  router.get('/:fileId/access', (request, response) => {
    const access = requireRole(db, request, response, 'viewer')
    if (!access) return
    const members = db.prepare(`SELECT bm.user_id,u.name,u.email,bm.role AS brand_role,fp.role AS file_role FROM brand_members bm JOIN users u ON u.id=bm.user_id LEFT JOIN file_permissions fp ON fp.user_id=bm.user_id AND fp.file_id=? WHERE bm.brand_id=? ORDER BY u.name`).all(access.file.id, access.file.brand_id)
    response.json({ visibility: access.file.visibility, inherit_permissions: Boolean(access.file.inherit_permissions), members })
  })

  router.put('/:fileId/access/:userId', (request, response) => {
    const access = requireRole(db, request, response, 'manager')
    if (!access) return
    const role = z.object({ role: z.enum(['viewer', 'commenter', 'editor', 'manager']).nullable() }).parse(request.body).role
    const userId = route(request, 'userId')
    if (!db.prepare('SELECT 1 FROM brand_members WHERE brand_id=? AND user_id=?').get(access.file.brand_id, userId)) return response.status(404).json({ error: 'Brand member not found' })
    if (role) db.prepare(`INSERT INTO file_permissions (file_id,user_id,role,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(file_id,user_id) DO UPDATE SET role=excluded.role,created_by=excluded.created_by,updated_at=excluded.updated_at`).run(access.file.id, userId, role, request.authUser?.id ?? null, nowIso(), nowIso())
    else db.prepare('DELETE FROM file_permissions WHERE file_id=? AND user_id=?').run(access.file.id, userId)
    notify(db, userId, access.file.brand_id, 'file_share', `Access updated: ${access.file.name}`, role ? `You now have ${role} access.` : 'Direct access was removed.', `/files/${access.file.id}`)
    auditFile(db, request, 'permission', access.file, { user_id: userId, role })
    response.status(204).end()
  })

  router.get('/:fileId/shares', (request, response) => {
    const access = requireRole(db, request, response, 'manager')
    if (!access) return
    response.json(db.prepare('SELECT id,file_id,allow_download,expires_at,created_by,created_at,revoked_at,last_accessed_at,access_count,password_hash IS NOT NULL AS password_required FROM file_share_links WHERE file_id=? ORDER BY created_at DESC').all(access.file.id))
  })

  router.post('/:fileId/shares', asyncRoute(async (request, response) => {
    const access = requireRole(db, request, response, 'manager')
    if (!access || !request.authUser) return
    const value = z.object({ expires_at: z.iso.datetime().nullable().default(null), password: z.string().min(8).max(128).optional(), allow_download: z.boolean().default(false) }).parse(request.body)
    const token = randomBytes(32).toString('base64url')
    const id = entityId('shr')
    db.prepare('INSERT INTO file_share_links (id,file_id,token_hash,password_hash,allow_download,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, access.file.id, tokenHash(token), value.password ? await hash(value.password, 12) : null, value.allow_download ? 1 : 0, value.expires_at, request.authUser.id, nowIso())
    auditFile(db, request, 'create_link', access.file, { link_id: id, expires_at: value.expires_at, allow_download: value.allow_download, password: Boolean(value.password) })
    response.status(201).json({ id, token, url: `${config.appUrl.replace(/\/$/, '')}/share/files/${token}`, ...value, password_required: Boolean(value.password) })
  }))

  router.delete('/:fileId/shares/:shareId', (request, response) => {
    const access = requireRole(db, request, response, 'manager')
    if (!access) return
    db.prepare('UPDATE file_share_links SET revoked_at=? WHERE id=? AND file_id=?').run(nowIso(), route(request, 'shareId'), access.file.id)
    auditFile(db, request, 'revoke_link', access.file, { link_id: route(request, 'shareId') })
    response.status(204).end()
  })

  router.get('/:fileId/comments', (request, response) => {
    const access = requireRole(db, request, response, 'commenter')
    if (!access) return
    response.json(db.prepare(`SELECT c.*,u.name author_name,u.email author_email FROM file_comments c JOIN users u ON u.id=c.author_id WHERE c.file_id=? AND (c.visibility='team' OR c.author_id=?) ORDER BY c.created_at`).all(access.file.id, request.authUser?.id ?? ''))
  })

  router.post('/:fileId/comments', (request, response) => {
    const access = requireRole(db, request, response, 'commenter')
    if (!access || !request.authUser) return
    const value = z.object({ body: z.string().trim().min(1).max(10000), parent_id: z.string().nullable().default(null), visibility: z.enum(['team', 'private']).default('team'), version_id: z.string().nullable().default(null), anchor: z.discriminatedUnion('kind', [z.object({ kind: z.literal('file') }), z.object({ kind: z.literal('page'), page: z.number().int().positive(), rect: z.tuple([z.number(), z.number(), z.number(), z.number()]) }), z.object({ kind: z.literal('image'), rect: z.tuple([z.number(), z.number(), z.number(), z.number()]) }), z.object({ kind: z.literal('docx'), paragraph: z.number().int().nonnegative(), quote: z.string() }), z.object({ kind: z.literal('slide'), slide: z.number().int().positive(), rect: z.tuple([z.number(), z.number(), z.number(), z.number()]) }), z.object({ kind: z.literal('sheet'), sheet: z.string(), range: z.string() }), z.object({ kind: z.literal('code'), from_line: z.number().int().positive(), to_line: z.number().int().positive() })]).default({ kind: 'file' }), mention_ids: z.array(z.string()).default([]) }).parse(request.body)
    if (value.version_id && !db.prepare('SELECT 1 FROM file_versions WHERE id=? AND file_id=?').get(value.version_id, access.file.id)) return response.status(422).json({ error: 'Comment version does not belong to this file' })
    if (value.parent_id && !db.prepare('SELECT 1 FROM file_comments WHERE id=? AND file_id=?').get(value.parent_id, access.file.id)) return response.status(422).json({ error: 'Reply target not found' })
    const id = entityId('cmt'), now = nowIso()
    db.prepare('INSERT INTO file_comments (id,file_id,version_id,parent_id,author_id,visibility,body,anchor,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, access.file.id, value.version_id, value.parent_id, request.authUser.id, value.visibility, value.body, JSON.stringify(value.anchor), now, now)
    if (value.visibility === 'team') {
      const targets = new Set(value.mention_ids)
      if (value.parent_id) {
        const parent = db.prepare('SELECT author_id FROM file_comments WHERE id=?').get(value.parent_id) as { author_id: string }
        targets.add(parent.author_id)
      }
      for (const userId of targets) if (userId !== request.authUser.id && db.prepare('SELECT 1 FROM brand_members WHERE brand_id=? AND user_id=?').get(access.file.brand_id, userId)) notify(db, userId, access.file.brand_id, value.parent_id ? 'file_reply' : 'file_mention', value.parent_id ? `New reply on ${access.file.name}` : `You were mentioned on ${access.file.name}`, value.body.slice(0, 180), `/files/${access.file.id}?comment=${id}`)
    }
    auditFile(db, request, value.parent_id ? 'reply' : 'comment', access.file, { comment_id: id, visibility: value.visibility })
    const comment = db.prepare(`SELECT c.*,u.name author_name,u.email author_email FROM file_comments c JOIN users u ON u.id=c.author_id WHERE c.id=?`).get(id)
    request.app.locals.io?.to(`file:${access.file.id}`).emit('file.comment', { fileId: access.file.id, comment })
    response.status(201).json(comment)
  })

  router.patch('/:fileId/comments/:commentId', (request, response) => {
    const access = requireRole(db, request, response, 'commenter')
    if (!access || !request.authUser) return
    const comment = db.prepare('SELECT * FROM file_comments WHERE id=? AND file_id=?').get(route(request, 'commentId'), access.file.id) as Record<string, unknown> | undefined
    if (!comment) return response.status(404).json({ error: 'Comment not found' })
    const value = z.object({ body: z.string().trim().min(1).max(10000).optional(), resolved: z.boolean().optional() }).parse(request.body)
    if (value.body !== undefined && comment.author_id !== request.authUser.id) return response.status(403).json({ error: 'Only the author can edit this comment' })
    if (value.resolved !== undefined && roleWeight[access.role] < roleWeight.editor && comment.author_id !== request.authUser.id) return response.status(403).json({ error: 'Editor access is required to resolve this comment' })
    db.prepare('UPDATE file_comments SET body=COALESCE(?,body),resolved_at=?,resolved_by=?,updated_at=? WHERE id=?').run(value.body ?? null, value.resolved === undefined ? comment.resolved_at : value.resolved ? nowIso() : null, value.resolved ? request.authUser.id : null, nowIso(), comment.id)
    auditFile(db, request, value.resolved ? 'resolve_comment' : 'update_comment', access.file, { comment_id: comment.id })
    response.json(db.prepare('SELECT * FROM file_comments WHERE id=?').get(comment.id))
  })

  router.get('/:fileId/activity', (request, response) => {
    const access = requireRole(db, request, response, 'viewer')
    if (!access) return
    response.json(db.prepare(`SELECT a.*,u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity_type='file' AND a.entity_id=? ORDER BY a.created_at DESC LIMIT 100`).all(access.file.id))
  })

  return router
}

function shareRecord(db: AppDatabase, token: string) {
  return db.prepare(`SELECT sl.*,f.brand_id,f.parent_id,f.kind,f.name,f.mime_type,f.size,f.current_version_id,f.created_by,f.visibility,f.inherit_permissions,f.trashed_at
    FROM file_share_links sl JOIN files f ON f.id=sl.file_id WHERE sl.token_hash=? AND sl.revoked_at IS NULL AND f.trashed_at IS NULL AND (sl.expires_at IS NULL OR sl.expires_at>?)`).get(tokenHash(token), nowIso()) as (FileRow & { file_id: string; password_hash: string | null; allow_download: number; expires_at: string | null }) | undefined
}

function throttlePublic(request: Request, response: Response) {
  const key = `${request.ip}:${route(request, 'token')}`
  const current = publicAttempts.get(key)
  const now = Date.now()
  if (!current || current.resetAt < now) { publicAttempts.set(key, { count: 1, resetAt: now + 60_000 }); return true }
  current.count += 1
  if (current.count > 60) { response.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000))); response.status(429).json({ error: 'Too many share-link requests' }); return false }
  return true
}

async function sharePasswordValid(share: { password_hash: string | null }, request: Request) {
  if (!share.password_hash) return true
  const password = request.headers['x-share-password']
  return typeof password === 'string' && await compare(password, share.password_hash)
}

function publicDescendant(db: AppDatabase, rootId: string, requestedId: string) {
  return db.prepare(`WITH RECURSIVE descendants(id) AS (
    SELECT id FROM files WHERE id=?
    UNION ALL SELECT f.id FROM files f JOIN descendants d ON f.parent_id=d.id
    WHERE f.trashed_at IS NULL AND f.inherit_permissions=1
  ) SELECT 1 FROM descendants WHERE id=?`).get(rootId, requestedId)
}

export function createPublicFileShareRouter(db: AppDatabase, config: AppConfig) {
  const router = Router({ mergeParams: true })
  const storage = new MediaStorage(config)
  router.use((request, response, next) => {
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Cache-Control', 'private, no-store')
    if (!throttlePublic(request, response)) return
    next()
  })
  router.get('/:token', asyncRoute(async (request, response) => {
    const share = shareRecord(db, route(request, 'token'))
    if (!share) return response.status(404).json({ error: 'Share link not found or expired' })
    const unlocked = await sharePasswordValid(share, request)
    const selectedId = request.query.fileId ? String(request.query.fileId) : share.file_id
    if (!publicDescendant(db, share.file_id, selectedId)) return response.status(404).json({ error: 'Shared item not found' })
    const selected = db.prepare('SELECT * FROM files WHERE id=? AND trashed_at IS NULL').get(selectedId) as FileRow | undefined
    if (!selected) return response.status(404).json({ error: 'Shared item not found' })
    const children = unlocked && selected.kind === 'folder' ? db.prepare("SELECT id,parent_id,kind,name,mime_type,size,updated_at FROM files WHERE parent_id=? AND trashed_at IS NULL AND inherit_permissions=1 ORDER BY kind DESC,name").all(selected.id) : []
    response.json({ id: selected.id, root_id: share.file_id, parent_id: selected.parent_id, kind: selected.kind, name: selected.name, mime_type: selected.mime_type, size: selected.size, expires_at: share.expires_at, password_required: Boolean(share.password_hash), unlocked, allow_download: Boolean(share.allow_download), children, ...preview(selected, config) })
  }))
  router.get('/:token/content', asyncRoute(async (request, response) => {
    const share = shareRecord(db, route(request, 'token'))
    if (!share) return response.status(404).json({ error: 'Share link not found or expired' })
    if (!await sharePasswordValid(share, request)) return response.status(401).json({ error: 'Share password required' })
    const selectedId = request.query.fileId ? String(request.query.fileId) : share.file_id
    if (!publicDescendant(db, share.file_id, selectedId)) return response.status(404).json({ error: 'Shared item not found' })
    const selected = db.prepare('SELECT * FROM files WHERE id=? AND trashed_at IS NULL').get(selectedId) as FileRow | undefined
    if (!selected) return response.status(404).json({ error: 'Shared item not found' })
    const download = request.query.download === '1'
    if (download && !share.allow_download) return response.status(403).json({ error: 'Downloads are disabled for this link' })
    if (selected.kind === 'folder') {
      if (!download) return response.status(404).json({ error: 'Shared folders can only be downloaded as ZIP archives' })
      const entries = archiveEntries(db, [selected], () => true, true)
      db.prepare('UPDATE file_share_links SET last_accessed_at=?,access_count=access_count+1 WHERE id=?').run(nowIso(), share.id)
      db.prepare('INSERT INTO file_share_access_log (id,share_link_id,ip,user_agent,action,occurred_at) VALUES (?,?,?,?,?,?)').run(entityId('sal'), share.id, request.ip, request.headers['user-agent'] ?? '', 'download', nowIso())
      return streamArchive(storage, config, entries, response, selected.name)
    }
    const version = contentVersion(db, selected)
    if (!version) return response.status(404).json({ error: 'File version not found' })
    db.prepare('UPDATE file_share_links SET last_accessed_at=?,access_count=access_count+1 WHERE id=?').run(nowIso(), share.id)
    db.prepare('INSERT INTO file_share_access_log (id,share_link_id,ip,user_agent,action,occurred_at) VALUES (?,?,?,?,?,?)').run(entityId('sal'), share.id, request.ip, request.headers['user-agent'] ?? '', download ? 'download' : 'preview', nowIso())
    await sendContent(storage, config, selected, version, response, download)
  }))
  return router
}

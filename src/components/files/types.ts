import type { ViewerAnchor } from '@/components/file-viewer'

export type FileVersion = {
  id: string
  version_number: number
  storage_backend: string
  storage_key: string
  original_name: string
  mime_type: string
  size: number
  sha256: string
  scan_state: string
  scan_detail: string
  creator_name?: string
  created_at: string
}

export type FileItem = {
  id: string
  brand_id: string
  parent_id: string | null
  kind: 'file' | 'folder'
  name: string
  description: string
  color: string | null
  created_by: string | null
  visibility: 'brand' | 'restricted'
  inherit_permissions: number
  current_version_id: string | null
  trashed_at: string | null
  original_parent_id: string | null
  mime_type: string | null
  size: number
  created_at: string
  updated_at: string
  current_version: FileVersion | null
  effective_role: 'viewer' | 'commenter' | 'editor' | 'manager'
  starred: boolean
  shared: boolean
  comment_count: number
  creator: { id: string; name: string; email: string } | null
  preview_kind: 'folder' | 'pdf' | 'docx' | 'sheet' | 'pptx' | 'image' | 'video' | 'code' | 'unsupported'
  preview_reason: string | null
  breadcrumbs?: Array<{ id: string; name: string }>
}

export type FileComment = {
  id: string
  file_id: string
  version_id: string | null
  parent_id: string | null
  author_id: string
  author_name: string
  author_email: string
  visibility: 'team' | 'private'
  body: string
  anchor: string | ViewerAnchor
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`
}

import type { ComponentType } from 'react'

export type ViewerAnchor =
  | { kind: 'file' }
  | { kind: 'page'; page: number; rect: [number, number, number, number] }
  | { kind: 'image'; rect: [number, number, number, number] }
  | { kind: 'docx'; paragraph: number; quote: string }
  | { kind: 'slide'; slide: number; rect: [number, number, number, number] }
  | { kind: 'sheet'; sheet: string; range: string }
  | { kind: 'code'; from_line: number; to_line: number }

export type ViewerSource = {
  url: string
  name: string
  mimeType: string
  versionId?: string
  password?: string
  allowDownload?: boolean
}

export type ViewerCapabilities = {
  search: boolean
  navigation: boolean
  zoom: boolean
  rotate?: boolean
  print?: boolean
  contextualComments: boolean
}

export type ViewerComponentProps = {
  source: ViewerSource
  onAnchor?: (anchor: ViewerAnchor) => void
}

export type ViewerAdapter = {
  kind: string
  capabilities: ViewerCapabilities
  load: () => Promise<{ default: ComponentType<ViewerComponentProps> }>
  render: ComponentType<ViewerComponentProps>
  search?: (query: string) => void
  navigate?: (direction: 'next' | 'previous') => void
  zoom?: (value: number) => void
}

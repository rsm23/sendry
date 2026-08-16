const JSON_KEYS = new Set([
  'provider_config', 'allowed_attachments', 'permissions', 'form_fields', 'custom_values', 'editor_data',
  'attachments', 'segment_include', 'segment_exclude', 'scope', 'action_config', 'payload', 'metadata',
  'transports', 'scopes', 'ai_provider_config', 'ai_embedding_config',
])

export function deserializeRow<T extends Record<string, unknown>>(row: T | undefined | null): T | null {
  if (!row) return null
  const result = { ...row }
  for (const [key, value] of Object.entries(result)) {
    if (JSON_KEYS.has(key) && typeof value === 'string') {
      try { (result as Record<string, unknown>)[key] = JSON.parse(value) } catch { /* retain malformed source */ }
    }
    if (typeof value === 'number' && (key.startsWith('is_') || key.endsWith('_enabled') || ['enabled', 'hidden', 'consent', 'strict_delete', 'sidebar_shortcut', 'notify_campaign_sent', 'rss_enabled', 'check_links', 'limit_never_expires', 'hide_hidden_lists', 'unsubscribe_confirmation', 'thank_you_enabled', 'goodbye_enabled', 'preference_visible'].includes(key))) {
      (result as Record<string, unknown>)[key] = value === 1
    }
  }
  return result
}

export function deserializeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => deserializeRow(row) as T)
}

export const nowIso = () => new Date().toISOString()

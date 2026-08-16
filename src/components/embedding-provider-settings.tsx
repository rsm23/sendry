import { useId, useState } from 'react'
import { Eye, EyeOff, Trash2, TriangleAlert } from 'lucide-react'
import type { Brand } from '@/lib/auth'
import { AI_PROVIDER_OPTIONS, aiProviderById } from '@/lib/ai-providers'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n/context'

function configuration(value: Brand) {
  return value.ai_embedding_config && typeof value.ai_embedding_config === 'object' ? value.ai_embedding_config as Record<string, unknown> : {}
}

export function EmbeddingProviderSettings({ value, onChange, onRemoveKey }: { value: Brand; onChange: (value: Brand) => void; onRemoveKey: () => Promise<void> }) {
  const { t } = useI18n(), providerField = useId(), modelField = useId(), urlField = useId(), keyField = useId()
  const [revealed, setRevealed] = useState(false)
  const providerId = String(value.ai_embedding_provider || ''), provider = aiProviderById(providerId), config = configuration(value)
  const generationProvider = aiProviderById(String(value.ai_provider || ''))
  const hosted = provider?.kind === 'hosted'

  function selectProvider(next: string) {
    const selected = aiProviderById(next)
    onChange({ ...value, ai_embedding_provider: next, ai_embedding_config: selected ? { model: selected.id === 'openai' ? 'text-embedding-3-small' : selected.defaultModel, ...(selected.kind === 'local' ? { baseUrl: selected.defaultBaseUrl } : {}) } : {}, ai_embedding_api_key: '', clear_ai_embedding_api_key: Boolean(value.ai_embedding_api_key_configured) })
  }

  function update(next: Record<string, unknown>) {
    onChange({ ...value, ai_embedding_config: { ...config, ...next } })
  }

  return <FieldGroup>
    <Field>
      <FieldLabel htmlFor={providerField}>Embedding provider</FieldLabel>
      <Select value={providerId || 'inherit'} onValueChange={(next) => selectProvider(String(next) === 'inherit' ? '' : String(next))}>
        <SelectTrigger id={providerField} className="w-full"><SelectValue>{provider?.name ?? t('Inherit generation provider')}</SelectValue></SelectTrigger>
        <SelectContent><SelectGroup><SelectLabel>Provider</SelectLabel><SelectItem value="inherit">Inherit generation provider</SelectItem>{AI_PROVIDER_OPTIONS.filter((item) => item.id !== 'anthropic').map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <FieldDescription>{provider ? 'Document chunks are sent to this embedding endpoint.' : `Uses ${generationProvider?.name ?? 'the generation provider'} when it supports embeddings.`}</FieldDescription>
    </Field>
    <Field>
      <FieldLabel htmlFor={modelField}>Embedding model</FieldLabel>
      <Input id={modelField} value={String(config.model || '')} onChange={(event) => update({ model: event.target.value })} placeholder={providerId === 'openai' || !providerId ? 'text-embedding-3-small' : 'Embedding model identifier'} spellCheck={false}/>
    </Field>
    {provider?.kind === 'local' ? <Field><FieldLabel htmlFor={urlField}>Embedding server URL</FieldLabel><Input id={urlField} type="url" value={String(config.baseUrl || provider.defaultBaseUrl)} onChange={(event) => update({ baseUrl: event.target.value })}/><FieldDescription>Only loopback and private-network endpoints are accepted.</FieldDescription></Field> : null}
    {hosted ? <Field><FieldLabel htmlFor={keyField}>Embedding API key</FieldLabel><InputGroup><InputGroupInput id={keyField} type={revealed ? 'text' : 'password'} value={String(value.ai_embedding_api_key || '')} onChange={(event) => onChange({ ...value, ai_embedding_api_key: event.target.value, clear_ai_embedding_api_key: false })} placeholder="Enter a write-only key" autoComplete="new-password" spellCheck={false}/><InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" onClick={() => setRevealed((current) => !current)} aria-label={t(revealed ? 'Hide key' : 'Reveal key')}>{revealed ? <EyeOff/> : <Eye/>}</InputGroupButton></InputGroupAddon></InputGroup>{value.ai_embedding_api_key_configured ? <Button type="button" size="xs" variant="ghost" className="self-start" onClick={() => void onRemoveKey()}><Trash2 data-icon="inline-start"/>Remove configured key</Button> : <FieldDescription>The key is encrypted at rest and is never returned after saving.</FieldDescription>}</Field> : null}
    {hosted || (!provider && generationProvider?.kind === 'hosted') ? <Alert><TriangleAlert/><AlertTitle>External processing notice</AlertTitle><AlertDescription>Document text is sent to the selected external embedding provider to build the private vector index.</AlertDescription></Alert> : null}
  </FieldGroup>
}

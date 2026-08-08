import { z } from 'zod'

export const channels = ['email', 'sms', 'whatsapp', 'push', 'chat', 'voice'] as const
export const campaignChannels = ['email', 'sms', 'whatsapp', 'push'] as const
export const purposes = ['marketing', 'transactional', 'support'] as const
export const deliveryStates = ['queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'canceled'] as const

export type Channel = (typeof channels)[number]
export type CampaignChannel = (typeof campaignChannels)[number]
export type MessagePurpose = (typeof purposes)[number]
export type DeliveryState = (typeof deliveryStates)[number]

const mediaSchema = z.object({ url: z.url(), mime_type: z.string().min(1).optional(), name: z.string().min(1).optional() })

export const emailContentSchema = z.object({
  channel: z.literal('email'),
  subject: z.string().min(1).max(998),
  html: z.string().default(''),
  text: z.string().default(''),
  preview_text: z.string().max(255).optional(),
  attachments: z.array(mediaSchema).max(10).default([]),
})

export const smsContentSchema = z.object({
  channel: z.literal('sms'),
  body: z.string().min(1).max(1600),
  media: z.array(mediaSchema).max(10).default([]),
  shorten_links: z.boolean().default(true),
})

export const whatsappContentSchema = z.object({
  channel: z.literal('whatsapp'),
  body: z.string().max(4096).default(''),
  template: z.object({ name: z.string().min(1), language: z.string().min(2), variables: z.record(z.string(), z.string()).default({}) }).optional(),
  media: z.array(mediaSchema).max(1).default([]),
  buttons: z.array(z.object({ type: z.enum(['url', 'phone', 'reply']), label: z.string().min(1), value: z.string().min(1) })).max(3).default([]),
})

export const pushContentSchema = z.object({
  channel: z.literal('push'),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(240),
  icon: z.url().optional(),
  image: z.url().optional(),
  target_url: z.url().optional(),
  data: z.record(z.string(), z.string()).default({}),
})

export const channelContentSchema = z.discriminatedUnion('channel', [emailContentSchema, smsContentSchema, whatsappContentSchema, pushContentSchema])
export type ChannelContent = z.infer<typeof channelContentSchema>

const campaignFields = {
  name: z.string().min(1).max(160),
  channel: z.enum(campaignChannels),
  purpose: z.enum(purposes),
  sender_identity_id: z.string().min(1).optional(),
  content: channelContentSchema,
  audience: z.object({ list_ids: z.array(z.string()).default([]), contact_ids: z.array(z.string()).default([]), excluded_contact_ids: z.array(z.string()).default([]) }).default({ list_ids: [], contact_ids: [], excluded_contact_ids: [] }),
  tracking_policy: z.object({ clicks: z.boolean().default(true), opens: z.boolean().default(true) }).default({ clicks: true, opens: true }),
}
const validateCampaignChannel = (value: { channel: CampaignChannel; content: ChannelContent }, ctx: z.RefinementCtx) => {
  if (value.channel !== value.content.channel) ctx.addIssue({ code: 'custom', path: ['content', 'channel'], message: 'Content channel must match campaign channel' })
}
export const campaignCreateSchema = z.object(campaignFields).superRefine(validateCampaignChannel)
export const campaignInputSchema = z.object({ brand_id: z.string().min(1), ...campaignFields }).superRefine(validateCampaignChannel)

export const transactionalMessageSchema = z.object({
  brand_id: z.string().min(1),
  contact_id: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  sender_identity_id: z.string().min(1).optional(),
  purpose: z.enum(purposes),
  content: channelContentSchema,
}).refine((value) => value.contact_id || value.to, { message: 'contact_id or to is required', path: ['to'] })

export type ProviderSendRequest = {
  brandId: string
  deliveryId: string
  to: string
  from: string
  content: ChannelContent
  callbackUrl?: string
  credentials: Record<string, string>
}

export type ProviderSendResult = {
  providerMessageId: string
  state: Extract<DeliveryState, 'accepted' | 'sent'>
  raw?: Record<string, unknown>
  costMicros?: number
}

export interface ChannelProviderAdapter {
  readonly provider: string
  readonly channels: readonly CampaignChannel[]
  send(request: ProviderSendRequest): Promise<ProviderSendResult>
  validateWebhook?(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, url: string, credentials: Record<string, string>): boolean
  normalizeWebhook?(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Array<{ eventId: string; providerMessageId?: string; state: DeliveryState; occurredAt: string; payload: Record<string, unknown> }>
  testConnection?(credentials: Record<string, string>): Promise<{ ok: boolean; detail: string }>
}

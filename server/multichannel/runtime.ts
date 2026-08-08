import { EventEmitter } from 'node:events'
import { Queue, Worker, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'
import type { AppConfig } from '../config'
import { decryptCredentials } from './crypto'
import { ProviderRegistry } from './providers'
import type { MultiChannelStore } from './store'
import type { CampaignChannel, ChannelContent, MessagePurpose } from './types'

export type DeliveryJob = {
  deliveryId: string
  brandId: string
  contactId: string
  channel: CampaignChannel
  purpose: MessagePurpose
  destination: string
  content: ChannelContent
  connectionId: string
  senderAddress: string
  callbackUrl?: string
}

export class MultiChannelRuntime {
  readonly providers = new ProviderRegistry()
  readonly events = new EventEmitter()
  private connection?: IORedis
  private deliveryQueue?: Queue<DeliveryJob>
  private webhookQueue?: Queue<Record<string, unknown>>
  private maintenanceQueue?: Queue<Record<string, unknown>>
  private workers: Worker[] = []

  constructor(readonly store: MultiChannelStore, readonly config: AppConfig) {
    if (config.redisUrl) {
      this.connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false })
      this.deliveryQueue = new Queue<DeliveryJob>('sendry-delivery', { connection: this.connection })
      this.webhookQueue = new Queue('sendry-webhooks', { connection: this.connection })
      this.maintenanceQueue = new Queue('sendry-maintenance', { connection: this.connection })
    }
  }

  async enqueueDelivery(job: DeliveryJob, options: JobsOptions = {}) {
    if (this.deliveryQueue) {
      await this.deliveryQueue.add('deliver', job, { jobId: job.deliveryId, attempts: 5, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 1_000, removeOnFail: 5_000, ...options })
      return
    }
    queueMicrotask(() => void this.processDelivery(job).catch(() => undefined))
  }

  async enqueueWebhook(payload: Record<string, unknown>, jobId: string) {
    if (this.webhookQueue) {
      await this.webhookQueue.add('process', payload, { jobId: jobId.replaceAll(':', '_'), attempts: 5, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 5_000 })
      return
    }
    queueMicrotask(() => this.events.emit('provider-event', payload))
  }

  startWorkers() {
    if (!this.connection) return () => undefined
    const deliveryWorker = new Worker<DeliveryJob>('sendry-delivery', async (job) => this.processDelivery(job.data), { connection: this.connection, concurrency: Number(process.env.DELIVERY_CONCURRENCY ?? 20) })
    const webhookWorker = new Worker<Record<string, unknown>>('sendry-webhooks', async (job) => { this.events.emit('provider-event', job.data) }, { connection: this.connection, concurrency: 20 })
    const maintenanceWorker = new Worker<Record<string, unknown>>('sendry-maintenance', async () => this.store.retentionSweep(), { connection: this.connection, concurrency: 1 })
    void this.maintenanceQueue?.upsertJobScheduler('retention-hourly', { every: 3600000 }, { name: 'retention', data: {} })
    this.workers.push(deliveryWorker, webhookWorker, maintenanceWorker)
    return () => void Promise.all(this.workers.map((worker) => worker.close()))
  }

  private async processDelivery(job: DeliveryJob) {
    const connection = await this.store.getConnection(job.connectionId)
    if (!connection) {
      await this.store.updateDelivery(job.deliveryId, 'failed', { error_code: 'CONNECTION_NOT_FOUND', error_message: 'Provider connection was removed' })
      return
    }
    try {
      const key = this.config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : this.config.sessionSecret)
      const provider = String(connection.provider)
      const credentials = provider === 'stream' ? {} : decryptCredentials(String(connection.encrypted_config ?? connection.encrypted_credentials), key)
      const result = await this.providers.get(provider).send({ brandId: job.brandId, deliveryId: job.deliveryId, to: job.destination, from: job.senderAddress, content: job.content, callbackUrl: job.callbackUrl, credentials })
      await this.store.updateDelivery(job.deliveryId, result.state, { provider_message_id: result.providerMessageId, cost: result.costMicros == null ? undefined : result.costMicros / 1_000_000 })
      this.events.emit('delivery.status', { brandId: job.brandId, deliveryId: job.deliveryId, state: result.state, providerMessageId: result.providerMessageId })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider delivery failed'
      await this.store.updateDelivery(job.deliveryId, 'failed', { error_code: 'PROVIDER_SEND_FAILED', error_message: message })
      this.events.emit('delivery.status', { brandId: job.brandId, deliveryId: job.deliveryId, state: 'failed', error: message })
      throw error
    }
  }

  async close() {
    await Promise.all(this.workers.map((worker) => worker.close()))
    await Promise.all([this.deliveryQueue?.close(), this.webhookQueue?.close(), this.maintenanceQueue?.close()].filter(Boolean))
    if (this.connection) await this.connection.quit()
    await this.store.close()
  }
}

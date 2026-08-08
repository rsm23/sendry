import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { connect } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { fileTypeFromBuffer } from 'file-type'
import type { AppConfig } from '../config'

const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip', 'audio/mpeg', 'audio/mp4', 'video/mp4'])

export class MediaStorage {
  private readonly s3?: S3Client
  constructor(private readonly config: AppConfig) {
    if (config.objectStorageEndpoint || config.objectStorageAccessKey) this.s3 = new S3Client({ endpoint: config.objectStorageEndpoint, region: config.objectStorageRegion, forcePathStyle: config.objectStorageForcePathStyle, credentials: config.objectStorageAccessKey && config.objectStorageSecretKey ? { accessKeyId: config.objectStorageAccessKey, secretAccessKey: config.objectStorageSecretKey } : undefined })
  }

  async inspect(path: string, declaredMime: string, maxSize = 25 * 1024 * 1024) {
    const data = await fs.readFile(path)
    if (data.length > maxSize) throw new Error('Attachment exceeds the 25 MB limit')
    const detected = await fileTypeFromBuffer(data)
    const mime = detected?.mime ?? declaredMime
    if (!allowedMimes.has(mime)) throw new Error(`Attachment type ${mime} is not allowed`)
    return { data, mime, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
  }

  async scan(path: string) {
    if (!this.config.clamavHost) return { clean: process.env.NODE_ENV !== 'production', detail: process.env.NODE_ENV === 'production' ? 'ClamAV is required in production' : 'ClamAV disabled in development' }
    return new Promise<{ clean: boolean; detail: string }>((resolve, reject) => {
      const socket = connect(this.config.clamavPort, this.config.clamavHost)
      const stream = createReadStream(path, { highWaterMark: 64 * 1024 })
      let response = ''
      socket.on('connect', () => { socket.write('zINSTREAM\0'); stream.on('data', (chunk) => { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); socket.write(size); socket.write(bytes) }); stream.on('end', () => socket.end(Buffer.alloc(4))); stream.on('error', reject) })
      socket.on('data', (chunk) => { response += chunk.toString('utf8') })
      socket.on('end', () => resolve({ clean: response.includes('OK'), detail: response.trim() }))
      socket.on('error', reject)
    })
  }

  async promote(input: { path: string; brandId: string; originalName: string; declaredMime: string }) {
    const inspected = await this.inspect(input.path, input.declaredMime)
    const result = await this.scan(input.path)
    if (!result.clean) throw new Error(`Attachment quarantine rejected: ${result.detail}`)
    const storageKey = `${input.brandId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${basename(input.originalName).replace(/[^a-zA-Z0-9._-]+/g, '-')}`
    if (this.s3) await this.s3.send(new PutObjectCommand({ Bucket: this.config.objectStorageBucket, Key: storageKey, Body: inspected.data, ContentType: inspected.mime, Metadata: { sha256: inspected.sha256, originalName: encodeURIComponent(input.originalName) } }))
    else { const destination = join(this.config.uploadDir, storageKey); await fs.mkdir(dirname(destination), { recursive: true }); await fs.copyFile(input.path, destination) }
    await fs.unlink(input.path).catch(() => undefined)
    return { storage_key: storageKey, name: input.originalName, mime_type: inspected.mime, size: inspected.size, sha256: inspected.sha256, scan: result.detail }
  }

  async signedDownload(storageKey: string) {
    if (this.s3) return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.config.objectStorageBucket, Key: storageKey }), { expiresIn: 300 })
    return `/uploads/${storageKey}`
  }

  async remove(storageKey: string) {
    if (this.s3) await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.objectStorageBucket, Key: storageKey }))
    else await fs.unlink(join(this.config.uploadDir, storageKey)).catch(() => undefined)
  }
}

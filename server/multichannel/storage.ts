import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { connect } from 'node:net'
import { basename, dirname, extname, join } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { fileTypeFromBuffer } from 'file-type'
import type { AppConfig } from '../config'

const attachmentMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip', 'audio/mpeg', 'audio/mp4', 'video/mp4'])
const executableMimes = new Set(['application/x-msdownload', 'application/x-executable', 'application/x-mach-binary', 'application/x-elf'])
const executableExtensions = new Set(['.exe', '.dll', '.com', '.scr', '.msi', '.dmg', '.pkg', '.app', '.elf', '.bin'])
const textualExtensions = new Map([
  ['.txt', 'text/plain'], ['.log', 'text/plain'], ['.md', 'text/markdown'], ['.csv', 'text/csv'],
  ['.json', 'application/json'], ['.xml', 'application/xml'], ['.yaml', 'application/yaml'], ['.yml', 'application/yaml'],
  ['.html', 'text/html'], ['.htm', 'text/html'], ['.css', 'text/css'], ['.js', 'text/javascript'], ['.jsx', 'text/javascript'],
  ['.ts', 'text/typescript'], ['.tsx', 'text/typescript'], ['.php', 'text/x-php'], ['.py', 'text/x-python'], ['.sql', 'application/sql'],
])
const officeExtensions = new Map([
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
])

function inspectZip(data: Buffer, extension: string) {
  let cursor = 0
  let entries = 0
  let uncompressed = 0
  let compressed = 0
  const names: string[] = []
  while ((cursor = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cursor)) >= 0) {
    if (cursor + 46 > data.length) throw new Error('Malformed ZIP central directory')
    const compressedSize = data.readUInt32LE(cursor + 20)
    const uncompressedSize = data.readUInt32LE(cursor + 24)
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const end = cursor + 46 + nameLength + extraLength + commentLength
    if (end > data.length) throw new Error('Malformed ZIP entry')
    names.push(data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'))
    entries += 1
    compressed += compressedSize
    uncompressed += uncompressedSize
    if (entries > 10_000 || uncompressed > 512 * 1024 * 1024 || (compressed > 0 && uncompressed / compressed > 250)) {
      throw new Error('Archive exceeds safe decompression limits')
    }
    cursor = end
  }
  if (!entries) throw new Error('Malformed or empty ZIP archive')
  if (officeExtensions.has(extension)) {
    const expectedRoot = extension === '.docx' ? 'word/' : extension === '.pptx' ? 'ppt/' : extension === '.xlsx' ? 'xl/' : 'content.xml'
    if (!names.includes('[Content_Types].xml') && extension !== '.ods') throw new Error('Malformed Office document: content types are missing')
    if (!names.some((name) => name === expectedRoot || name.startsWith(expectedRoot))) throw new Error('Malformed Office document: required package content is missing')
  }
}

export class MediaStorage {
  private readonly s3?: S3Client
  constructor(private readonly config: AppConfig) {
    if (config.objectStorageEndpoint || config.objectStorageAccessKey) this.s3 = new S3Client({ endpoint: config.objectStorageEndpoint, region: config.objectStorageRegion, forcePathStyle: config.objectStorageForcePathStyle, credentials: config.objectStorageAccessKey && config.objectStorageSecretKey ? { accessKeyId: config.objectStorageAccessKey, secretAccessKey: config.objectStorageSecretKey } : undefined })
  }

  async inspect(path: string, declaredMime: string, maxSize = 25 * 1024 * 1024, policy: 'attachment' | 'library' = 'attachment', originalName = '') {
    const data = await fs.readFile(path)
    if (data.length > maxSize) throw new Error(`File exceeds the ${Math.round(maxSize / 1024 / 1024)} MB limit`)
    const detected = await fileTypeFromBuffer(data)
    const extension = extname(originalName).toLowerCase()
    let mime = detected?.mime ?? textualExtensions.get(extension) ?? officeExtensions.get(extension) ?? (declaredMime || 'application/octet-stream')
    if ((detected?.mime === 'application/zip' || detected?.mime === 'application/x-zip-compressed') && officeExtensions.has(extension)) mime = officeExtensions.get(extension)!
    if (executableMimes.has(detected?.mime ?? mime) || executableExtensions.has(extension)) throw new Error('Executable files are not allowed in the File Library')
    if (data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || data.subarray(0, 2).toString('ascii') === 'MZ') throw new Error('Executable file signature is not allowed')
    const isZip = detected?.mime === 'application/zip' || detected?.mime === 'application/x-zip-compressed' || officeExtensions.has(extension)
    if (isZip) inspectZip(data, extension)
    if (policy === 'attachment' && !attachmentMimes.has(mime)) throw new Error(`Attachment type ${mime} is not allowed`)
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

  async promote(input: { path: string; brandId: string; originalName: string; declaredMime: string; maxSize?: number; policy?: 'attachment' | 'library' }) {
    const inspected = await this.inspect(input.path, input.declaredMime, input.maxSize, input.policy, input.originalName)
    const result = await this.scan(input.path)
    if (!result.clean) throw new Error(`Attachment quarantine rejected: ${result.detail}`)
    const storageKey = `${input.brandId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${basename(input.originalName).replace(/[^a-zA-Z0-9._-]+/g, '-')}`
    if (this.s3) await this.s3.send(new PutObjectCommand({ Bucket: this.config.objectStorageBucket, Key: storageKey, Body: inspected.data, ContentType: inspected.mime, Metadata: { sha256: inspected.sha256, originalName: encodeURIComponent(input.originalName) } }))
    else { const destination = join(this.config.uploadDir, storageKey); await fs.mkdir(dirname(destination), { recursive: true }); await fs.copyFile(input.path, destination) }
    await fs.unlink(input.path).catch(() => undefined)
    return { storage_backend: this.s3 ? 'object' : 'local', storage_key: storageKey, name: input.originalName, mime_type: inspected.mime, size: inspected.size, sha256: inspected.sha256, scan: result.detail }
  }

  async signedDownload(storageKey: string) {
    if (this.s3) return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.config.objectStorageBucket, Key: storageKey }), { expiresIn: 300 })
    throw new Error('Signed downloads are only used for object storage')
  }

  usesObjectStorage() { return Boolean(this.s3) }

  localPath(storageKey: string) { return join(this.config.uploadDir, storageKey) }

  async read(storageBackend: string, storageKey: string, maxBytes = 25 * 1024 * 1024) {
    let data: Buffer
    if (storageBackend === 'object') {
      if (!this.s3) throw new Error('Object storage is not configured')
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.config.objectStorageBucket, Key: storageKey }))
      const bytes = await response.Body?.transformToByteArray()
      if (!bytes) throw new Error('Stored file bytes are unavailable')
      data = Buffer.from(bytes)
    } else {
      const path = storageBackend === 'legacy' ? join(this.config.uploadDir, basename(storageKey)) : this.localPath(storageKey)
      data = await fs.readFile(path)
    }
    if (data.length > maxBytes) throw new Error(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB knowledge limit`)
    return data
  }

  async remove(storageKey: string) {
    if (this.s3) await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.objectStorageBucket, Key: storageKey }))
    else await fs.unlink(join(this.config.uploadDir, storageKey)).catch(() => undefined)
  }
}

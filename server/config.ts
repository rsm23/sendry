import { resolve } from 'node:path'

export type AppConfig = {
  port: number
  host: string
  appUrl: string
  databasePath: string
  uploadDir: string
  fileLibraryMaxBytes: number
  fileCodePreviewMaxBytes: number
  fileOfficePreviewMaxBytes: number
  sessionSecret: string
  mailTransport: 'stream' | 'smtp' | 'ses'
  openaiApiKey?: string
  awsRegion: string
  secureCookies: boolean
  paypalClientId?: string
  paypalClientSecret?: string
  paypalEnvironment: 'sandbox' | 'live'
  providerEventSecret?: string
  databaseUrl?: string
  redisUrl?: string
  credentialEncryptionKey?: string
  objectStorageEndpoint?: string
  objectStorageRegion: string
  objectStorageBucket: string
  objectStorageAccessKey?: string
  objectStorageSecretKey?: string
  objectStorageForcePathStyle: boolean
  clamavHost?: string
  clamavPort: number
  allowLegacySqlite: boolean
  qdrantUrl?: string
  qdrantReadKey?: string
  qdrantWriteKey?: string
  qdrantCollectionPrefix: string
  knowledgeIndexConcurrency: number
  knowledgeRetrievalLimit: number
}

export function getConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: Number(process.env.PORT ?? 4010),
    host: process.env.HOST ?? '127.0.0.1',
    appUrl: process.env.APP_URL ?? 'http://localhost:5173',
    databasePath: process.env.DATABASE_PATH ?? './data/sendry.db',
    uploadDir: resolve(process.env.UPLOAD_DIR ?? './data/uploads'),
    fileLibraryMaxBytes: Number(process.env.FILE_LIBRARY_MAX_BYTES ?? 100 * 1024 * 1024),
    fileCodePreviewMaxBytes: Number(process.env.FILE_CODE_PREVIEW_MAX_BYTES ?? 5 * 1024 * 1024),
    fileOfficePreviewMaxBytes: Number(process.env.FILE_OFFICE_PREVIEW_MAX_BYTES ?? 50 * 1024 * 1024),
    sessionSecret: process.env.SESSION_SECRET ?? 'sendry-local-session-secret-change-before-deployment',
    mailTransport: (process.env.MAIL_TRANSPORT as AppConfig['mailTransport']) ?? 'stream',
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    secureCookies: process.env.NODE_ENV === 'production',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || undefined,
    paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || undefined,
    paypalEnvironment: process.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
    providerEventSecret: process.env.PROVIDER_EVENT_SECRET || undefined,
    databaseUrl: process.env.DATABASE_URL || undefined,
    redisUrl: process.env.REDIS_URL || undefined,
    credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || undefined,
    objectStorageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT || undefined,
    objectStorageRegion: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
    objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET ?? 'sendry-media',
    objectStorageAccessKey: process.env.OBJECT_STORAGE_ACCESS_KEY || undefined,
    objectStorageSecretKey: process.env.OBJECT_STORAGE_SECRET_KEY || undefined,
    objectStorageForcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== 'false',
    clamavHost: process.env.CLAMAV_HOST || undefined,
    clamavPort: Number(process.env.CLAMAV_PORT ?? 3310),
    allowLegacySqlite: process.env.ALLOW_LEGACY_SQLITE === 'true' || process.env.NODE_ENV !== 'production',
    qdrantUrl: process.env.QDRANT_URL || undefined,
    qdrantReadKey: process.env.QDRANT_READ_KEY || undefined,
    qdrantWriteKey: process.env.QDRANT_WRITE_KEY || undefined,
    qdrantCollectionPrefix: process.env.QDRANT_COLLECTION_PREFIX ?? 'sendry_knowledge',
    knowledgeIndexConcurrency: Math.max(1, Number(process.env.KNOWLEDGE_INDEX_CONCURRENCY ?? 2)),
    knowledgeRetrievalLimit: Math.min(100, Math.max(8, Number(process.env.KNOWLEDGE_RETRIEVAL_LIMIT ?? 40))),
    ...overrides,
  }
}

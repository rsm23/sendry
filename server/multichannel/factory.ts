import type { AppConfig } from '../config'
import type { AppDatabase } from '../db'
import { PostgresMultiChannelStore } from './pg-store'
import { MultiChannelRuntime } from './runtime'
import { SqliteMultiChannelStore } from './store'

export function createMultiChannelRuntime(db: AppDatabase, config: AppConfig) {
  if (process.env.NODE_ENV === 'production' && !config.databaseUrl) throw new Error('DATABASE_URL is required in production')
  if (process.env.NODE_ENV === 'production' && !config.credentialEncryptionKey) throw new Error('CREDENTIAL_ENCRYPTION_KEY is required in production')
  const store = config.databaseUrl ? new PostgresMultiChannelStore(config.databaseUrl) : new SqliteMultiChannelStore(db)
  return new MultiChannelRuntime(store, config)
}

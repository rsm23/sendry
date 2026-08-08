import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/multichannel/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://sendry:sendry@127.0.0.1:5432/sendry',
  },
  strict: true,
  verbose: true,
})

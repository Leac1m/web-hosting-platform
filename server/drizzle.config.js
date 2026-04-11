import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.js',
  out: './db/migrations',
  dbCredentials: {
    // For Neon, prefer a direct URL for migrations (non-pooled endpoint).
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  },
})

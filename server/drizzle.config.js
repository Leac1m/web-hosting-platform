import dotenv from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, '../.env') })

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.js',
  out: './db/migrations',
  dbCredentials: {
    // For Neon, prefer a direct URL for migrations (non-pooled endpoint).
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  },
})

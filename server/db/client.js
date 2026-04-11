import 'dotenv/config'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'

let dbClient = null

export function getDb() {
  if (dbClient) {
    return dbClient
  }

  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for Neon database access')
  }

  const sql = neon(databaseUrl)
  dbClient = drizzle({ client: sql })

  return dbClient
}

export function resetDbClientForTests() {
  dbClient = null
}

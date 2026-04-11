import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { setDeployStatus } from '../services/deployStatusStore.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const inputArg = process.argv[2]

if (!inputArg) {
  console.error('Usage: pnpm --dir server db:backfill <path-to-legacy-db.json>')
  process.exit(1)
}

const inputPath = path.resolve(process.cwd(), inputArg)

async function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  const raw = fs.readFileSync(inputPath, 'utf8')
  const parsed = JSON.parse(raw)
  const entries = Object.entries(parsed?.deployStatuses || {})

  if (entries.length === 0) {
    console.info('No deployment statuses found to migrate')
    return
  }

  for (const [project, record] of entries) {
    if (!record || typeof record !== 'object') {
      continue
    }

    const { status, ...details } = record

    if (!status || typeof status !== 'string') {
      continue
    }

    await setDeployStatus(project, status, details)
  }

  console.info(`Migrated ${entries.length} deployment status records from ${inputPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})

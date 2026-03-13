import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const deployStatusMap = new Map()
const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dbPath = path.resolve(__dirname, '../db.json')

const ensureDbFile = () => {
  if (fs.existsSync(dbPath)) {
    return
  }

  const initialState = {
    deployStatuses: {},
  }

  fs.writeFileSync(dbPath, `${JSON.stringify(initialState, null, 2)}\n`, 'utf8')
}

const loadPersistedStatuses = () => {
  if (isTestEnv) {
    return
  }

  try {
    ensureDbFile()
    const raw = fs.readFileSync(dbPath, 'utf8')
    const parsed = JSON.parse(raw)
    const entries = Object.entries(parsed?.deployStatuses || {})

    entries.forEach(([project, value]) => {
      deployStatusMap.set(project, value)
    })
  } catch {
    deployStatusMap.clear()
  }
}

const persistStatuses = () => {
  if (isTestEnv) {
    return
  }

  try {
    ensureDbFile()
    const deployStatuses = Object.fromEntries(deployStatusMap.entries())
    const serialized = JSON.stringify({ deployStatuses }, null, 2)
    fs.writeFileSync(dbPath, `${serialized}\n`, 'utf8')
  } catch {
    // Ignore persistence failures to keep runtime behavior non-blocking.
  }
}

loadPersistedStatuses()

export function setDeployStatus(project, status, details = {}) {
  deployStatusMap.set(project, {
    project,
    status,
    updatedAt: new Date().toISOString(),
    ...details
  })

  persistStatuses()
}

export function getDeployStatus(project) {
  return deployStatusMap.get(project) || null
}

export function getAllDeployStatuses() {
  return Array.from(deployStatusMap.values())
}

export function getProjectNameFromRepo(repo) {
  if (!repo || typeof repo !== "string") {
    return null
  }

  return repo.replace("/", "-")
}

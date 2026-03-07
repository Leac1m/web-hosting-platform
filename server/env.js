import dotenv from 'dotenv'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, '../.env') })

function collectMissing(requiredVars) {
  return requiredVars.filter((name) => {
    const value = process.env[name]
    return !value || !String(value).trim()
  })
}

function validateAuthConfig() {
  const hasAppId = Boolean(process.env.GITHUB_APP_ID)
  const hasToken = Boolean(process.env.GITHUB_TOKEN)

  if (!hasAppId && !hasToken) {
    return [
      'GITHUB_APP_ID (for GitHub App auth) or GITHUB_TOKEN (for PAT auth)',
    ]
  }

  if (!hasAppId) {
    return []
  }

  const missing = []
  const invalid = []
  const hasPrivateKeyPath = Boolean(process.env.GITHUB_APP_PRIVATE_KEY_PATH)
  const hasPrivateKeyBase64 = Boolean(process.env.GITHUB_APP_PRIVATE_KEY_BASE64)

  if (!hasPrivateKeyPath && !hasPrivateKeyBase64) {
    missing.push('GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY_BASE64')
  }

  missing.push(
    ...collectMissing(['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET']),
  )

  if (hasPrivateKeyPath) {
    const configuredPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH
    const absolutePath = resolve(process.cwd(), configuredPath)

    if (!fs.existsSync(absolutePath)) {
      invalid.push(`GITHUB_APP_PRIVATE_KEY_PATH file does not exist: ${absolutePath}`)
    } else {
      const stats = fs.statSync(absolutePath)
      if (!stats.isFile()) {
        invalid.push(`GITHUB_APP_PRIVATE_KEY_PATH is not a file: ${absolutePath}`)
      } else if (stats.size === 0) {
        invalid.push(`GITHUB_APP_PRIVATE_KEY_PATH file is empty: ${absolutePath}`)
      }
    }
  }

  return [...missing, ...invalid]
}

export function validateEnv() {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return
  }

  const missing = [...collectMissing(['DEPLOY_SECRET']), ...validateAuthConfig()]

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    )
  }
}

validateEnv()

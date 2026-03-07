import fs from 'fs'
import path from 'path'

/**
 * Creates versioned deployment with symlink to current release
 * Directory structure:
 *   deployments/owner-repo/
 *     releases/
 *       v1-abc123def/ (extract here)
 *       v2-xyz789... /
 *     current -> symlink to latest release
 *
 * This enables atomic swaps: only the symlink is updated, avoiding mid-request breakage
 * @param {string} projectName - Project name (owner-repo)
 * @param {string} commit - Commit SHA
 * @param {string} baseDir - Base deployment directory
 * @returns {object} { versionedPath: string, currentLink: string }
 */
export function createVersionedDeploymentPath(
  projectName,
  commit,
  baseDir = process.cwd(),
) {
  const projectPath = path.join(baseDir, 'deployments', projectName)
  const releasesPath = path.join(projectPath, 'releases')

  // Create releases directory if it doesn't exist
  fs.mkdirSync(releasesPath, { recursive: true })

  // Create version directory: v<timestamp>-<commit-short>
  const timestamp = Date.now()
  const commitShort = commit.substring(0, 7)
  const versionName = `v${timestamp}-${commitShort}`
  const versionPath = path.join(releasesPath, versionName)

  fs.mkdirSync(versionPath, { recursive: true })

  const currentLink = path.join(projectPath, 'current')

  return { versionedPath: versionPath, currentLink, versionName }
}

/**
 * Atomically updates the current symlink to point to new version
 * Removes old symlink and creates new one in a single operation
 * @param {string} currentLink - Path to current symlink
 * @param {string} versionPath - Path to new version directory
 */
export function updateCurrentSymlink(currentLink, versionPath) {
  try {
    // Remove existing symlink if present
    if (fs.existsSync(currentLink) || fs.lstatSync(currentLink)) {
      fs.unlinkSync(currentLink)
    }
  } catch (err) {
    // File doesn't exist, that's fine
    if (err.code !== 'ENOENT') {
      throw err
    }
  }

  // Create new symlink pointing to version directory
  const relativePath = path.relative(path.dirname(currentLink), versionPath)
  fs.symlinkSync(relativePath, currentLink, 'dir')
}

/**
 * Cleanup old releases, keeping only the N most recent versions
 * @param {string} projectName - Project name
 * @param {number} keepCount - Number of releases to keep (default: 5)
 * @param {string} baseDir - Base deployment directory
 */
export function cleanupOldReleases(
  projectName,
  keepCount = 5,
  baseDir = process.cwd(),
) {
  const releasesPath = path.join(
    baseDir,
    'deployments',
    projectName,
    'releases',
  )

  if (!fs.existsSync(releasesPath)) {
    return { cleaned: 0, kept: 0 }
  }

  const releases = fs
    .readdirSync(releasesPath)
    .filter((name) => name.startsWith('v'))
    .sort()
    .reverse()

  let cleaned = 0
  for (let i = keepCount; i < releases.length; i++) {
    const oldPath = path.join(releasesPath, releases[i])
    fs.rmSync(oldPath, { recursive: true, force: true })
    cleaned++
  }

  return { cleaned, kept: Math.min(keepCount, releases.length) }
}

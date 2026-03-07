import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  createVersionedDeploymentPath,
  updateCurrentSymlink,
  cleanupOldReleases,
} from '../services/deploymentManager.js'

describe('deploymentManager', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('createVersionedDeploymentPath', () => {
    test('creates versioned path with commit hash', () => {
      const result = createVersionedDeploymentPath(
        'owner-repo',
        'abc123def456',
        tempDir
      )

      expect(result.versionedPath).toContain('releases')
      expect(result.versionedPath).toContain('abc123d')
      expect(result.versionName).toMatch(/^v\d+-abc123d$/)
      expect(fs.existsSync(result.versionedPath)).toBe(true)
    })

    test('creates releases directory if missing', () => {
      const releasesPath = path.join(tempDir, 'deployments', 'owner-repo', 'releases')
      expect(fs.existsSync(releasesPath)).toBe(false)

      createVersionedDeploymentPath('owner-repo', 'commit123', tempDir)

      expect(fs.existsSync(releasesPath)).toBe(true)
    })

    test('returns currentLink path', () => {
      const result = createVersionedDeploymentPath('owner-repo', 'abc123', tempDir)

      expect(result.currentLink).toBe(
        path.join(tempDir, 'deployments', 'owner-repo', 'current')
      )
    })

    test('creates unique version directories for different commits', () => {
      const result1 = createVersionedDeploymentPath('owner-repo', 'commit1', tempDir)
      const result2 = createVersionedDeploymentPath('owner-repo', 'commit2', tempDir)

      expect(result1.versionedPath).not.toBe(result2.versionedPath)
      expect(fs.existsSync(result1.versionedPath)).toBe(true)
      expect(fs.existsSync(result2.versionedPath)).toBe(true)
    })
  })

  describe('updateCurrentSymlink', () => {
    test('creates symlink to version directory', () => {
      const projectPath = path.join(tempDir, 'deployments', 'owner-repo')
      const versionPath = path.join(projectPath, 'releases', 'v1-abc123')
      const currentLink = path.join(projectPath, 'current')

      fs.mkdirSync(versionPath, { recursive: true })

      updateCurrentSymlink(currentLink, versionPath)

      expect(fs.existsSync(currentLink)).toBe(true)
      expect(fs.lstatSync(currentLink).isSymbolicLink()).toBe(true)
    })

    test('replaces existing symlink atomically', () => {
      const projectPath = path.join(tempDir, 'deployments', 'owner-repo')
      const version1 = path.join(projectPath, 'releases', 'v1-old')
      const version2 = path.join(projectPath, 'releases', 'v2-new')
      const currentLink = path.join(projectPath, 'current')

      fs.mkdirSync(version1, { recursive: true })
      fs.mkdirSync(version2, { recursive: true })

      // Create initial symlink
      updateCurrentSymlink(currentLink, version1)
      const target1 = fs.readlinkSync(currentLink)

      // Update to new version
      updateCurrentSymlink(currentLink, version2)
      const target2 = fs.readlinkSync(currentLink)

      expect(target1).not.toBe(target2)
      expect(fs.lstatSync(currentLink).isSymbolicLink()).toBe(true)
    })

    test('handles missing previous symlink gracefully', () => {
      const projectPath = path.join(tempDir, 'deployments', 'owner-repo')
      const versionPath = path.join(projectPath, 'releases', 'v1-first')
      const currentLink = path.join(projectPath, 'current')

      fs.mkdirSync(versionPath, { recursive: true })

      // Should not throw even though current doesn't exist
      expect(() => {
        updateCurrentSymlink(currentLink, versionPath)
      }).not.toThrow()

      expect(fs.existsSync(currentLink)).toBe(true)
    })
  })

  describe('cleanupOldReleases', () => {
    test('keeps only N most recent releases', () => {
      const projectPath = path.join(tempDir, 'deployments', 'owner-repo')
      const releasesPath = path.join(projectPath, 'releases')

      // Create 10 releases
      for (let i = 1; i <= 10; i++) {
        fs.mkdirSync(path.join(releasesPath, `v${i}-commit${i}`), {
          recursive: true,
        })
      }

      const result = cleanupOldReleases('owner-repo', 5, tempDir)

      expect(result.cleaned).toBe(5)
      expect(result.kept).toBe(5)
      expect(fs.readdirSync(releasesPath)).toHaveLength(5)
    })

    test('preserves newer releases when cleaning', () => {
      const projectPath = path.join(tempDir, 'deployments', 'owner-repo')
      const releasesPath = path.join(projectPath, 'releases')

      // Create releases with sequential naming
      for (let i = 1; i <= 7; i++) {
        fs.mkdirSync(path.join(releasesPath, `v${i}-commit${i}`), {
          recursive: true,
        })
      }

      cleanupOldReleases('owner-repo', 3, tempDir)

      const remaining = fs.readdirSync(releasesPath)
      expect(remaining).toContain('v7-commit7')
      expect(remaining).toContain('v6-commit6')
      expect(remaining).toContain('v5-commit5')
      expect(remaining).not.toContain('v1-commit1')
    })

    test('returns 0 cleaned if releases directory missing', () => {
      const result = cleanupOldReleases('nonexistent-repo', 5, tempDir)

      expect(result.cleaned).toBe(0)
      expect(result.kept).toBe(0)
    })

    test('ignores non-release directories', () => {
      const projectPath = path.join(tempDir, 'deployments', 'owner-repo')
      const releasesPath = path.join(projectPath, 'releases')

      fs.mkdirSync(path.join(releasesPath, 'v1-commit1'), { recursive: true })
      fs.mkdirSync(path.join(releasesPath, 'v2-commit2'), { recursive: true })
      fs.mkdirSync(path.join(releasesPath, 'backup'), { recursive: true })

      cleanupOldReleases('owner-repo', 1, tempDir)

      const remaining = fs.readdirSync(releasesPath)
      expect(remaining).toContain('backup')
      expect(remaining).toContain('v2-commit2')
    })
  })

  describe('zero-downtime deployment flow', () => {
    test('simulates atomic swap from v1 to v2', () => {
      const projectPath = path.join(tempDir, 'deployments', 'owner-repo')
      const v1Path = path.join(projectPath, 'releases', 'v1-old')
      const v2Path = path.join(projectPath, 'releases', 'v2-new')
      const currentLink = path.join(projectPath, 'current')

      // Setup v1
      fs.mkdirSync(v1Path, { recursive: true })
      fs.writeFileSync(path.join(v1Path, 'index.html'), '<h1>Version 1</h1>')
      updateCurrentSymlink(currentLink, v1Path)

      // Verify v1 is current
      let content = fs.readFileSync(path.join(currentLink, 'index.html'), 'utf8')
      expect(content).toContain('Version 1')

      // Deploy v2 in parallel (no downtime reading v1)
      fs.mkdirSync(v2Path, { recursive: true })
      fs.writeFileSync(path.join(v2Path, 'index.html'), '<h1>Version 2</h1>')

      // Atomic swap
      updateCurrentSymlink(currentLink, v2Path)

      // Verify v2 is now current
      content = fs.readFileSync(path.join(currentLink, 'index.html'), 'utf8')
      expect(content).toContain('Version 2')
    })
  })
})

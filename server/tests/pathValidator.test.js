import { validateRepoName, isSafeTarEntry } from '../services/pathValidator.js'

describe('pathValidator', () => {
  describe('validateRepoName', () => {
    test('accepts valid repo names', () => {
      const result = validateRepoName('owner/repo')
      expect(result.valid).toBe(true)
      expect(result.projectName).toBe('owner-repo')
    })

    test('accepts repo names with hyphens and underscores', () => {
      const result = validateRepoName('my-owner/my_repo-name')
      expect(result.valid).toBe(true)
      expect(result.projectName).toBe('my-owner-my_repo-name')
    })

    test('rejects repo names with dots', () => {
      const result = validateRepoName('owner/repo.name')
      expect(result.valid).toBe(true) // dots are allowed in repo name part
    })

    test('rejects empty repo', () => {
      const result = validateRepoName('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid repo format')
    })

    test('rejects null/undefined', () => {
      expect(validateRepoName(null).valid).toBe(false)
      expect(validateRepoName(undefined).valid).toBe(false)
    })

    test('rejects directory traversal with ..', () => {
      const result = validateRepoName('owner/../admin')
      expect(result.valid).toBe(false)
    })

    test('rejects directory traversal with tilde', () => {
      const result = validateRepoName('owner/~repo')
      expect(result.valid).toBe(false)
    })

    test('rejects absolute paths', () => {
      const result = validateRepoName('/owner/repo')
      expect(result.valid).toBe(false)
    })

    test('rejects repo without forward slash', () => {
      const result = validateRepoName('owner-repo')
      expect(result.valid).toBe(false)
    })

    test('rejects very long repo names', () => {
      const longName = 'a'.repeat(256) + '/repo'
      const result = validateRepoName(longName)
      expect(result.valid).toBe(false)
    })

    test('rejects special characters', () => {
      const result = validateRepoName('owner/repo@name')
      expect(result.valid).toBe(false)
    })
  })

  describe('isSafeTarEntry', () => {
    test('accepts normal entry', () => {
      const entry = { name: 'build/index.html' }
      expect(isSafeTarEntry(entry)).toBe(true)
    })

    test('accepts nested entry', () => {
      const entry = { name: 'build/css/style.css' }
      expect(isSafeTarEntry(entry)).toBe(true)
    })

    test('rejects absolute path', () => {
      const entry = { name: '/etc/passwd' }
      expect(isSafeTarEntry(entry)).toBe(false)
    })

    test('rejects directory traversal (..) in middle', () => {
      const entry = { name: 'build/../../../etc/passwd' }
      expect(isSafeTarEntry(entry)).toBe(false)
    })

    test('rejects directory traversal (..) at start', () => {
      const entry = { name: '../../../etc/passwd' }
      expect(isSafeTarEntry(entry)).toBe(false)
    })

    test('rejects tilde paths', () => {
      const entry = { name: '~/.ssh/id_rsa' }
      expect(isSafeTarEntry(entry)).toBe(false)
    })

    test('rejects entry from header', () => {
      const entry = { header: { name: '/etc/shadow' } }
      expect(isSafeTarEntry(entry)).toBe(false)
    })

    test('accepts entry with dots in filenames', () => {
      const entry = { name: 'build/script.min.js' }
      expect(isSafeTarEntry(entry)).toBe(true)
    })
  })
})

import fs from 'fs'
import os from 'os'
import path from 'path'
import { cleanupTmpDir } from '../services/cleanupTmp.js'

describe('cleanupTmpDir', () => {
  let sandboxRoot

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-cleanup-'))
  })

  afterEach(() => {
    fs.rmSync(sandboxRoot, { recursive: true, force: true })
  })

  test('removes tmp folder in test mode', () => {
    const tmpPath = path.join(sandboxRoot, 'tmp')
    fs.mkdirSync(tmpPath, { recursive: true })
    fs.writeFileSync(path.join(tmpPath, 'artifact.tar'), 'content')

    const cleaned = cleanupTmpDir({ cwd: sandboxRoot, env: 'test' })

    expect(cleaned).toBe(true)
    expect(fs.existsSync(tmpPath)).toBe(false)
  })

  test('removes tmp folder in development mode', () => {
    const tmpPath = path.join(sandboxRoot, 'tmp')
    fs.mkdirSync(tmpPath, { recursive: true })

    const cleaned = cleanupTmpDir({ cwd: sandboxRoot, env: 'development' })

    expect(cleaned).toBe(true)
    expect(fs.existsSync(tmpPath)).toBe(false)
  })

  test('does nothing outside development/test modes', () => {
    const tmpPath = path.join(sandboxRoot, 'tmp')
    fs.mkdirSync(tmpPath, { recursive: true })

    const cleaned = cleanupTmpDir({ cwd: sandboxRoot, env: 'production' })

    expect(cleaned).toBe(false)
    expect(fs.existsSync(tmpPath)).toBe(true)
  })
})

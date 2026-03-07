import fs from "fs"
import path from "path"

export function cleanupTmpDir({ cwd = process.cwd(), env = process.env.NODE_ENV } = {}) {
  if (env !== "development" && env !== "test") {
    return false
  }

  const tmpPath = path.join(cwd, "tmp")
  fs.rmSync(tmpPath, { recursive: true, force: true })

  return true
}

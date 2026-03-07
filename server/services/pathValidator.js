/**
 * Validates and sanitizes a repository name to prevent directory traversal attacks
 * @param {string} repo - Repository name (e.g., "owner/repo-name")
 * @returns {object} { valid: boolean, error?: string, projectName?: string }
 */
export function validateRepoName(repo) {
  if (!repo || typeof repo !== "string") {
    return { valid: false, error: "Invalid repo format" }
  }

  if (repo.length > 255) {
    return { valid: false, error: "Repo name too long" }
  }

  // Allow only alphanumeric, hyphens, underscores, and forward slashes
  const repoRegex = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/
  if (!repoRegex.test(repo)) {
    return { valid: false, error: "Invalid repo name format. Expected: owner/repo-name" }
  }

  // Prevent directory traversal attempts
  if (repo.includes("..") || repo.includes("~") || repo.startsWith("/")) {
    return { valid: false, error: "Repo name contains invalid characters" }
  }

  const projectName = repo.replace("/", "-")
  return { valid: true, projectName }
}

/**
 * Validates that a tar entry does not escape the target directory
 * @param {object} entry - Tar entry object with headers
 * @param {string} targetDir - Target directory for extraction
 * @returns {boolean} True if entry is safe, false otherwise
 */
export function isSafeTarEntry(entry) {
  const name = entry.name || entry.header?.name || ""

  // Reject absolute paths
  if (name.startsWith("/")) {
    return false
  }

  // Reject directory traversal attempts
  if (name.includes("..") || name.includes("~")) {
    return false
  }

  // Reject entries that would write outside the extraction directory
  const normalizedName = name.split("/").filter((p) => p && p !== ".").join("/")
  if (normalizedName.startsWith("..")) {
    return false
  }

  return true
}

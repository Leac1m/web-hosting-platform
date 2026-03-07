import axios from "axios"

export class GitHubError extends Error {
  constructor(message, statusCode, githubError) {
    super(message)
    this.statusCode = statusCode
    this.githubError = githubError
  }
}

export async function triggerBuild(repo, branch, token) {

  const [owner, repoName] = repo.split("/")

  try {
    await axios.post(
      `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/deploy.yml/dispatches`,
      {
        ref: branch
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        }
      }
    )
  } catch (err) {
    const status = err.response?.status
    const data = err.response?.data

    if (status === 401) {
      throw new GitHubError(
        "Invalid GitHub token",
        401,
        "authentication_failed"
      )
    }

    if (status === 403) {
      throw new GitHubError(
        "No permission to access repo or workflow",
        403,
        "permission_denied"
      )
    }

    if (status === 404) {
      throw new GitHubError(
        "Repository or workflow not found",
        404,
        "not_found"
      )
    }

    if (status === 422) {
      throw new GitHubError(
        "Invalid branch or repository reference",
        422,
        "invalid_ref"
      )
    }

    throw err
  }

}
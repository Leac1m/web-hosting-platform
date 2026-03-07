import axios from "axios"

export async function triggerBuild(repo, branch, token) {

  const [owner, repoName] = repo.split("/")

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

}
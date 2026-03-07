import fs from 'fs'
import path from 'path'
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

function readPrivateKey() {
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH
  const keyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64

  if (keyPath) {
    const absolutePath = path.isAbsolute(keyPath)
      ? keyPath
      : path.join(process.cwd(), keyPath)

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`GitHub App private key not found at ${absolutePath}`)
    }

    return fs.readFileSync(absolutePath, 'utf8')
  }

  if (keyBase64) {
    return Buffer.from(keyBase64, 'base64').toString('utf8')
  }

  throw new Error('Missing GitHub App private key configuration')
}

function getAppConfig() {
  const appId = process.env.GITHUB_APP_ID

  if (!appId) {
    throw new Error('Missing GITHUB_APP_ID')
  }

  return {
    appId,
    privateKey: readPrivateKey(),
  }
}

export async function getInstallationToken(owner, repo) {
  const { appId, privateKey } = getAppConfig()

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  })

  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({
    owner,
    repo,
  })

  const { data } = await appOctokit.rest.apps.createInstallationAccessToken({
    installation_id: installation.id,
  })

  return data.token
}

export async function triggerWorkflowWithApp(owner, repo, branch) {
  const installationToken = await getInstallationToken(owner, repo)

  const installationOctokit = new Octokit({
    auth: installationToken,
  })

  await installationOctokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: 'deploy.yml',
    ref: branch,
  })
}

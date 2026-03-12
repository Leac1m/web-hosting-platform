import fs from 'fs'
import path from 'path'
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import sodium from 'libsodium-wrappers'

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

  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation(
    {
      owner,
      repo,
    },
  )

  const { data } = await appOctokit.rest.apps.createInstallationAccessToken({
    installation_id: installation.id,
  })

  return data.token
}

export async function triggerWorkflowWithApp(
  owner,
  repo,
  branch,
  workflowId = 'deploy.yml',
) {
  const installationToken = await getInstallationToken(owner, repo)

  const installationOctokit = new Octokit({
    auth: installationToken,
  })

  await installationOctokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId,
    ref: branch,
  })
}

/**
 * Updates a GitHub repository secret
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} secretName - Name of the secret
 * @param {string} secretValue - Value to set
 */
export async function updateRepositorySecret(
  owner,
  repo,
  secretName,
  secretValue,
) {
  const installationToken = await getInstallationToken(owner, repo)

  const installationOctokit = new Octokit({
    auth: installationToken,
  })

  // Get the repository's public key for secret encryption
  const { data: publicKeyData } =
    await installationOctokit.rest.actions.getRepoPublicKey({
      owner,
      repo,
    })

  // Ensure libsodium is ready
  await sodium.ready

  // Encrypt the secret value using the public key
  const messageBytes = Buffer.from(secretValue)
  const keyBytes = Buffer.from(publicKeyData.key, 'base64')
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes)
  const encryptedValue = Buffer.from(encryptedBytes).toString('base64')

  // Set the secret
  await installationOctokit.rest.actions.createOrUpdateRepoSecret({
    owner,
    repo,
    secret_name: secretName,
    encrypted_value: encryptedValue,
    key_id: publicKeyData.key_id,
  })
}

/**
 * Updates multiple repository secrets at once
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} secrets - Object with secret names as keys and values as values
 */
export async function updateRepositorySecrets(owner, repo, secrets) {
  for (const [secretName, secretValue] of Object.entries(secrets)) {
    await updateRepositorySecret(owner, repo, secretName, secretValue)
  }
}

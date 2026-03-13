import { useEffect, useMemo, useState } from 'react'
import { authApi, deployApi } from './services/api'
import './App.css'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

const toProjectName = (repoName) => repoName.replace('/', '-')

const toDeploymentUrl = (status) => {
  const candidate = status?.hostingUrl || status?.url

  if (!candidate) {
    return null
  }

  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    return candidate
  }

  return `${API_BASE_URL}${candidate}`
}

function App() {
  const [isLoadingUser, setIsLoadingUser] = useState(true)
  const [user, setUser] = useState(null)
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('main')
  const [hostingTarget, setHostingTarget] = useState('platform')
  const [activeProject, setActiveProject] = useState('')
  const [activeProjectTarget, setActiveProjectTarget] = useState('platform')
  const [deployStatus, setDeployStatus] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [pagesConfigByProject, setPagesConfigByProject] = useState({})
  const [isDeploying, setIsDeploying] = useState(false)
  const [isSyncingPagesConfig, setIsSyncingPagesConfig] = useState(false)
  const [error, setError] = useState('')

  const loginUrl = useMemo(() => authApi.getLoginUrl(), [])

  const loadDeployments = async () => {
    try {
      const response = await deployApi.list()
      const nextDeployments = response.data
      setDeployments(nextDeployments)

      const githubPagesProjects = nextDeployments
        .filter((item) => item.hostingTarget === 'github-pages')
        .map((item) => item.project)

      if (githubPagesProjects.length === 0) {
        setPagesConfigByProject({})
        return
      }

      const pagesEntries = await Promise.all(
        githubPagesProjects.map(async (project) => {
          try {
            const pagesConfigResponse = await deployApi.getPagesConfig(project)
            return [project, pagesConfigResponse.data]
          } catch {
            return [project, null]
          }
        }),
      )

      setPagesConfigByProject(Object.fromEntries(pagesEntries))
    } catch {
      setDeployments([])
      setPagesConfigByProject({})
    }
  }

  const loadStatus = async (projectName, target = 'platform') => {
    if (!projectName) {
      return
    }

    try {
      if (target === 'github-pages') {
        const [statusResponse, pagesConfigResponse] = await Promise.all([
          deployApi.getPagesStatus(projectName),
          deployApi.getPagesConfig(projectName).catch(() => null),
        ])

        setDeployStatus({
          ...statusResponse.data,
          ...(pagesConfigResponse?.data || {}),
        })
      } else {
        const response = await deployApi.getStatus(projectName)
        setDeployStatus(response.data)
      }
    } catch {
      setDeployStatus(null)
    }
  }

  const handleSyncPagesConfig = async () => {
    if (!activeProject || activeProjectTarget !== 'github-pages') {
      return
    }

    setError('')
    setIsSyncingPagesConfig(true)

    try {
      await deployApi.syncPagesConfig(activeProject)
      await loadStatus(activeProject, activeProjectTarget)
      await loadDeployments()
    } catch (requestError) {
      const errorMessage =
        requestError?.response?.data?.error ||
        'Failed to sync GitHub Pages configuration'
      setError(errorMessage)
    } finally {
      setIsSyncingPagesConfig(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    const loadUser = async () => {
      try {
        const response = await authApi.getMe()
        if (!isMounted) {
          return
        }
        setUser(response.data.user)
      } catch {
        if (!isMounted) {
          return
        }
        setUser(null)
      } finally {
        if (isMounted) {
          setIsLoadingUser(false)
        }
      }
    }

    loadUser()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!user) {
      return
    }

    loadDeployments()
  }, [user])

  useEffect(() => {
    if (!activeProject) {
      return
    }

    loadStatus(activeProject, activeProjectTarget)

    const timer = setInterval(() => {
      loadStatus(activeProject, activeProjectTarget)
    }, 5000)

    return () => clearInterval(timer)
  }, [activeProject, activeProjectTarget])

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      setDeployStatus(null)
      setDeployments([])
      setPagesConfigByProject({})
      setActiveProject('')
      setActiveProjectTarget('platform')
    }
  }

  const handleDeploy = async (event) => {
    event.preventDefault()
    setError('')
    setIsDeploying(true)

    try {
      const trimmedRepo = repo.trim()
      const response = await deployApi.trigger(
        trimmedRepo,
        branch.trim() || 'main',
        hostingTarget,
      )
      setDeployStatus(response.data)

      const projectName = toProjectName(trimmedRepo)
      setActiveProject(projectName)
      setActiveProjectTarget(hostingTarget)
      await loadStatus(projectName, hostingTarget)
      await loadDeployments()
    } catch (requestError) {
      const errorMessage =
        requestError?.response?.data?.error || 'Failed to trigger deployment'
      setError(errorMessage)
    } finally {
      setIsDeploying(false)
    }
  }

  if (isLoadingUser) {
    return <main className="container">Loading...</main>
  }

  if (!user) {
    return (
      <main className="container">
        <h1>Web Hosting Platform</h1>
        <p>Login with GitHub to trigger and monitor deployments.</p>
        <a className="button" href={loginUrl}>
          Login with GitHub
        </a>
      </main>
    )
  }

  return (
    <main className="container">
      <div className="header-row">
        <h1>Web Hosting Platform</h1>
        <button type="button" onClick={handleLogout}>
          Logout @{user.login}
        </button>
      </div>

      <section className="card">
        <h2>Deploy</h2>
        <form onSubmit={handleDeploy} className="form-grid">
          <label>
            Repository
            <input
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="owner/repo"
              required
            />
          </label>

          <label>
            Branch
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="main"
            />
          </label>

          <label>
            Hosting Target
            <select
              value={hostingTarget}
              onChange={(event) => setHostingTarget(event.target.value)}
            >
              <option value="platform">Platform</option>
              <option value="github-pages">GitHub Pages</option>
            </select>
          </label>

          <button type="submit" disabled={isDeploying}>
            {isDeploying ? 'Deploying...' : 'Deploy'}
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card">
        <h2>Current Status</h2>
        {deployStatus ? (
          <div>
            <p>
              <strong>Project:</strong> {deployStatus.project}
            </p>
            <p>
              <strong>Status:</strong> {deployStatus.status}
            </p>
            {deployStatus.hostingTarget ? (
              <p>
                <strong>Hosting Target:</strong> {deployStatus.hostingTarget}
              </p>
            ) : null}
            {deployStatus.providerStatus ? (
              <p>
                <strong>Provider Status:</strong> {deployStatus.providerStatus}
              </p>
            ) : null}
            {deployStatus.pagesSource ? (
              <p>
                <strong>Pages Source:</strong> {deployStatus.pagesSource}
              </p>
            ) : null}
            {deployStatus.httpsCertificateState ? (
              <p>
                <strong>HTTPS Certificate:</strong>{' '}
                {deployStatus.httpsCertificateState}
              </p>
            ) : null}
            {activeProject && activeProjectTarget === 'github-pages' ? (
              <p>
                <button
                  type="button"
                  onClick={handleSyncPagesConfig}
                  disabled={isSyncingPagesConfig}
                >
                  {isSyncingPagesConfig
                    ? 'Syncing Pages Config...'
                    : 'Sync Pages Config'}
                </button>
              </p>
            ) : null}
            {toDeploymentUrl(deployStatus) ? (
              <p>
                <strong>URL:</strong>{' '}
                <a
                  href={toDeploymentUrl(deployStatus)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {toDeploymentUrl(deployStatus)}
                </a>
              </p>
            ) : null}
          </div>
        ) : (
          <p>No active deployment selected.</p>
        )}
      </section>

      <section className="card">
        <div className="header-row">
          <h2>My Deployments</h2>
          <button type="button" onClick={loadDeployments}>
            Refresh
          </button>
        </div>
        {deployments.length === 0 ? (
          <p>No deployments yet.</p>
        ) : (
          <ul className="list">
            {deployments.map((item) => (
              <li
                key={`${item.project}-${item.updatedAt}`}
                className="list-item"
                onClick={() => {
                  setActiveProject(item.project)
                  setActiveProjectTarget(item.hostingTarget || 'platform')
                }}
              >
                <div>
                  <strong>{item.project}</strong>
                  <p>{item.repo || 'unknown repo'}</p>
                  <p>{item.hostingTarget || 'platform'}</p>
                  {item.hostingTarget === 'github-pages' ? (
                    <div className="list-meta-row">
                      <span className="list-meta-pill">
                        Source:{' '}
                        {pagesConfigByProject[item.project]?.pagesSource ||
                          'unknown'}
                      </span>
                      <span className="list-meta-pill">
                        HTTPS:{' '}
                        {pagesConfigByProject[item.project]
                          ?.httpsCertificateState || 'unknown'}
                      </span>
                    </div>
                  ) : null}
                </div>
                <span>{item.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default App

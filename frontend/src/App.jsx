import { useEffect, useMemo, useState } from 'react'
import { authApi, deployApi } from './services/api'
import './App.css'

function App() {
  const [isLoadingUser, setIsLoadingUser] = useState(true)
  const [user, setUser] = useState(null)
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('main')
  const [activeProject, setActiveProject] = useState('')
  const [deployStatus, setDeployStatus] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [isDeploying, setIsDeploying] = useState(false)
  const [error, setError] = useState('')

  const loginUrl = useMemo(() => authApi.getLoginUrl(), [])

  const loadDeployments = async () => {
    try {
      const response = await deployApi.list()
      setDeployments(response.data)
    } catch {
      setDeployments([])
    }
  }

  const loadStatus = async (projectName) => {
    if (!projectName) {
      return
    }

    try {
      const response = await deployApi.getStatus(projectName)
      setDeployStatus(response.data)
    } catch {
      setDeployStatus(null)
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

    loadStatus(activeProject)

    const timer = setInterval(() => {
      loadStatus(activeProject)
    }, 5000)

    return () => clearInterval(timer)
  }, [activeProject])

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      setDeployStatus(null)
      setDeployments([])
      setActiveProject('')
    }
  }

  const handleDeploy = async (event) => {
    event.preventDefault()
    setError('')
    setIsDeploying(true)

    try {
      const trimmedRepo = repo.trim()
      await deployApi.trigger(trimmedRepo, branch.trim() || 'main')

      const projectName = trimmedRepo.replace('/', '-')
      setActiveProject(projectName)
      await loadStatus(projectName)
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
            {deployStatus.url ? (
              <p>
                <strong>URL:</strong>{' '}
                <a
                  href={`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${deployStatus.url}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {deployStatus.url}
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
              >
                <div>
                  <strong>{item.project}</strong>
                  <p>{item.repo || 'unknown repo'}</p>
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

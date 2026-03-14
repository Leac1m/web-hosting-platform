import axios from 'axios'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
})

export const authApi = {
  getMe: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  getLoginUrl: () => `${API_BASE_URL}/auth/github`,
}

export const deployApi = {
  trigger: (repo, branch, hostingTarget = 'github-pages') =>
    api.post('/deploy', { repo, branch, hostingTarget }),
  getStatus: (project) => api.get(`/deploy/status/${project}`),
  getPagesStatus: (project) => api.get(`/deploy/pages-status/${project}`),
  getPagesConfig: (project) => api.get(`/deploy/pages-config/${project}`),
  syncPagesConfig: (project) =>
    api.post(`/deploy/pages-config/${project}/sync`),
  list: () => api.get('/deploy/list'),
}

export const githubApi = {
  listRepositories: (params) => api.get('/api/github/repositories', { params }),
}

export default api

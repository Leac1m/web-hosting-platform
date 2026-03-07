import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

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
  trigger: (repo, branch) => api.post('/deploy', { repo, branch }),
  getStatus: (project) => api.get(`/deploy/status/${project}`),
  list: () => api.get('/deploy/list'),
}

export default api

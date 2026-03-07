import express from 'express'
import {
  getMe,
  handleGitHubCallback,
  handleGitHubLogin,
  handleLogout,
  requireAuth,
} from '../controllers/authController.js'

const router = express.Router()

router.get('/github', handleGitHubLogin)
router.get('/github/callback', handleGitHubCallback)
router.get('/me', requireAuth, getMe)
router.post('/logout', requireAuth, handleLogout)

export default router

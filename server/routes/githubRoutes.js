import express from 'express'
import { requireAuth } from '../controllers/authController.js'
import { listRepositories } from '../controllers/githubController.js'

const router = express.Router()

router.get('/repositories', requireAuth, listRepositories)

export default router

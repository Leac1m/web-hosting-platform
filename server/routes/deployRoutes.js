import express from 'express'
import multer from 'multer'
import { mkdir } from 'fs/promises'
import { requireAuth } from '../controllers/authController.js'
import {
  getDeploymentStatus,
  getPagesConfig,
  getPagesProviderHealth,
  getPagesDeploymentStatus,
  listRouteMappings,
  listDeployments,
  syncDeploymentWorkflows,
  syncPagesConfig,
  triggerDeployment,
  uploadArtifact,
} from '../controllers/deployController.js'

const router = express.Router()
const upload = multer({ dest: 'tmp/' })

const ensureTmpDir = async (req, res, next) => {
  try {
    await mkdir('tmp', { recursive: true })
    next()
  } catch (error) {
    next(error)
  }
}

// GET /deploy/status/:project
router.get('/status/:project', requireAuth, getDeploymentStatus)

// GET /deploy/list
router.get('/list', requireAuth, listDeployments)

// GET /deploy/routes
router.get('/routes', requireAuth, listRouteMappings)

// GET /deploy/pages-status/:project
router.get('/pages-status/:project', requireAuth, getPagesDeploymentStatus)

// GET /deploy/pages-config/:project
router.get('/pages-config/:project', requireAuth, getPagesConfig)

// GET /deploy/pages-health/:project
router.get('/pages-health/:project', requireAuth, getPagesProviderHealth)

// POST /deploy/pages-config/:project/sync
router.post('/pages-config/:project/sync', requireAuth, syncPagesConfig)

// POST /deploy/workflows/sync
router.post('/workflows/sync', requireAuth, syncDeploymentWorkflows)

// POST /deploy
router.post('/', requireAuth, triggerDeployment)

// POST /deploy/upload
router.post('/upload', ensureTmpDir, upload.single('artifact'), uploadArtifact)

export default router

import express from "express"
import multer from "multer"
import { mkdir } from "fs/promises"
import { requireAuth } from "../controllers/authController.js"
import {
  getDeploymentStatus,
  getPagesProviderHealth,
  getPagesDeploymentStatus,
  listRouteMappings,
  listDeployments,
  triggerDeployment,
  uploadArtifact
} from "../controllers/deployController.js"

const router = express.Router()
const upload = multer({ dest: "tmp/" })

const ensureTmpDir = async (req, res, next) => {
  try {
    await mkdir("tmp", { recursive: true })
    next()
  } catch (error) {
    next(error)
  }
}

// GET /deploy/status/:project
router.get("/status/:project", requireAuth, getDeploymentStatus)

// GET /deploy/list
router.get("/list", requireAuth, listDeployments)

// GET /deploy/routes
router.get("/routes", requireAuth, listRouteMappings)

// GET /deploy/pages-status/:project
router.get("/pages-status/:project", requireAuth, getPagesDeploymentStatus)

// GET /deploy/pages-health/:project
router.get("/pages-health/:project", requireAuth, getPagesProviderHealth)

// POST /deploy
router.post("/", requireAuth, triggerDeployment)

// POST /deploy/upload
router.post("/upload", ensureTmpDir, upload.single("artifact"), uploadArtifact)

export default router

import express from "express"
import multer from "multer"
import { mkdir } from "fs/promises"
import { requireAuth } from "../controllers/authController.js"
import {
  getDeploymentStatus,
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

// POST /deploy
router.post("/", requireAuth, triggerDeployment)

// POST /deploy/upload
router.post("/upload", ensureTmpDir, upload.single("artifact"), uploadArtifact)

export default router

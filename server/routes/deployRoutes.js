import express from "express"
import multer from "multer"
import {
  getDeploymentStatus,
  triggerDeployment,
  uploadArtifact
} from "../controllers/deployController.js"

const router = express.Router()
const upload = multer({ dest: "tmp/" })

// GET /deploy/status/:project
router.get("/status/:project", getDeploymentStatus)

// POST /deploy
router.post("/", triggerDeployment)

// POST /deploy/upload
router.post("/upload", upload.single("artifact"), uploadArtifact)

export default router

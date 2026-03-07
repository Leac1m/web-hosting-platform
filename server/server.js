import express from "express"
import multer from "multer"
import fs from "fs"
import path from "path"
import * as tar from "tar"

const app = express()

const upload = multer({ dest: "tmp/" })

const DEPLOY_SECRET = process.env.DEPLOY_SECRET

app.use("/sites", express.static("deployments"))

app.post("/deploy/upload", upload.single("artifact"), async (req, res) => {

  const authHeader = req.headers.authorization

  if (!authHeader || authHeader !== `Bearer ${DEPLOY_SECRET}`) {
    return res.status(403).json({ error: "Unauthorized" })
  }

  const repo = req.body.repo
  const commit = req.body.commit

  if (!repo) {
    return res.status(400).json({ error: "Missing repo name" })
  }

  if (!req.file) {
    return res.status(400).json({ error: "Missing artifact file" })
  }

  const projectName = repo.replace("/", "-")

  const deployPath = path.join(
    process.cwd(),
    "deployments",
    projectName
  )

  fs.mkdirSync(deployPath, { recursive: true })

  try {

    await tar.x({
      file: req.file.path,
      cwd: deployPath
    })

    fs.unlinkSync(req.file.path)

    res.json({
      status: "success",
      project: projectName,
      commit
    })

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "Deployment failed"
    })

  }

})

export default app
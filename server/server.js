import express from "express"
import multer from "multer"
import fs from "fs"
import path from "path"
import * as tar from "tar"
import { triggerBuild, GitHubError } from "./services/buildService.js"
import { validateRepoName } from "./services/pathValidator.js"

const app = express()

const upload = multer({ dest: "tmp/" })

const DEPLOY_SECRET = process.env.DEPLOY_SECRET

app.use(express.json())

app.use("/sites", express.static("deployments"))

app.post("/deploy", async (req, res) => {

  const repo = req.body?.repo
  const branch = req.body?.branch || "main"
  const githubToken = process.env.GITHUB_TOKEN

  if (!repo) {
    return res.status(400).json({ error: "Missing repo name" })
  }

  if (!githubToken) {
    return res.status(500).json({ error: "Missing GitHub token" })
  }

  try {

    await triggerBuild(repo, branch, githubToken)

    return res.status(202).json({
      status: "queued",
      repo,
      branch
    })

  } catch (err) {

    console.error(err)

    if (err instanceof GitHubError) {
      if (err.statusCode === 401) {
        return res.status(401).json({ error: "Invalid GitHub token" })
      }
      if (err.statusCode === 403) {
        return res.status(403).json({ error: "No permission to access repo or workflow" })
      }
      if (err.statusCode === 404) {
        return res.status(404).json({ error: "Repository or workflow not found" })
      }
      if (err.statusCode === 422) {
        return res.status(422).json({ error: "Invalid branch or repository reference" })
      }
    }

    return res.status(500).json({
      error: "Failed to trigger deployment"
    })

  }

})

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

  const validation = validateRepoName(repo)
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error })
  }

  if (!req.file) {
    return res.status(400).json({ error: "Missing artifact file" })
  }

  const projectName = validation.projectName

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
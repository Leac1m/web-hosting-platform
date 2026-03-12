import express from 'express'
import fs from 'fs'
import path from 'path'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import deployRoutes from './routes/deployRoutes.js'
import authRoutes from './routes/authRoutes.js'

const app = express()

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

fs.mkdirSync('tmp', { recursive: true })
fs.mkdirSync('deployments', { recursive: true })

const deploymentsPath = path.join(process.cwd(), 'deployments')

const parseProjectFromReferer = (referer) => {
	if (!referer) {
		return null
	}

	try {
		const refererUrl = new URL(referer)
		const match = refererUrl.pathname.match(/^\/sites\/([^/]+)(?:\/|$)/)
		return match?.[1] || null
	} catch {
		return null
	}
}

const isSafeProjectName = (projectName) => /^[A-Za-z0-9._-]+$/.test(projectName)

app.use(
	cors({
		origin: frontendUrl,
		credentials: true,
	})
)

app.use(express.json())
app.use(cookieParser())

app.use('/sites', express.static(deploymentsPath))

// Backward compatibility for builds that emit absolute /assets/* URLs.
app.use('/assets', (req, res, next) => {
	const projectName = parseProjectFromReferer(req.get('referer'))

	if (!projectName || !isSafeProjectName(projectName)) {
		return next()
	}

	const projectAssetsPath = path.join(deploymentsPath, projectName, 'assets')
	return express.static(projectAssetsPath, { fallthrough: true })(req, res, next)
})

app.use('/auth', authRoutes)
app.use('/deploy', deployRoutes)

export default app

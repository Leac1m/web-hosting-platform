import express from 'express'
import fs from 'fs'
import path from 'path'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import deployRoutes from './routes/deployRoutes.js'
import authRoutes from './routes/authRoutes.js'
import { getDeployStatus } from './services/deployStatusStore.js'

const app = express()

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

fs.mkdirSync('tmp', { recursive: true })
fs.mkdirSync('deployments', { recursive: true })

const deploymentsPath = path.join(process.cwd(), 'deployments')
const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailers',
	'transfer-encoding',
	'upgrade',
	'content-encoding',
	'content-length',
])

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

const getGitHubPagesUrlFromRepo = (repo) => {
	const [owner, repoName] = String(repo || '').split('/')

	if (!owner || !repoName) {
		return null
	}

	if (repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
		return `https://${owner}.github.io/`
	}

	return `https://${owner}.github.io/${repoName}/`
}

const resolvePagesProviderUrl = (projectName) => {
	const status = getDeployStatus(projectName)

	if (!status || status.hostingTarget !== 'github-pages') {
		return null
	}

	if (status.providerUrl) {
		return status.providerUrl
	}

	return getGitHubPagesUrlFromRepo(status.repo)
}

const copyUpstreamHeaders = (upstreamHeaders, res) => {
	upstreamHeaders.forEach((value, key) => {
		const headerName = key.toLowerCase()

		if (HOP_BY_HOP_HEADERS.has(headerName)) {
			return
		}

		res.setHeader(key, value)
	})
}

const getForwardHeaders = (req) => {
	const names = [
		'accept',
		'accept-language',
		'cache-control',
		'if-modified-since',
		'if-none-match',
		'pragma',
		'range',
		'user-agent',
	]

	return names.reduce((headers, name) => {
		const value = req.get(name)

		if (value) {
			headers[name] = value
		}

		return headers
	}, {})
}

const getRequestSearch = (req) => {
	try {
		const url = new URL(`http://localhost${req.originalUrl}`)
		return url.search
	} catch {
		return ''
	}
}

const relayFromGitHubPages = async (req, res, projectName, relativePath = '/') => {
	const providerBaseUrl = resolvePagesProviderUrl(projectName)

	if (!providerBaseUrl) {
		return false
	}

	const upstreamUrl = new URL(relativePath.replace(/^\//, ''), providerBaseUrl)
	upstreamUrl.search = getRequestSearch(req)

	let upstreamResponse

	try {
		upstreamResponse = await fetch(upstreamUrl, {
			method: req.method,
			headers: getForwardHeaders(req),
			redirect: 'follow',
		})
	} catch {
		res.status(502).send('Failed to relay GitHub Pages request')
		return true
	}

	res.status(upstreamResponse.status)
	copyUpstreamHeaders(upstreamResponse.headers, res)

	const payload = Buffer.from(await upstreamResponse.arrayBuffer())
	res.send(payload)
	return true
}

const canUseRootRelayFallback = (reqPath) => {
	if (reqPath.startsWith('/auth') || reqPath.startsWith('/deploy') || reqPath.startsWith('/sites')) {
		return false
	}

	if (reqPath.startsWith('/assets/')) {
		return true
	}

	if (['/favicon.ico', '/manifest.json', '/robots.txt', '/sitemap.xml'].includes(reqPath)) {
		return true
	}

	return /\.[A-Za-z0-9]+$/.test(reqPath)
}

app.use(
	cors({
		origin: frontendUrl,
		credentials: true,
	})
)

app.use(express.json())
app.use(cookieParser())

app.use('/sites/:project', async (req, res, next) => {
	const projectName = req.params.project

	if (!isSafeProjectName(projectName)) {
		return res.status(404).send('Not Found')
	}

	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return next()
	}

	const relayed = await relayFromGitHubPages(req, res, projectName, req.path || '/')

	if (relayed) {
		return undefined
	}

	const projectPath = path.join(deploymentsPath, projectName)
	return express.static(projectPath, { fallthrough: true })(req, res, next)
})

// Backward compatibility for builds that emit absolute /assets/* URLs.
app.use(async (req, res, next) => {
	if ((req.method !== 'GET' && req.method !== 'HEAD') || !canUseRootRelayFallback(req.path)) {
		return next()
	}

	const projectName = parseProjectFromReferer(req.get('referer'))

	if (!projectName || !isSafeProjectName(projectName)) {
		return next()
	}

	const relayed = await relayFromGitHubPages(req, res, projectName, req.path)

	if (relayed) {
		return undefined
	}

	if (!req.path.startsWith('/assets/')) {
		return next()
	}

	const projectAssetsPath = path.join(deploymentsPath, projectName, 'assets')
	const relativeAssetPath = req.path.replace(/^\/assets\//, '')
	const normalizedAssetPath = path.normalize(relativeAssetPath)

	if (
		normalizedAssetPath.startsWith('..') ||
		path.isAbsolute(normalizedAssetPath)
	) {
		return res.status(404).send('Not Found')
	}

	const assetPath = path.join(projectAssetsPath, normalizedAssetPath)
	return res.sendFile(assetPath, (err) => {
		if (err) {
			next()
		}
	})
})

app.use('/auth', authRoutes)
app.use('/deploy', deployRoutes)

export default app

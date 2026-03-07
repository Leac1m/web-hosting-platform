import express from 'express'
import fs from 'fs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import deployRoutes from './routes/deployRoutes.js'
import authRoutes from './routes/authRoutes.js'

const app = express()

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

fs.mkdirSync('tmp', { recursive: true })
fs.mkdirSync('deployments', { recursive: true })

app.use(
	cors({
		origin: frontendUrl,
		credentials: true,
	})
)

app.use(express.json())
app.use(cookieParser())

app.use('/sites', express.static('deployments'))

app.use('/auth', authRoutes)
app.use('/deploy', deployRoutes)

export default app

import express from 'express'
import deployRoutes from './routes/deployRoutes.js'

const app = express()

app.use(express.json())

app.use('/sites', express.static('deployments'))

app.use('/deploy', deployRoutes)

export default app

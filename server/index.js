import './env.js'
import app from "./server.js"
import { cleanupTmpDir } from "./services/cleanupTmp.js"

cleanupTmpDir()

const parsedPort = Number.parseInt(process.env.PORT, 10)
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3000

app.listen(port, () => {
    console.log(`Server running on port ${port}`)
})
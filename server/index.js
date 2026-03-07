import './env.js'
import app from "./server.js"
import { cleanupTmpDir } from "./services/cleanupTmp.js"

cleanupTmpDir()

app.listen(3000, () => {
    console.log("Server running on port 3000")
})
import app from "./server.js"
import { cleanupTmpDir } from "./services/cleanupTmp.js"
import dotenv from "dotenv"
dotenv.config()
cleanupTmpDir()

app.listen(3000, () => {
    console.log("Server running on port 3000")
})
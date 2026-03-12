import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Use relative asset paths so deployments work from /sites/<project>/.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
})

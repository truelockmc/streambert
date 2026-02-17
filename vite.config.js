import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Required for Electron to resolve assets from dist/
  server: { port: 5173 },
})

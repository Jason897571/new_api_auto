import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone landing dev server on :5174 so it never collides with the
// internal console (Vite :5173). Fully isolated from ../frontend.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, open: true },
  build: { outDir: 'dist' },
})

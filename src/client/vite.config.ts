import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/control-plane/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: '../../public/control-plane',
    emptyOutDir: true,
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { cssMinify: false },
  optimizeDeps: { exclude: ['@cornerstonejs/dicom-image-loader'], include: ['dicom-parser'] },
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
})

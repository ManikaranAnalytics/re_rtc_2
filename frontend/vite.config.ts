import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Forward all /api requests to FastAPI backend during dev
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,          // no source maps in production bundle
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-router-dom') || id.includes('react-dom') || id.includes('/react/')) {
            return 'react-vendor'
          }
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) {
            return 'chart-vendor'
          }
        },
      },
    },
  },
})


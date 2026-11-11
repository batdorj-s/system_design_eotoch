import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Хөгжүүлэлтийн үед /api хүсэлтийг FastAPI руу дамжуулна
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  // onnxruntime-web-ийн WASM замыг эвдэхгүйн тулд pre-bundle хийхгүй
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router'],
          charts: ['recharts'],
        },
      },
    },
  },
})

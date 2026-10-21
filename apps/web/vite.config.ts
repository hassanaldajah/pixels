/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { tokensPlugin } from './vite.tokens.ts'

const backend = process.env.PIXELS_BACKEND ?? 'http://127.0.0.1:8765'

export default defineConfig({
  plugins: [tokensPlugin(), tailwindcss(), react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Same-origin in development too: the browser only ever talks to Vite, which forwards.
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/ws': { target: backend.replace('http', 'ws'), ws: true, changeOrigin: false },
    },
  },
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: false, chunkSizeWarningLimit: 700 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})

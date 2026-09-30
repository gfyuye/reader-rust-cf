import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * Root Vite Configuration for Cloudflare Pages framework auto-detection.
 * Points root to 'frontend' and outputs bundle to 'dist'.
 */
export default defineConfig({
  root: 'frontend',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'frontend/src'),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Front wola /api na WLASNYM origin -> Vite przekazuje do proxy.
// Dzieki temu CORS w ogole nie wystepuje.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } },
  },
})

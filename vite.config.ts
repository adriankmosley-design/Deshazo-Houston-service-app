import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // redirect.html is the small page Microsoft returns to after "Connect Outlook".
      input: { main: 'index.html', redirect: 'redirect.html' },
    },
  },
})

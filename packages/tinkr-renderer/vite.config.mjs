import {readFileSync} from 'fs'
import {resolve} from 'path'
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

const {version} = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// the pages sit next to this config, so the dev server serves them at the urls
// the main process asks for, and the build puts them at the top of build/
export default defineConfig({
  publicDir: 'public',
  // the chrome prints the version in the sidebar footer and the status bar
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // the built app is loaded over file://, so the asset urls have to be relative
  base: './',
  server: {
    port: parseInt(process.env.WEB_PORT) || 8080,
    open: false,
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        editor: resolve(import.meta.dirname, 'editor.html'),
        preference: resolve(import.meta.dirname, 'preference.html'),
        logs: resolve(import.meta.dirname, 'logs.html'),
      },
    },
  },
  plugins: [react()],
})

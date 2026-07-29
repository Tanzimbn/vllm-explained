import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * GitHub Pages serves static files with no history-API fallback, so a deep link
 * such as /vllm-explained/stage/scheduler has no matching file and gets the 404
 * page. Pages serves 404.html for any unmatched path, so shipping a copy of
 * index.html under that name boots the SPA and lets the router read the real
 * URL — the address bar keeps the clean path.
 *
 * Copying at build time (rather than checking a 404.html into git) keeps the
 * hashed asset filenames in sync automatically.
 */
function githubPagesFallback() {
  let outDir
  return {
    name: 'github-pages-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const dir = join(process.cwd(), outDir)
      copyFileSync(join(dir, 'index.html'), join(dir, '404.html'))
      // Belt and braces: irrelevant to the Actions-based deploy, but required if
      // the output is ever published from a branch, where Jekyll would other-
      // wise drop files and folders beginning with an underscore.
      writeFileSync(join(dir, '.nojekyll'), '')
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), githubPagesFallback()],

  // Served from https://tanzimbn.github.io/vllm-explained/, so every asset URL
  // needs that prefix. Must have BOTH slashes: without the leading one, asset
  // paths resolve relative to the current route and break on deep links.
  // Override with BASE_PATH=/ when serving from a domain root.
  base: process.env.BASE_PATH ?? '/vllm-explained/',

  server: { port: 5180, open: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
  },
})

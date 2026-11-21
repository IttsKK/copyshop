import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { guideControls } from './scripts/guideControls'

/**
 * Dev-only: lets the page write a rendered image to ./out for inspection.
 *
 * The browser cannot save a file without a user gesture, and screenshots are
 * not always available, so without this there is no way to look at a
 * full-resolution render while iterating. Never part of the built app.
 */
function saveRenderEndpoint(): Plugin {
  return {
    name: 'save-render',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('POST only')
        }
        const name = normalize(String(req.headers['x-filename'] ?? 'render.png')).replace(/^(\.\.[/\\])+/, '')
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(c as Buffer))
        req.on('end', () => {
          const target = join(process.cwd(), 'out', name)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, Buffer.concat(chunks))
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ written: target, bytes: Buffer.concat(chunks).length }))
        })
      })
    },
  }
}

/**
 * public/photos is a link to the developer's own photos, for the dev server
 * and the timelapse scripts. Vite copies all of public/ into a build, which
 * would ship those photos inside the app and on the web, so it is removed
 * from every build.
 */
function leaveOutLocalPhotos(): Plugin {
  let outDir = 'dist'
  return {
    name: 'leave-out-local-photos',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      rmSync(join(process.cwd(), outDir, 'photos'), { recursive: true, force: true })
    },
  }
}

/** The app's version, as the desktop app ships it: crash reports are filed under it. */
// A test build (scripts/test-build.mjs) says so, with its commit: 1.0.7+test.4772610.
const APP_VERSION: string =
  process.env.COPYSHOP_TEST_VERSION || JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8')).version

/**
 * Sentry's token for uploading source maps, so crash reports from release
 * builds show the real code: SENTRY_AUTH_TOKEN, or else the organization
 * token kept in the macOS Keychain (item "reader-sentry-auth-token", shared
 * with the Reader app's releases). None, and the build simply doesn't upload.
 * SENTRY_UPLOAD=0 skips it.
 */
function sentryToken(): string | null {
  if (process.env.SENTRY_UPLOAD === '0') return null
  if (process.env.SENTRY_AUTH_TOKEN) return process.env.SENTRY_AUTH_TOKEN
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'reader-sentry-auth-token', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

export default defineConfig(({ command }) => {
  const token = command === 'build' ? sentryToken() : null
  return {
    plugins: [
      react(),
      // The Guide's list of each module's controls, read from their code.
      guideControls(),
      saveRenderEndpoint(),
      leaveOutLocalPhotos(),
      // Release builds: source maps go to Sentry (project "copyshop"), then are
      // deleted, so they're never shipped with the app or the site.
      ...(token
        ? [
            sentryVitePlugin({
              org: 'caelan-wm',
              project: 'copyshop',
              authToken: token,
              release: { name: `copyshop@${APP_VERSION}` },
              sourcemaps: { filesToDeleteAfterUpload: ['**/*.map'] },
              telemetry: false,
            }),
          ]
        : []),
    ],
    build: { sourcemap: token ? 'hidden' : false },
    // Module workers: the selection model's worker loads its runtime in pieces (dynamic imports).
    worker: { format: 'es' as const },
    // The WebP encoder finds its .wasm beside its own module (new URL(..., import.meta.url)), which pre-bundling would move away from it.
    optimizeDeps: { exclude: ['@jsquash/webp'] },
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      // Our own builds (releases, test builds, the website): set by the release scripts and CI.
      __OFFICIAL__: JSON.stringify(process.env.COPYSHOP_OFFICIAL === '1'),
    },
    server: { port: 5178 },
  }
})

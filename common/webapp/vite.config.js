import {fileURLToPath, URL} from 'node:url'

import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import viteCompression from 'vite-plugin-compression'
import {VitePWA} from 'vite-plugin-pwa'

// Precompress build output so nginx can serve max-level static .br/.gz via
// brotli_static/gzip_static (offloads on-the-fly compression). VITE_PRECOMPRESS:
//   both (default) | brotli | gzip | off
const precompress = (process.env.VITE_PRECOMPRESS || 'both').toLowerCase()
const COMPRESS_FILTER = /\.(js|mjs|json|css|html|svg|conf|webmanifest)$/i
const compressionPlugins = []
if (precompress === 'both' || precompress === 'gzip')
    compressionPlugins.push(viteCompression({algorithm: 'gzip', ext: '.gz', filter: COMPRESS_FILTER, threshold: 1024, deleteOriginFile: false}))
if (precompress === 'both' || precompress === 'brotli')
    compressionPlugins.push(viteCompression({algorithm: 'brotliCompress', ext: '.br', filter: COMPRESS_FILTER, threshold: 1024, deleteOriginFile: false}))

// Service worker: cache-first precache of the immutable hashed APP SHELL only
// (js/css/html/woff2). It must NEVER cache map tiles (/maps/**) or live/*.json —
// those stay network-only. Gated by VITE_PWA (default on); autoUpdate pushes a new
// precache in the background on each deploy. Set VITE_PWA=false to ship no SW.
const pwaEnabled = (process.env.VITE_PWA || 'true').toLowerCase() !== 'false'
const pwaPlugins = pwaEnabled ? [VitePWA({
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    manifest: false, // keep the existing public/assets/manifest.webmanifest
    workbox: {
        globPatterns: ['index.html', 'assets/*.{js,css,woff2}'],
        globIgnores: ['**/*.map', 'sql.php'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: null, // hash-routed SPA; don't fabricate navigations
        // belt-and-suspenders: never let the SW serve these dynamic paths
        navigateFallbackDenylist: [/\/maps\//, /\/settings\.json$/, /\/live\//],
        runtimeCaching: [], // no tile/live runtime caching by design
    },
})] : []

// noinspection JSUnusedGlobalSymbols
export default defineConfig({
    plugins: [vue(), ...compressionPlugins, ...pwaPlugins],
    base: './',
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    define: {
        __VUE_I18N_FULL_INSTALL__: true,
        __VUE_I18N_LEGACY_API__: false,
        __INTLIFY_PROD_DEVTOOLS__: false,
    },
    build: {
        // Ship sourcemaps only when explicitly requested (VITE_SOURCEMAP=true).
        // Default off: the prod .js.map is ~3.6 MB of dead weight in dist/jar/webroot.
        sourcemap: process.env.VITE_SOURCEMAP === 'true',
        rollupOptions: {
            output: {
                // Split vendor code so chunks download in parallel and cache independently
                // (three.js rarely changes -> long-lived cache; app code changes often).
                manualChunks(id) {
                    if (!id.includes('node_modules')) return
                    if (id.includes('/three/')) return 'three'
                    if (id.includes('/vue/') || id.includes('/@vue/') ||
                        id.includes('/vue-i18n/') || id.includes('/@intlify/')) return 'vue'
                    return 'vendor'
                }
            }
        }
    },
    server: {
        proxy: {
            '/settings.json': {
                //target: 'http://localhost:8100',
                target: 'https://bluecolored.de/bluemap',
                changeOrigin: true,
            },
            '/maps': {
                //target: 'http://localhost:8100',
                target: 'https://bluecolored.de/bluemap',
                changeOrigin: true,
            }
        }
    }
})

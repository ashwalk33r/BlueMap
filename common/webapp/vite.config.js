/* eslint-env node */
import {fileURLToPath, URL} from 'node:url'

import {defineConfig, loadEnv} from 'vite'
import vue from '@vitejs/plugin-vue'
import viteCompression from 'vite-plugin-compression'
import {VitePWA} from 'vite-plugin-pwa'

const COMPRESS_FILTER = /\.(js|mjs|json|css|html|svg|conf|webmanifest)$/i

// noinspection JSUnusedGlobalSymbols
export default defineConfig(async ({mode}) => {
    // Load .env files (e.g. common/webapp/.env) so the build flags below are
    // honored. Vite does NOT push .env into process.env on its own — it only
    // exposes VITE_-prefixed vars to app source via import.meta.env — so the
    // config must read them explicitly via loadEnv. An empty prefix loads every
    // var; a real shell/CI env var still wins over the .env file.
    const env = loadEnv(mode, process.cwd(), '')

    // Bundle analyzer: gated by VITE_ANALYZE=true so normal/CI builds stay lean.
    // Emits an interactive treemap + raw stats JSON to the perf results dir
    // (VITE_ANALYZE_OUT, default the repo-level results/) for tracking the
    // entry-chunk size across the code-split work. rollup-plugin-visualizer is
    // ESM-only, so it's dynamically imported here (a static import breaks esbuild's
    // CJS config bundling).
    const analyzeEnabled = (env.VITE_ANALYZE || '').toLowerCase() === 'true'
    const analyzeOutDir = env.VITE_ANALYZE_OUT || '/home/ubuntu24/webapp-perf/results'
    async function buildAnalyzePlugins() {
        if (!analyzeEnabled) return []
        const {visualizer} = await import('rollup-plugin-visualizer')
        return [
            visualizer({filename: `${analyzeOutDir}/treemap-uc.html`, template: 'treemap', gzipSize: true, brotliSize: true}),
            visualizer({filename: `${analyzeOutDir}/treemap-uc.json`, template: 'raw-data', gzipSize: true, brotliSize: true}),
        ]
    }

    // Precompress build output so nginx can serve max-level static .br/.gz via
    // brotli_static/gzip_static (offloads on-the-fly compression). VITE_PRECOMPRESS:
    //   both (default) | brotli | gzip | off
    const precompress = (env.VITE_PRECOMPRESS || 'both').toLowerCase()
    const compressionPlugins = []
    if (precompress === 'both' || precompress === 'gzip')
        compressionPlugins.push(viteCompression({algorithm: 'gzip', ext: '.gz', filter: COMPRESS_FILTER, threshold: 1024, deleteOriginFile: false}))
    if (precompress === 'both' || precompress === 'brotli')
        compressionPlugins.push(viteCompression({algorithm: 'brotliCompress', ext: '.br', filter: COMPRESS_FILTER, threshold: 1024, deleteOriginFile: false}))

    // Service worker: cache-first precache of the immutable hashed APP SHELL only
    // (js/css/html/woff2). It must NEVER cache map tiles (/maps/**) or live/*.json —
    // those stay network-only. Gated by VITE_PWA (default on); autoUpdate pushes a new
    // precache in the background on each deploy. Set VITE_PWA=false to ship no SW.
    const pwaEnabled = (env.VITE_PWA || 'true').toLowerCase() !== 'false'
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

    return {
    plugins: [vue(), ...compressionPlugins, ...pwaPlugins, ...(await buildAnalyzePlugins())],
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
        sourcemap: env.VITE_SOURCEMAP === 'true',
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
    }
})

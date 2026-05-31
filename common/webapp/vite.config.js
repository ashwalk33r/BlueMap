import {fileURLToPath, URL} from 'node:url'

import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import viteCompression from 'vite-plugin-compression'

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

// noinspection JSUnusedGlobalSymbols
export default defineConfig({
    plugins: [vue(), ...compressionPlugins],
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
        sourcemap: process.env.VITE_SOURCEMAP === 'true'
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

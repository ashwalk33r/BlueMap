import {fileURLToPath, URL} from 'node:url'

import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

// noinspection JSUnusedGlobalSymbols
export default defineConfig({
    plugins: [vue()],
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

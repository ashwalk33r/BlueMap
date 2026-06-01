# TODO.BACKEND — backend/ops changes required by the webapp perf work

Living doc. The frontend perf work (branch `fork/ashwalk33r`, see `~/webapp-perf/DONE.PERF-BENCH-FE.md`)
is webapp-only where possible, but some changes need the **Java plugin**, **gradle build**, or
**nginx/ops** to take full effect. Anything backend goes here.

Legend: 🔴 required for a shipped FE change to work · 🟡 optional (admin-configurability) · ⏳ upcoming FE step

---

## 🔴 REQUIRED — for shipped changes to take effect in production

### 1. nginx webroot: `brotli_static` + `gzip_static` (STEP 1.2 precompression)
The build now emits max-level `.br`/`.gz` siblings (commit `91a8e961`). They are only served if the
**production nginx webroot vhost** has:
```nginx
gzip_static on;
brotli_static on;
```
on the app-shell location (`/`, `/assets/`). Cross-ref the OS-tuning plan (it already adds these for
`/maps/`; extend to the webroot). Without this, nginx falls back to on-the-fly compression — still
compressed, but loses static max-level brotli (216 KB vs 240 KB on the JS) and the CPU offload.
- Also: the deploy (`deploy-webapp`) must rsync the `.br`/`.gz` siblings to the webroot.

### 2. Integrated BlueMap webserver — does it serve `.br`/`.gz` siblings? [INVESTIGATE]
mapa.m2x.pl uses nginx, but other BlueMap users serve the webapp via the **integrated Java webserver**
(extracts `webapp.zip`). If that server does NOT serve precompressed siblings, the `.br`/`.gz` files
are dead weight in the jar for those users (they get on-the-fly or no compression).
- Action: check the web request handler (`common/.../web/`, e.g. `MapStorageRequestHandler` / the
  static file serving) — does it look for `$uri.br`/`$uri.gz` + `Accept-Encoding`? If not, decide:
  (a) teach it to serve precompressed siblings, or (b) accept nginx-only benefit and document.

---

## ✅ DONE — build-system (committed)

### 3. gradle `zipWebapp` excludes `**/*.map` (commit `b41374de`)
`common/build.gradle.kts` no longer zips sourcemaps into `webapp.zip`. Java/gradle change, done.

---

## 🟡 OPTIONAL — expose new webapp knobs as server-admin config

### 4. settings.json generation for tile-loading knobs
The JS source now carries the optimized defaults directly (`maxConcurrentLoads=16`,
`loadBackoffMs=200ms`, `PRBMLoader.useWorker=true`, `pauseUpdatesWhenHidden=true`) — confirmed at
the concurrency-sweep knee (parse-bound, 1 Gbit/s non-binding). These take effect even when the
backend-generated `settings.json` omits these fields entirely, so **the win ships with no backend
change required**. Exposing the knobs in `settings.json` via Java plugin config (WebFilesManager
/ WebAppConfig) is a nice-to-have for server-admin tunability only.
Not required; only for admin-configurability.

---

## 🔴 SHIPPED FE — needs Backend Engineer review (serving headers + scope)

### 5. Service Worker app-shell precache (SHIPPED, commit `ceded7e1`)
A Service Worker now ships in the build. It works client-side without backend changes, but two
**serving** concerns (update propagation + scope) need a Backend Engineer sign-off, and the
integrated-Java-webserver path needs verifying.

**FE changes made (shipped on `fork/ashwalk33r`):**
- Added `vite-plugin-pwa` (workbox `generateSW`) to `common/webapp/vite.config.js`, gated by
  `VITE_PWA` (default **on**; build with `VITE_PWA=false` to ship no SW). `manifest: false` — the
  existing `assets/manifest.webmanifest` is kept.
- Build emits three files at the **webapp root**: `sw.js` (~1.7 KB, the worker), `workbox-<hash>.js`
  (~14.7 KB, runtime), `registerSW.js` (~136 B, registration shim **auto-injected into
  `index.html`**). Confirmed in `dist/`.
- The SW **precaches only the immutable app shell**: `index.html` + hashed `assets/*.{js,css,woff2}`
  (workbox `globPatterns`); `**/*.map` and `sql.php` excluded (~18 precached entries).
- `registerType: 'autoUpdate'` + `skipWaiting` + `clientsClaim` + `cleanupOutdatedCaches`: each new
  deploy installs the new precache, activates immediately, claims open tabs, and deletes the old
  precache.
- **Tiles and live data are never touched by the SW** — by design: `runtimeCaching: []` (no runtime
  caching at all) and `navigateFallback: null` with
  `navigateFallbackDenylist: [/\/maps\//, /\/settings\.json$/, /\/live\//]`. So `/maps/**` tiles and
  `live/*.json` are always network-only; only the shell is cached.
- Respects BlueMap's `base: './'` relative deployment (SW + registration use relative paths).

**Expected BE changes to review:**
1. **Serve the SW scripts `no-cache`** so updates propagate (else clients pin an old `sw.js`). nginx
   webroot:
   ```nginx
   location = /sw.js          { add_header Cache-Control "no-cache"; }
   location = /registerSW.js  { add_header Cache-Control "no-cache"; }
   ```
   Also serve **`index.html` `no-cache`/short max-age** so new asset hashes + the new SW are
   discovered on revisit. `assets/*` and `workbox-<hash>.js` are content-hashed → keep
   `immutable`, long max-age.
2. **Scope:** the SW must be served from the **app root** so its scope (`./` → the script's
   directory) covers the whole shell. Webroot deploy at `/` → scope `/` automatically. Under a
   sub-path it controls only that sub-path (fine); only set `Service-Worker-Allowed` if scope must be
   broadened above the script location.
3. **HTTPS required** — SWs register only over HTTPS (or localhost). mapa.m2x.pl is TLS → OK.
4. **Integrated Java webserver path** (non-nginx users): the `webapp.zip` extraction must place
   `sw.js` / `registerSW.js` / `workbox-<hash>.js` at the served **root**, and the static handler
   should send `Cache-Control: no-cache` for `sw.js` + `registerSW.js`. **Verify** registration works
   under `base: './'`. If that server can't set per-file cache headers, the SW still functions but
   updates lag by its default cache TTL — acceptable; document it.
5. **Deploy (`deploy-webapp`)** must rsync `sw.js`, `registerSW.js`, `workbox-<hash>.js` (and their
   `.br`/`.gz` siblings) to the webroot alongside the shell.
6. **Don't re-introduce tile/live caching** at any proxy layer — the FE already excludes them; just
   ensure no edge rule caches `/maps/**` or `live/*.json` in a way that conflicts.

**Verification:** DevTools → Application → Service Workers shows `sw.js` activated; reload → shell
served from SW (≈0 network for the shell); redeploy → new SW activates within one reload;
`/maps/` + `live/*.json` always hit the network.

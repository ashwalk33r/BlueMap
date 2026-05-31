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
The webapp reads `tileLoadConcurrency` (default 16) and `tileLoadBackoffMs` (default 200) from
`settings.json`, falling back to defaults when absent — so it works out-of-box. To let server admins
tune them via the BlueMap plugin config, the **Java settings.json generator** (WebAppConfig / the code
that writes the served `settings.json`) would need to emit these fields from plugin config.
Not required; only for admin-configurability.

---

## ⏳ UPCOMING — backend implications of planned FE steps

### 5. Service Worker (STEP 6a) — serving headers + scope
The SW (`sw.js`/workbox) precaches the app shell. Backend/ops needs:
- **nginx:** serve the service-worker script with `Cache-Control: no-cache` (or very short max-age) so
  SW updates propagate; hashed precached assets stay long-cached/immutable.
- **Integrated Java webserver:** must serve the SW file at the **root scope** with the same no-cache
  header, and the `webapp.zip` extraction must place it at the served root. Verify SW registration
  works with BlueMap's `base: './'` relative deployment.
- SW must be scoped to **app shell only** — never cache `/maps/**` tiles or `live/*.json`.

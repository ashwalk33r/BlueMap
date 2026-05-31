/*
 * Small round-robin pool of PRBM decode workers. parse(buffer) returns a Promise
 * resolving to the decoded {attributes, indices, groups}. Falls back to null if
 * Web Workers are unavailable so the caller can decode synchronously.
 */

let pool = null;

class PrbmWorkerPool {
    constructor(size) {
        this.size = size;
        this.workers = [];
        this.next = 0;
        this.seq = 0;
        this.pending = new Map(); // id -> {resolve, reject}
        for (let i = 0; i < size; i++) {
            const w = new Worker(new URL("./prbm.worker.js", import.meta.url), { type: "module" });
            w.onmessage = (e) => {
                const { id, decoded, error } = e.data;
                const cb = this.pending.get(id);
                if (!cb) return;
                this.pending.delete(id);
                if (error) cb.reject(new Error(error));
                else cb.resolve(decoded);
            };
            w.onerror = (err) => { /* surfaced per-request via reject on timeout-free path */ console.error("prbm worker error", err); };
            this.workers.push(w);
        }
    }

    parse(buffer, offset = 0) {
        const id = this.seq++;
        const worker = this.workers[this.next];
        this.next = (this.next + 1) % this.size;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            // buffer is transferred to the worker (zero-copy); caller must not reuse it
            worker.postMessage({ id, buffer, offset }, [buffer]);
        });
    }
}

/** Get (lazily create) the shared pool, or null if Workers aren't supported. */
export function getPrbmWorkerPool() {
    if (pool === false) return null;
    if (pool) return pool;
    if (typeof Worker === "undefined") { pool = false; return null; }
    try {
        const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
        const size = Math.min(6, Math.max(2, cores - 1));
        pool = new PrbmWorkerPool(size);
        return pool;
    } catch (e) {
        console.warn("PRBM worker pool unavailable, falling back to main-thread parse:", e);
        pool = false;
        return null;
    }
}

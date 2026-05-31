/*
 * PRBM decode worker — runs the CPU-bound PRWM parse off the main thread.
 * Receives {id, buffer, offset}; posts back {id, attributes, indices, groups},
 * transferring the decoded array buffers zero-copy. Errors post {id, error}.
 */
import { decodePrwm, collectTransferables } from "./prbmDecode.js";

self.onmessage = (e) => {
    const { id, buffer, offset } = e.data;
    try {
        const decoded = decodePrwm(buffer, offset);
        const transfer = collectTransferables(decoded);
        self.postMessage({ id, decoded }, transfer);
    } catch (err) {
        self.postMessage({ id, error: String(err && err.message || err) });
    }
};

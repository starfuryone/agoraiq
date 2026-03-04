"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nightlyReconcile = nightlyReconcile;
const env_1 = require("../config/env");
async function nightlyReconcile() {
    console.log("[Reconciler] Starting nightly full reconciliation...");
    const res = await fetch(`${env_1.config.AGORAIQ_API_URL}/internal/telegram/resyncMemberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env_1.config.AGORAIQ_WORKER_API_KEY}` },
    });
    if (!res.ok)
        throw new Error(`Nightly reconcile failed: ${res.status}`);
    const data = await res.json();
    console.log(`[Reconciler] Nightly done: synced=${data.synced} removed=${data.removed} errors=${data.errors}`);
    return data;
}
//# sourceMappingURL=nightlyReconcile.js.map
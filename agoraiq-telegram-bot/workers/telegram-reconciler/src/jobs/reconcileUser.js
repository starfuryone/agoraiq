"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileUser = reconcileUser;
const env_1 = require("../config/env");
async function reconcileUser(userId, reason) {
    console.log(`[Reconciler] Reconciling user=${userId} reason=${reason}`);
    const res = await fetch(`${env_1.config.AGORAIQ_API_URL}/internal/telegram/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env_1.config.AGORAIQ_WORKER_API_KEY}` },
        body: JSON.stringify({ user_id: userId, reason }),
    });
    if (!res.ok)
        throw new Error(`Reconcile failed: ${res.status}`);
    const data = await res.json();
    console.log(`[Reconciler] user=${userId} actions=${data.actions_taken?.length || 0}`);
    return { userId, actions: data.actions_taken || [] };
}
//# sourceMappingURL=reconcileUser.js.map
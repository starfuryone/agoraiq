"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupInvites = cleanupInvites;
const env_1 = require("../config/env");
async function cleanupInvites() {
    console.log("[Reconciler] Cleaning up expired invites...");
    const res = await fetch(`${env_1.config.AGORAIQ_API_URL}/internal/telegram/revokeExpired`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env_1.config.AGORAIQ_WORKER_API_KEY}` },
    });
    if (!res.ok)
        throw new Error(`Invite cleanup failed: ${res.status}`);
    const data = await res.json();
    console.log(`[Reconciler] Cleaned up ${data.revoked_count} expired invites`);
    return { revokedCount: data.revoked_count };
}
//# sourceMappingURL=cleanupInvites.js.map
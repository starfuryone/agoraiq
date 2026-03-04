import { config } from "../config/env";

export async function cleanupInvites() {
  console.log("[Reconciler] Cleaning up expired invites...");
  const res = await fetch(`${config.AGORAIQ_API_URL}/internal/telegram/revokeExpired`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.AGORAIQ_WORKER_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Invite cleanup failed: ${res.status}`);
  const data = await res.json();
  console.log(`[Reconciler] Cleaned up ${data.revoked_count} expired invites`);
  return { revokedCount: data.revoked_count };
}

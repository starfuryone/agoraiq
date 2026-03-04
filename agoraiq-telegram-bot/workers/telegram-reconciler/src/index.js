"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const env_1 = require("./config/env");
const reconcileUser_1 = require("./jobs/reconcileUser");
const nightlyReconcile_1 = require("./jobs/nightlyReconcile");
const cleanupInvites_1 = require("./jobs/cleanupInvites");
const connection = { url: env_1.config.REDIS_URL };
const reconcileQueue = new bullmq_1.Queue("telegram:reconcile", { connection });
const scheduledQueue = new bullmq_1.Queue("telegram:scheduled", { connection });
new bullmq_1.QueueScheduler("telegram:scheduled", { connection });
async function setupCronJobs() {
    await scheduledQueue.add("nightly-reconcile", {}, {
        repeat: { pattern: env_1.config.RECONCILE_CRON }, removeOnComplete: { count: 10 }, removeOnFail: { count: 50 }
    });
    await scheduledQueue.add("cleanup-invites", {}, {
        repeat: { pattern: env_1.config.INVITE_CLEANUP_CRON }, removeOnComplete: { count: 10 }, removeOnFail: { count: 50 }
    });
    console.log("[Worker] Cron jobs scheduled");
}
const reconcileWorker = new bullmq_1.Worker("telegram:reconcile", async (job) => {
    return (0, reconcileUser_1.reconcileUser)(job.data.userId, job.data.reason);
}, { connection, concurrency: 5, limiter: { max: 20, duration: 60_000 } });
reconcileWorker.on("completed", (job) => console.log(`[Worker] Reconcile completed: job=${job.id}`));
reconcileWorker.on("failed", (job, err) => console.error(`[Worker] Reconcile failed: job=${job?.id}`, err));
const scheduledWorker = new bullmq_1.Worker("telegram:scheduled", async (job) => {
    if (job.name === "nightly-reconcile")
        return (0, nightlyReconcile_1.nightlyReconcile)();
    if (job.name === "cleanup-invites")
        return (0, cleanupInvites_1.cleanupInvites)();
    console.warn(`[Worker] Unknown job: ${job.name}`);
}, { connection, concurrency: 1 });
scheduledWorker.on("completed", (job) => console.log(`[Worker] Scheduled completed: ${job.name}`));
scheduledWorker.on("failed", (job, err) => console.error(`[Worker] Scheduled failed: ${job?.name}`, err));
setupCronJobs().then(() => console.log("[Worker] Telegram reconciler started"));
process.on("SIGTERM", async () => {
    console.log("[Worker] Shutting down...");
    await reconcileWorker.close();
    await scheduledWorker.close();
    process.exit(0);
});
//# sourceMappingURL=index.js.map
import { Queue, Worker, Job } from "bullmq";
import { config } from "./config/env";
import { reconcileUser } from "./jobs/reconcileUser";
import { nightlyReconcile } from "./jobs/nightlyReconcile";
import { cleanupInvites } from "./jobs/cleanupInvites";

const connection = { url: config.REDIS_URL };

const reconcileQueue = new Queue("telegram:reconcile", { connection });
const scheduledQueue = new Queue("telegram:scheduled", { connection });

async function setupCronJobs() {
  await scheduledQueue.add("nightly-reconcile", {}, {
    repeat: { pattern: config.RECONCILE_CRON }, removeOnComplete: { count: 10 }, removeOnFail: { count: 50 }});
  await scheduledQueue.add("cleanup-invites", {}, {
    repeat: { pattern: config.INVITE_CLEANUP_CRON }, removeOnComplete: { count: 10 }, removeOnFail: { count: 50 }});
  console.log("[Worker] Cron jobs scheduled");
}

const reconcileWorker = new Worker("telegram:reconcile", async (job: Job) => {
  return reconcileUser(job.data.userId, job.data.reason);
}, { connection, concurrency: 5, limiter: { max: 20, duration: 60_000 } });

reconcileWorker.on("completed", (job) => console.log(`[Worker] Reconcile completed: job=${job.id}`));
reconcileWorker.on("failed", (job, err) => console.error(`[Worker] Reconcile failed: job=${job?.id}`, err));

const scheduledWorker = new Worker("telegram:scheduled", async (job: Job) => {
  if (job.name === "nightly-reconcile") return nightlyReconcile();
  if (job.name === "cleanup-invites") return cleanupInvites();
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

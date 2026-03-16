// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/event-bus.ts
// Central event bus using BullMQ (Redis-backed)
//
// Architecture:
//   Producers (market data, signals, whale tracker, etc.)
//       ↓  publish typed events
//   Redis Stream (BullMQ queue)
//       ↓  consumed by
//   Alert Engine (evaluates rules, dispatches notifications)
//
// Install:  pnpm add bullmq ioredis
// ─────────────────────────────────────────────────────────────

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis }     from 'ioredis';
import type { AlertEvent, AlertCategory } from './event-types';
import { EVENT_CHANNELS } from './event-types';

// ── Redis connection ──────────────────────────────────────────

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,  // required by BullMQ
      enableReadyCheck:     false,
    });
  }
  return _redis;
}

// ── Alert Event Queue ─────────────────────────────────────────

const QUEUE_NAME = 'agoraiq:alert-events';

let _queue: Queue | null = null;

export function getAlertQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 5000 },  // keep 1h or 5k jobs
        removeOnFail:     { age: 86400, count: 1000 },  // keep 24h failures
        attempts:         3,
        backoff:          { type: 'exponential', delay: 1000 },
      },
    });
  }
  return _queue;
}

// ── Producer: publish an event to the bus ─────────────────────

export async function publishEvent(event: AlertEvent): Promise<string> {
  const queue = getAlertQueue();

  const job = await queue.add(
    event.category,  // job name = category for filtering
    event,
    {
      // Priority mapping: CRITICAL=1 (highest), LOW=4
      priority: eventPriorityToJobPriority(event),
      // Dedup: jobs with same dedup key within 60s are rejected
      jobId: buildDedupKey(event),
    },
  );

  return job.id ?? event.id;
}

// ── Batch producer: publish multiple events ───────────────────

export async function publishEvents(events: AlertEvent[]): Promise<void> {
  const queue = getAlertQueue();
  await queue.addBulk(
    events.map(event => ({
      name: event.category,
      data: event,
      opts: {
        priority: eventPriorityToJobPriority(event),
        jobId:    buildDedupKey(event),
      },
    })),
  );
}

// ── Consumer: create a worker that processes alert events ─────

export type AlertEventHandler = (event: AlertEvent, job: Job) => Promise<void>;

export function createAlertWorker(
  handler: AlertEventHandler,
  opts: {
    concurrency?:  number;
    categories?:   AlertCategory[];  // filter to specific categories (default: all)
  } = {},
): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<AlertEvent>) => {
      const event = job.data;

      // Category filter (if specified)
      if (opts.categories && !opts.categories.includes(event.category)) {
        return; // skip silently
      }

      await handler(event, job);
    },
    {
      connection:  getRedis(),
      concurrency: opts.concurrency ?? 5,
    },
  );

  worker.on('failed', (job: any, err: Error) => {
    console.error(`[event-bus] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err: Error) => {
    console.error('[event-bus] Worker error:', err);
  });

  return worker;
}

// ── Queue events (for monitoring) ─────────────────────────────

export function createQueueMonitor(): QueueEvents {
  return new QueueEvents(QUEUE_NAME, { connection: getRedis() });
}

// ── Dedup key builder ─────────────────────────────────────────
// Same event type + asset + key attributes = same dedup key
// BullMQ rejects duplicate jobIds, preventing spam

function buildDedupKey(event: AlertEvent): string {
  const parts = [event.category, event.asset];

  switch (event.category) {
    case 'SIGNAL':
      parts.push(event.signalId);
      break;
    case 'MARKET':
      parts.push(event.type, event.timeframe);
      break;
    case 'WHALE':
      parts.push(event.type, event.txHash ?? String(event.amountUsd));
      break;
    case 'LIQUIDATION':
      parts.push(event.type, event.side, String(Math.floor(event.amountUsd / 1_000_000)));
      break;
    case 'PUMP':
      parts.push(event.detectionWindow, String(Math.floor(event.priceChange)));
      break;
  }

  // Add a time bucket so dedup expires after the window
  const bucket = Math.floor(Date.now() / 60_000); // 1-minute buckets
  parts.push(String(bucket));

  return parts.join(':');
}

// ── Priority mapping ──────────────────────────────────────────

function eventPriorityToJobPriority(event: AlertEvent): number {
  // Some events are inherently higher priority
  if (event.category === 'LIQUIDATION' && event.type === 'LIQUIDATION_CASCADE') return 1;
  if (event.category === 'WHALE' && event.amountUsd > 100_000_000) return 1;
  if (event.category === 'PUMP') return 2;
  if (event.category === 'LIQUIDATION') return 2;
  if (event.category === 'WHALE') return 3;
  if (event.category === 'MARKET') return 3;
  if (event.category === 'SIGNAL') return 3;
  return 4;
}

// ── Graceful shutdown ─────────────────────────────────────────

export async function shutdownEventBus(): Promise<void> {
  if (_queue)  await _queue.close();
  if (_redis)  await _redis.quit();
  _queue = null;
  _redis = null;
}

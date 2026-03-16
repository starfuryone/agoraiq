/**
 * @agoraiq/signal-engine — Lifecycle Tracking
 *
 * Optional local signal lifecycle tracking. In production, the
 * existing @agoraiq/tracker package handles this for all providers
 * including the engine. This module is provided for standalone
 * testing or future use cases where the engine needs to track
 * its own signals independently.
 *
 * Deferred to Phase 3+.
 */

import { logger } from "./services/logger";

/**
 * Track active signals and update their status.
 * In production, @agoraiq/tracker does this.
 */
export async function trackActiveSignals(): Promise<void> {
  logger.debug(
    "Lifecycle tracking deferred to @agoraiq/tracker (no-op in engine)"
  );
}

/** BullMQ lock/timer settings — must stay in sync between JobWorker and BullMQJobQueue */
export const LOCK_DURATION = 300_000;             // 5min (Worker config)
export const LOCK_EXTENSION_INTERVAL = 150_000;   // 2.5min (lockDuration / 2)
export const STALLED_INTERVAL = 60_000;           // 1min
export const CANCELLATION_POLL_INTERVAL = 5_000;  // 5s (backup for pub/sub)

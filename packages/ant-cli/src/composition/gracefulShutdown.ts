/**
 * Graceful Shutdown Registry
 * 
 * Provides a module-level registry for the active TaskOrchestrator instance.
 * When job-runner receives SIGTERM, the handler uses this registry to
 * invoke the orchestrator's handleInterruption(), which saves a final
 * checkpoint before the process exits.
 * 
 * Flow:
 *   1. parallelOrchestrator (graph.ts) registers the orchestrator on start
 *   2. SIGTERM arrives → job-runner calls handleGracefulShutdown()
 *   3. handleGracefulShutdown() calls orchestrator.handleInterruption()
 *   4. Orchestrator pushes running tasks back to queue + saves checkpoint
 *   5. Process exits cleanly (exit code 143)
 * 
 * @see job-runner.ts  — SIGTERM handler
 * @see graph.ts        — registerActiveOrchestrator() call site
 * @see TaskOrchestrator.ts — handleInterruption() implementation
 */

/** Minimal interface for the orchestrator — avoids importing the full generic class */
interface GracefulOrchestrator {
  handleInterruption(reason: string): Promise<void>;
}

let activeOrchestrator: GracefulOrchestrator | null = null;
let isShuttingDown = false;

/**
 * Register the currently running orchestrator so the SIGTERM handler can reach it.
 * Called by parallelOrchestrator in graph.ts right before orchestrator.run().
 */
export function registerActiveOrchestrator(orchestrator: GracefulOrchestrator): void {
  activeOrchestrator = orchestrator;
}

/**
 * Unregister the orchestrator (called after orchestrator.run() completes).
 */
export function unregisterActiveOrchestrator(): void {
  activeOrchestrator = null;
}

/**
 * Attempt graceful shutdown of the active orchestrator.
 * 
 * - If an orchestrator is registered, calls handleInterruption() which
 *   pushes running tasks back to the queue and saves a final checkpoint.
 * - If no orchestrator is registered (e.g. still in decompose phase),
 *   returns immediately — the decompose checkpoint already has full state.
 * - Guards against double invocation.
 * 
 * @param reason - The interruption reason (e.g. 'user_stopped')
 * @param timeoutMs - Maximum time to wait for graceful shutdown (default 2500ms)
 */
export async function handleGracefulShutdown(reason: string, timeoutMs = 1800): Promise<void> {
  if (isShuttingDown) {
    console.log(`[GracefulShutdown] Already shutting down, skipping duplicate call`);
    return;
  }
  isShuttingDown = true;

  const mem = process.memoryUsage();
  console.log(JSON.stringify({
    event: 'GRACEFUL_SHUTDOWN_START',
    reason,
    processUptime: `${Math.round(process.uptime())}s`,
    memoryMB: {
      rss: Math.round(mem.rss / 1048576),
      heapUsed: Math.round(mem.heapUsed / 1048576),
      heapTotal: Math.round(mem.heapTotal / 1048576),
    },
    hasActiveOrchestrator: !!activeOrchestrator,
    timeoutMs,
    timestamp: new Date().toISOString(),
  }));

  if (activeOrchestrator) {
    console.log(`[GracefulShutdown] Interrupting orchestrator (reason: ${reason}, timeout: ${timeoutMs}ms)...`);

    // Race between handleInterruption and a hard timeout.
    // If handleInterruption takes too long (e.g. stuck acquiring lock),
    // we bail out so the process can exit before SIGKILL arrives.
    const interruptionPromise = activeOrchestrator.handleInterruption(reason).then(() => {
      console.log(`[GracefulShutdown] ✅ Orchestrator interrupted and checkpoint saved`);
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn(`[GracefulShutdown] ⚠️ Timeout reached (${timeoutMs}ms) — proceeding with exit`);
        resolve();
      }, timeoutMs);
    });

    await Promise.race([interruptionPromise, timeoutPromise]);
  } else {
    console.log(`[GracefulShutdown] No active orchestrator registered — checkpoint from previous phase is still valid`);
  }
}

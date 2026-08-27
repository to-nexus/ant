/**
 * Subagent tunables — env-overridable constants, lazily read on every call
 * (same pattern as core/config/vectorDbCapability.ts so tests can flip at
 * runtime). There is NO enable flag: explore is always on; only limits tune.
 */

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** Child tool-loop round cap. */
export const subagentMaxRounds = (): number => envInt('ANT_SUBAGENT_MAX_ROUNDS', 12);

/** Inline report ceiling (chars) — the parent-facing interface budget, not the child's exploration budget. */
export const subagentMaxReportChars = (): number => envInt('ANT_SUBAGENT_MAX_REPORT_CHARS', 16_000);

/** Ceiling for the full report kept for drill-down and persisted on the chat line (chars). */
export const subagentMaxReportPersistChars = (): number =>
  envInt('ANT_SUBAGENT_MAX_REPORT_PERSIST_CHARS', 100_000);

/** Concurrent children per ownerKey (job × worker/task scope). */
export const subagentMaxConcurrent = (): number => envInt('ANT_SUBAGENT_MAX_CONCURRENT', 3);

/** Hard wall-clock bound for one child run. */
export const subagentTimeoutMs = (): number => envInt('ANT_SUBAGENT_TIMEOUT_MS', 300_000);

/** Join-barrier wait bound (slightly above the child timeout so the child's own bound fires first). */
export const subagentJoinTimeoutMs = (): number => envInt('ANT_SUBAGENT_JOIN_TIMEOUT_MS', 330_000);

/** Starvation guard: pending entries older than this are force-drained at the next drain site. */
export const subagentMaxPendingAgeMs = (): number =>
  envInt('ANT_SUBAGENT_MAX_PENDING_AGE_MS', subagentTimeoutMs() + 30_000);

/**
 * Child max output tokens per round. Adaptive-thinking models spend reasoning
 * from this same budget and cannot be disabled on the stream channel, so the
 * cap must hold thinking + a full report (subagentMaxReportChars ≈ 16K chars)
 * together — 8192 physically could not (local-nursing-churn RCA). Anthropic
 * OTPM pre-reserves by max_tokens (3 concurrent children reserve ~72K);
 * withRetryStream absorbs the resulting 429s. Raising here (the one consumer
 * is SubagentRunner) was chosen over an adapter-level adaptive floor, which
 * would silently raise every stream caller's billing ceiling.
 */
export const subagentMaxTokens = (): number => envInt('ANT_SUBAGENT_MAX_TOKENS', 24576);

/** Output cap for the one corrective re-ask after a degenerate round — reduced
 * so a second degeneration is cheap. */
export const subagentReAskMaxTokens = (): number => envInt('ANT_SUBAGENT_REASK_MAX_TOKENS', 4096);

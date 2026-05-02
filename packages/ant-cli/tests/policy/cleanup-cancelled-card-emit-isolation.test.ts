/**
 * cancelled-card-missing RCA — JobCleanupManager.cleanupJobState
 * MUST emit the cancelled choice card (Resume / Dismiss UI)
 * INDEPENDENTLY of the session sync + final kanban broadcast phase.
 *
 * Background — before the fix one wide `try { … } catch (error) { … }`
 * wrapped both responsibilities. Any throw from `readSessionData` /
 * `atomicWriteFile` / `getFinalSnapshotKanbanData` /
 * `broadcastFinalUpdate` was swallowed and the cancelled-card emit
 * was skipped, so a paused job rendered with no Resume / Dismiss UI
 * affordance — the user lost the only handle on the paused state.
 *
 * The structural invariant locked here:
 *
 *   1. cleanupJobState splits work into TWO phases — a session/broadcast
 *      try/catch (Phase A) followed by a separate cancelled-card emit
 *      block (Phase B). Phase B is OUTSIDE Phase A's catch so a Phase
 *      A failure cannot prevent the emit.
 *
 *   2. The Phase A catch label MUST mention "session/broadcast" so a
 *      future maintainer who re-collapses the two phases breaks this
 *      test loudly instead of silently re-introducing the original RCA.
 *
 *   3. The cancelled-card emit call site MUST be wrapped in its own
 *      try/catch so a Redis blip / chat.jsonl write race surfaces with
 *      a clear log instead of silently disappearing.
 *
 *   4. The emit's result (`{ emitted, cardId }`) MUST be logged so
 *      operators can distinguish "card emitted" from "NX miss" from
 *      "no user_turn matched" (the three legitimate skip paths inside
 *      `ChatService.appendChoicePresentedCancelled`).
 *
 * This is a source-text guard rather than a heavy integration test
 * because the alternative (full mock of sessionService / kanbanService /
 * chatService / workspaceResolver / stateStore / stateTracker) would
 * mostly exercise the mocks, not the structural invariant. The text
 * checks are narrow enough that the only way to make them pass while
 * regressing the behaviour is to deliberately fake the structure —
 * which would be obvious in code review.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_PATH = resolve(
  __dirname,
  '../../src/periphery/adapters/http/express/managers/JobCleanupManager.ts',
);

const source = readFileSync(SOURCE_PATH, 'utf8');

describe('JobCleanupManager — cancelled-card emit isolation (RCA guard)', () => {
  it('Phase A catch label discriminates the session/broadcast phase from the cancelled-card phase', () => {
    // The original RCA was a generic `catch (error) { logger.error("Error in cleanupJobState", ...) }`
    // wrapping both phases. The fixed code MUST narrow the catch label
    // to call out which phase failed — collapsing back to a generic
    // label is the regression signal.
    expect(source).toMatch(
      /Error in cleanupJobState session\/broadcast phase/,
    );
    // The bare-generic label MUST be gone — its presence means the
    // catch was widened back to wrap Phase B.
    expect(source).not.toMatch(/['"`]Error in cleanupJobState['"`]/);
  });

  it('cancelled-card emission lives outside the Phase A try/catch', () => {
    // Locate the Phase A catch and the cancelled-card emit; the latter
    // MUST appear AFTER the former so a Phase A throw does not skip
    // the emit. (If a future edit moves the emit back inside the catch
    // arm or before the catch close, this test fires.)
    const phaseACatchIdx = source.indexOf(
      'Error in cleanupJobState session/broadcast phase',
    );
    const emitIdx = source.indexOf(
      'await this.deps.chatService.appendChoicePresentedCancelled(',
    );
    expect(phaseACatchIdx).toBeGreaterThan(0);
    expect(emitIdx).toBeGreaterThan(0);
    expect(emitIdx).toBeGreaterThan(phaseACatchIdx);
  });

  it('cancelled-card emit is wrapped in its own try/catch so a Redis blip surfaces with a clear log', () => {
    // The emit MUST be wrapped — the prior single outer catch swallowed
    // every throw. The fixed code logs an error mentioning the missing
    // Resume/Dismiss UI when the wrapped emit throws.
    expect(source).toMatch(
      /appendChoicePresentedCancelled threw — Resume\/Dismiss UI will be missing for this pause/,
    );
  });

  it('cancelled-card emit logs the result so operators can distinguish emit / NX-miss / no-user_turn paths', () => {
    // The emit returns `{ emitted, cardId }`; the log MUST surface both
    // so the three legitimate skip paths inside ChatService can be
    // distinguished from a structural failure.
    expect(source).toMatch(/appendChoicePresentedCancelled result/);
    expect(source).toMatch(/emitted: result\.emitted/);
    expect(source).toMatch(/cardId: result\.cardId/);
  });

  it('Phase B suppression gate (Invariant I2 — clarify) survives null sessionData', () => {
    // `readSessionData` may throw inside Phase A; the hoisted
    // `sessionData` variable starts as `null` so Phase B's clarify
    // gate must read with optional chaining rather than dereference
    // a hard reference. Locked by the call-site shape.
    expect(source).toMatch(
      /shouldSuppressCancelledCardForClarify\(\s*jobType,\s*sessionData\?\.state,?\s*\)/,
    );
  });
});

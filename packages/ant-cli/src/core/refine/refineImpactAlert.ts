/**
 * refineImpactAlert — emit `chat_status` after a `rev-plan` turn so the
 * operator sees which design tasks are now stale.
 *
 * Wiring: invoked from
 * `agents/planner/graph/plan/nodes/generate/index.ts` after the refined
 * `prd.md` / `gdd.md` is written to disk. Loads the latest design
 * session checkpoint, runs the extract → diff → detect cascade, and
 * appends a `chat_status` line with `statusType='refine_impact'`.
 *
 * Design constraint — F3.0 false-negative guard:
 *
 * `extractDependencies` records `hasPrdRef` per task. Tasks built
 * without the canonical plan doc as `role='ref'` are surfaced via the
 * separate `unscannableTaskIds` field in the metadata so the FE banner
 * can flag them as "sync cannot speak for these tasks" rather than
 * silently classifying them as not-affected.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RefineImpactMetadata } from '@ant/shared';
import { getChatLogAppender } from '../llm-response/chatLogAppenderRegistry';
import {
  extractDependencies,
  type DesignSessionCheckpointLike,
} from './extractDependencies';
import {
  extractPlanDiff,
  type ExtractPlanDiffInput,
} from './extractPlanDiff';
import { detectAffectedTasks } from './detectAffectedTasks';

export interface RefineImpactAlertInput {
  featurePath: string;
  /** `prd.md` (service domain) or `gdd.md` (game domain). */
  updatedDoc: 'prd.md' | 'gdd.md';
  /** Optional cascade signals — at least one is recommended for non-empty diffs. */
  llmResponse?: string;
  gitDiff?: string;
  directive?: string;
  /** Override for tests so `getChatLogAppender()` can be stubbed. */
  appender?: {
    appendChatStatus(
      cardId: string,
      statusType: 'refine_impact',
      metadata: RefineImpactMetadata,
    ): void;
    isReady(): boolean;
  };
}

export interface RefineImpactAlertResult {
  /** True when a chat_status was emitted (diff non-empty AND appender ready). */
  emitted: boolean;
  metadata: RefineImpactMetadata;
}

/** Path resolution mirrors `FileSessionAdapter`'s `getSessionPath`. */
function designSessionPath(featurePath: string): string {
  return path.join(featurePath, 'sessions', 'architect', 'design.json');
}

/**
 * Read the design session JSON. Tolerant of missing file (no design
 * job has run yet) — returns null so the caller emits an empty
 * "no affected tasks" alert instead of crashing.
 */
async function readDesignCheckpoint(
  featurePath: string,
): Promise<DesignSessionCheckpointLike | null> {
  const sessionPath = designSessionPath(featurePath);
  try {
    const raw = await fs.readFile(sessionPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Sessions persist `state` as the checkpoint payload; fall back to
    // the parsed root for older formats.
    const checkpoint = (parsed?.state ?? parsed) as DesignSessionCheckpointLike;
    return checkpoint;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    console.warn(
      `[refineImpactAlert] Failed to read design session at ${sessionPath}:`,
      (err as Error)?.message ?? err,
    );
    return null;
  }
}

/**
 * Emit a `refine_impact` chat status line summarising which design
 * tasks reference the PRD/GDD sections that the rev-plan turn just
 * touched.
 *
 * Returns the computed metadata so callers / tests can assert.
 */
export async function emitRefineImpactAlert(
  input: RefineImpactAlertInput,
): Promise<RefineImpactAlertResult> {
  const checkpoint = await readDesignCheckpoint(input.featurePath);

  const deps = checkpoint ? extractDependencies(checkpoint) : [];
  const diff = extractPlanDiff({
    doc: input.updatedDoc,
    llmResponse: input.llmResponse,
    gitDiff: input.gitDiff,
    directive: input.directive,
  } satisfies ExtractPlanDiffInput);
  const { affected, unscannableTaskIds } = detectAffectedTasks(diff, deps);

  const metadata: RefineImpactMetadata = {
    updatedDoc: input.updatedDoc,
    updatedSections: diff.updatedSections,
    diffSources: diff.sources,
    affected: affected.map(a => ({
      taskId: a.taskId,
      taskName: a.taskName,
      targetFile: a.targetFile,
      matchedSections: a.matchedSections,
    })),
    unscannableTaskIds,
  };

  // Suppress empty alerts (no diff, no design tasks). Operators don't
  // need a "PRD refined: nothing observable" card — the conversation
  // log already records the rev-plan turn.
  const isEmpty =
    metadata.updatedSections.length === 0 &&
    metadata.affected.length === 0 &&
    metadata.unscannableTaskIds.length === 0;

  const appender = input.appender ?? getChatLogAppender();
  if (!appender || !appender.isReady() || isEmpty) {
    return { emitted: false, metadata };
  }

  // `cardId` is required by the appender for last-write-wins folding.
  // Use a deterministic per-doc id so a subsequent refine for the same
  // doc replaces the previous card instead of stacking.
  const cardId = `refine-impact:${input.updatedDoc}`;
  // Cast to the appender's wider `Record<string, unknown>` metadata type
  // — the chat-status pipeline doesn't model per-statusType payloads
  // structurally, only at the renderer level (chat-status.ts).
  appender.appendChatStatus(
    cardId,
    'refine_impact',
    metadata as unknown as RefineImpactMetadata & Record<string, unknown>,
  );
  return { emitted: true, metadata };
}

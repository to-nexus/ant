/**
 * Chat Clear invariant (P2 — e2-humming-spindle II-2, load-bearing).
 *
 * Chat Clear collapses chat.jsonl for DISPLAY only — ANT's memory must
 * survive it. That holds only if the context pipeline never live-sources
 * chat.jsonl outside the sanctioned sites:
 *
 *  1. `chatTailBuilder.ts` — the P1 transitional rich tail (ask / direct),
 *     replaced by durable assistant_turn lines as P2 data accumulates.
 *  2. `featureContextBuilder.ts` `backfillExchangesFromChat` — the migration
 *     fallback for pre-P2 turns (converges to zero reads).
 *  3. `assistantTurn.ts` — WRITE-time distillation (reads the finished
 *     turn's own lines once at job end; not a hydrate-path read).
 *  4. `breadcrumb.ts` — trace scan for touched files (pre-existing,
 *     write-time only).
 *
 * Any new chat read in core/context/ must be added here CONSCIOUSLY with a
 * rationale, or the Chat Clear guarantee silently breaks.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTEXT_DIR = join(__dirname, '../../src/core/context');

const SANCTIONED_FILES = new Set([
  'chatTailBuilder.ts',
  'featureContextBuilder.ts',
  'assistantTurn.ts',
  'breadcrumb.ts',
]);

// Actual read surfaces only — prose mentions of "chat.jsonl" in comments
// (e.g. breadcrumbSummary's "trace is NOT injected" note) are not reads.
const CHAT_READ_PATTERN = /loadAllChat|loadChatByTurnIds|loadChatByJobType|getChatJsonlPath/;

describe('Chat Clear invariant — context pipeline chat.jsonl sourcing', () => {
  it('only sanctioned core/context files reference chat reads', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(CONTEXT_DIR)) {
      if (!file.endsWith('.ts')) continue;
      if (SANCTIONED_FILES.has(file)) continue;
      const source = readFileSync(join(CONTEXT_DIR, file), 'utf8');
      if (CHAT_READ_PATTERN.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the migration backfill stays bounded to a trailing window', () => {
    const source = readFileSync(join(CONTEXT_DIR, 'featureContextBuilder.ts'), 'utf8');
    // The backfill must slice a bounded tail, never scan all exchanges.
    expect(source).toContain('LENS_BACKFILL_WINDOW');
    expect(source).toMatch(/slice\(-LENS_BACKFILL_WINDOW\)/);
  });
});

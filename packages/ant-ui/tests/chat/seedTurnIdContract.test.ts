/**
 * seedTurnId contract — `addChatUserMessage` pre-allocates the turnId and the
 * caller MUST forward it to the job start.
 *
 * `POST /chat/user-message` writes the durable chat copy under a fresh turnId
 * and returns it; the worker's `recordUserTurn` reuses it only when the job
 * start carries `seedTurnId`. `FileSessionAdapter.appendUserTurn` dedups the
 * chat copy BY TURNID, so a caller that drops the id produces two `user_turn`
 * lines — the user's message renders twice and the extra turn is an orphan
 * with no `feature.jsonl` record. Worse for the worker-group dock, which
 * mirrors `turns[turns.length - 1]`: an orphan landing last empties it.
 *
 * Observed in `valid-crating-prawn` via the spec_complete → "Start
 * Development" redirect (t-9d4e6b14 orphan + t-e8bf355c real).
 *
 * Static scan, not a mock: the defect is a missing argument at a call site,
 * so the call sites themselves are what must be checked.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

/** The client wrapper itself — declares the contract, does not consume it. */
const DEFINITION = 'infrastructure/http/api/chat.ts';

/** Call sites that legitimately have no job start to forward the id to. */
const EXEMPT = new Set<string>([
  // Inline-ask on an interrupted job: `inlineAsk()` carries no seedTurnId on
  // the wire, and the ask turn is ephemeral. Lift the exemption if/when the
  // endpoint grows the field.
  'presentation/components/chat/hooks/useChatSubmit.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('seedTurnId contract', () => {
  const callers = walk(SRC)
    .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
    .filter(({ text }) => /\baddChatUserMessage\s*\(/.test(text))
    .map(({ file, text }) => ({ rel: path.relative(SRC, file).split(path.sep).join('/'), text }))
    .filter(({ rel }) => rel !== DEFINITION);

  it('finds the call sites (guard is wired to something)', () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  it.each(callers.map((c) => c.rel))('%s captures the returned turnId', (rel) => {
    if (EXEMPT.has(rel)) return;
    const { text } = callers.find((c) => c.rel === rel)!;
    expect(text).toMatch(/\{\s*turnId\s*\}\s*=\s*await\s+addChatUserMessage\s*\(/);
  });

  it.each(callers.map((c) => c.rel))('%s forwards seedTurnId to the job start', (rel) => {
    if (EXEMPT.has(rel)) return;
    const { text } = callers.find((c) => c.rel === rel)!;
    expect(text).toMatch(/seedTurnId:\s*turnId/);
  });

  it('the exemption list stays honest — every entry still calls addChatUserMessage', () => {
    for (const rel of EXEMPT) {
      expect(callers.some((c) => c.rel === rel)).toBe(true);
    }
  });
});

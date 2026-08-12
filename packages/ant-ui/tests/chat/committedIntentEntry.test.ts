/**
 * Committed-intent entry surfaces — a screen that has already decided the
 * intent MUST hand it to the backend as `actionMetadata.intent`.
 *
 * `actionMetadata.intent` presence is the single SSOT both triage
 * (`triage/index.ts` skip gate) and detect (`detect/index.ts` explicit
 * branch) read to decide explicit-vs-infer. A surface that commits the
 * intent in its own UI — QuickStart's step label is literally "starting the
 * plan job", and it pins `agent=planner` / `jobType=plan` before the user
 * types — but omits the field makes the triage LLM re-derive an answer the
 * screen already fixed. Observed in `fine-dusting-flame`:
 * `resolvedAction.source === 'infer'` on a job that could only ever have
 * been `gen-plan`.
 *
 * Second axis, same call sites: the submit-time `jobType` stamp on the
 * durable `user_turn` is PERMANENT (the worker's `recordUserTurn` copy
 * dedupes by turnId and never corrects it), so every caller must pass the
 * type the job actually starts with rather than fall through to the BE's
 * `code` default.
 *
 * Static scan, not a mock: both defects are a missing ARGUMENT at a call
 * site, so the call sites themselves are what must be checked (same
 * rationale as `seedTurnIdContract.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

/** The client wrapper itself — declares the contract, does not consume it. */
const DEFINITION = 'infrastructure/http/api/chat.ts';

/**
 * Surfaces whose UI fixes the intent before the user provides input, with the
 * intent each one is committed to. A new row belongs here whenever a screen
 * hard-codes `jobType` + `agent` for a single action.
 */
const COMMITTED_INTENT_SURFACES: Array<{ rel: string; intent: string }> = [
  // Onboarding: "flesh out an idea" → PRD. `setSelectedAgent('planner')` +
  // `setSelectedJobType('plan')` + the `quickstart.steps.plan` label leave
  // no other intent reachable, and a brand-new feature has no PRD to revise.
  { rel: 'presentation/pages/QuickStart.tsx', intent: 'gen-plan' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, ...rel.split('/')), 'utf8');
}

/**
 * Extract each `addChatUserMessage(...)` argument list by paren matching.
 * A regex cannot do this: the calls span one line in some surfaces and six
 * in others, and a lazy `[\s\S]*?\)` happily runs past the real call into
 * the next block — which is exactly how a guard like this goes vacuous.
 */
function callArgs(text: string, fn: string): string[] {
  const out: string[] = [];
  const needle = `${fn}(`;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    let depth = 0;
    for (let j = i + needle.length - 1; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i + needle.length, j));
          break;
        }
      }
    }
  }
  return out;
}

describe('committed-intent entry surfaces', () => {
  it.each(COMMITTED_INTENT_SURFACES)(
    '$rel declares intent $intent in its actionMetadata',
    ({ rel, intent }) => {
      const text = read(rel);
      expect(text).toMatch(new RegExp(`intent:\\s*'${intent}'`));
    },
  );

  it.each(COMMITTED_INTENT_SURFACES)(
    '$rel forwards actionMetadata to BOTH the turn and the job start',
    ({ rel }) => {
      const text = read(rel);
      // The durable user_turn carries the badges; the job start carries the
      // gate. Passing only one leaves the chat record and the RAC disagreeing.
      expect(callArgs(text, 'addChatUserMessage').some((a) => /\bactionMetadata\b/.test(a))).toBe(true);
      expect(callArgs(text, 'executeCodeJob').some((a) => /\bactionMetadata\b/.test(a))).toBe(true);
    },
  );
});

describe('user_turn jobType stamp — every caller passes a concrete type', () => {
  const callers = walk(SRC)
    .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
    .filter(({ text }) => /\baddChatUserMessage\s*\(/.test(text))
    .map(({ file, text }) => ({ rel: path.relative(SRC, file).split(path.sep).join('/'), text }))
    .filter(({ rel }) => rel !== DEFINITION)
    // ProjectWizardModal is unreachable dead UI: every
    // `setProjectSetupConfig({mode:'design'|'code'})` call site is commented
    // out under TEMP(action-system-compat). Drop this filter when it is
    // restored — the row then has to pass like any other.
    .filter(({ rel }) => !rel.includes('ProjectWizardModal'));

  it('finds the call sites (guard is wired to something)', () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  it.each(callers.map((c) => c.rel))('%s passes a jobType argument', (rel) => {
    const { text } = callers.find((c) => c.rel === rel)!;
    // 5th positional arg — a quoted LogJobType literal or a resolved variable.
    // The BE default is `code`, so an omitted argument silently misfiles
    // plan / design / visual / inline-ask turns forever.
    const calls = callArgs(text, 'addChatUserMessage');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const args = call.split(',').map((a) => a.trim()).filter((a) => a !== '');
      expect(args.length).toBeGreaterThanOrEqual(5);
      expect(args[4]).toMatch(/'(code|design|plan|learn|ask|inline-ask|visual|universal)'|JobType\b/);
    }
  });
});

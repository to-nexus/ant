/**
 * Round output-budget policy — every LLM streaming round carries an explicit
 * budget verdict (metal-killing-crowd RCA + full call-site audit).
 *
 * Why this axis exists: the per-round output cap is the ONLY in-stream
 * breaker. Every round-boundary safety net (Safety Net C/C2, planner
 * no-output breaker, recursionLimit) evaluates AFTER a call returns; a
 * degenerate reasoning monologue on an OpenAI-compat provider (GLM/DeepSeek —
 * reasoning shares the single `max_tokens` budget, no server-side thinking
 * cap) never returns until it hits the ceiling. An uncapped plan-shaped round
 * therefore grinds for 10–20 min with no breaker able to fire
 * (metal-killing-crowd: 224s of repeated thinking, manually stopped;
 * gentle-leaping-lathe before it).
 *
 * Verdicts:
 *   - bounded            — round runs at a small cap (< DEFAULT) and, where a
 *                          legitimately-large final emission exists, escalates
 *                          exactly once to DEFAULT (mid-`<plan>` cut only).
 *   - legit-large        — the round's legitimate output IS large (file bodies,
 *                          whole documents, 30+ task decompositions); capping
 *                          it would truncate real work. Round-boundary
 *                          breakers own the runaway there.
 *   - unbounded-by-verdict — conversational agent rounds with zero observed
 *                          incidents; a cap miss would visibly truncate a
 *                          user-facing prose answer, so no preemptive cap.
 *                          Revisit the moment an incident is observed.
 *
 * Adding a NEW streaming call site that uses LLM_MAX_TOKENS.DEFAULT without a
 * verdict row below fails the sweep at the bottom — classify it explicitly.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');

// ---------------------------------------------------------------------------
// bounded — small base cap + (where applicable) escalate-once to DEFAULT
// ---------------------------------------------------------------------------

interface BoundedSite {
  file: string;
  /** Every pattern must be present in the file. */
  mustMatch: RegExp[];
  /** Direct DEFAULT-cap stream calls must be absent (escalation refs are
   *  `escalatedMaxTokens:` / `roundMaxTokens =`, which don't match). */
  forbidDirectDefault?: boolean;
}

const BOUNDED: BoundedSite[] = [
  {
    // metal-killing-crowd RCA: the single-shot plan call (setup fast-path +
    // tool-loop fallthrough) is the sibling of the plan tool-loop and shares
    // its round budget. Escalates once on a mid-<plan> cut.
    file: 'src/agents/architect/graph/code/nodes/plan/llm/single.ts',
    mustMatch: [
      /roundMaxTokens[^=\n]*=\s*LLM_MAX_TOKENS\.PLAN_TOOL_LOOP/,
      /roundMaxTokens\s*=\s*LLM_MAX_TOKENS\.DEFAULT/,
      /maxTokens:\s*roundMaxTokens/,
    ],
    forbidDirectDefault: true,
  },
  {
    // gentle-leaping-lathe RCA: code plan tool-loop rounds.
    file: 'src/agents/architect/graph/code/nodes/plan/llm/tools.ts',
    mustMatch: [
      /maxTokens:\s*LLM_MAX_TOKENS\.PLAN_TOOL_LOOP/,
      /escalatedMaxTokens:\s*LLM_MAX_TOKENS\.DEFAULT/,
    ],
    forbidDirectDefault: true,
  },
  {
    // metal-killing-crowd audit: design plan rounds ran uncapped at DEFAULT
    // with no escalation wired (the runPlanWithTools comment even said so).
    file: 'src/agents/architect/graph/design/nodes/plan/index.ts',
    mustMatch: [
      /maxTokens:\s*LLM_MAX_TOKENS\.PLAN_TOOL_LOOP/,
      /escalatedMaxTokens:\s*LLM_MAX_TOKENS\.DEFAULT/,
    ],
    forbidDirectDefault: true,
  },
  {
    // Planner research rounds (frank-losing-rugby): explain streams a
    // user-facing reply at DEFAULT; generate/refactor run at PLAN_TOOL_LOOP
    // with a single mid-<plan> escalation.
    file: 'src/agents/planner/graph/plan/nodes/plan/index.ts',
    mustMatch: [
      /LLM_MAX_TOKENS\.PLAN_TOOL_LOOP/,
      /roundMaxTokens\s*=\s*LLM_MAX_TOKENS\.DEFAULT/,
    ],
  },
  {
    // lapis-oaring-drain: detect slot-inference rounds — no legitimate large
    // emission exists, so no escalation constant is paired.
    file: 'src/agents/common/graph/nodes/detect/inferRacWithTools.ts',
    mustMatch: [/maxTokens:\s*LLM_MAX_TOKENS\.DETECT_TOOL_LOOP/],
    forbidDirectDefault: true,
  },
];

// ---------------------------------------------------------------------------
// legit-large / unbounded-by-verdict — DEFAULT-cap sites with a reason
// ---------------------------------------------------------------------------

const LEGIT_LARGE: Record<string, string> = {
  'src/agents/architect/graph/code/nodes/execute/index.ts':
    'emits whole file bodies as tool args; Safety Net C/C2 own the round boundary',
  'src/agents/planner/graph/plan/nodes/execute/index.ts':
    'authors the full PRD document as create_file args',
  'src/agents/architect/graph/design/nodes/execute/index.ts':
    'emits design-document sections (cap already variable per round)',
  'src/agents/architect/graph/design/nodes/decompose/uiDesignDecompose.ts':
    'decompose may emit 30+ tasks against multi-ref design docs',
  'src/agents/architect/graph/design/nodes/decompose/systemDesignDecompose.ts':
    'decompose may emit 30+ tasks against multi-ref design docs',
  'src/agents/architect/graph/design/nodes/decompose/specDecompose.ts':
    'decompose may emit 30+ tasks against multi-ref design docs',
  'src/agents/architect/graph/design/nodes/decompose/gameArtDesignDecompose.ts':
    'decompose may emit 30+ tasks against multi-ref design docs',
};

const UNBOUNDED_BY_VERDICT: Record<string, string> = {
  'src/agents/architect/graph/ask/nodes/agent.ts':
    'conversational rounds, zero observed incidents; a cap would visibly truncate prose answers',
  'src/agents/universal/graph/nodes/agent.ts':
    'conversational rounds, zero observed incidents; a cap would visibly truncate prose answers',
  'src/agents/architect/graph/code/nodes/direct/index.ts':
    'Tier 0/1 direct rounds, zero observed incidents; a cap would visibly truncate prose answers',
};

// ---------------------------------------------------------------------------

describe('bounded rounds — cap + escalate-once wiring', () => {
  for (const site of BOUNDED) {
    it(`${site.file} runs at a bounded round budget`, () => {
      const src = read(site.file);
      for (const re of site.mustMatch) {
        expect(src, `expected ${re} in ${site.file}`).toMatch(re);
      }
      if (site.forbidDirectDefault) {
        // `escalatedMaxTokens:` / `roundMaxTokens =` intentionally don't match
        // (capital M) — only a direct DEFAULT-cap stream call would.
        expect(src).not.toMatch(/\bmaxTokens\s*(?::\s*number\s*)?[:=]\s*LLM_MAX_TOKENS\.DEFAULT/);
      }
    });
  }
});

describe('verdict completeness — no unclassified DEFAULT-cap stream call', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else if (entry.name.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  it('every file streaming at LLM_MAX_TOKENS.DEFAULT carries a verdict row', () => {
    const srcRoot = path.join(repoRoot, 'src');
    const offenders: string[] = [];
    const classified = new Set([
      ...Object.keys(LEGIT_LARGE),
      ...Object.keys(UNBOUNDED_BY_VERDICT),
    ]);
    for (const abs of walk(srcRoot)) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
      const src = fs.readFileSync(abs, 'utf-8');
      if (/\bmaxTokens\s*(?::\s*number\s*)?[:=]\s*LLM_MAX_TOKENS\.DEFAULT/.test(src)) {
        if (!classified.has(rel)) offenders.push(rel);
      }
    }
    expect(
      offenders,
      'new DEFAULT-cap round(s) without a verdict — add a row to LEGIT_LARGE / ' +
        'UNBOUNDED_BY_VERDICT with a reason, or bound the round (BOUNDED table)',
    ).toEqual([]);
  });

  it('verdict rows point at real files with a non-empty reason', () => {
    for (const [rel, reason] of [
      ...Object.entries(LEGIT_LARGE),
      ...Object.entries(UNBOUNDED_BY_VERDICT),
    ]) {
      expect(fs.existsSync(path.join(repoRoot, rel)), `stale verdict row: ${rel}`).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });
});

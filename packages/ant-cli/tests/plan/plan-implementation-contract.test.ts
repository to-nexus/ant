/**
 * Plan-implementation contract SSOT + anti-drift lock (level-dashing-plumb RCA).
 *
 * The defect: `implementation.assets[]` was a documented, legal key of the plan
 * schema that NO code read. The empty-plan sentinel
 * (`nodes/plan/llm/tools.ts`) enumerated only create/modify/delete, so a plan
 * whose entire content was an asset placement was byte-indistinguishable from
 * the prompt's mandatory empty-plan sentinel. Its body was discarded
 * (`preSplitPlanTextLen: 0`), the task went straight to `done`, execute never
 * ran, and the job reported success with `filesWritten: 0`.
 *
 * Two things are locked here:
 *   1. the emptiness predicate covers EVERY mutation key, and guards fan-out;
 *   2. the key set in the predicate equals the key set the prompt teaches —
 *      so a key added to one side alone fails CI instead of silently
 *      degrading into "nothing to do".
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PLAN_MUTATION_KEYS,
  planDeclaresNoWork,
  planDeclaresFanOut,
  countPlanMutations,
  extractAssetPlacements,
} from '../../src/agents/architect/graph/code/planContract/implementation';
import { finalizePlanOutcome } from '../../src/agents/architect/graph/code/nodes/plan/outcome/finalize';

const PLAN_RULES = path.resolve(
  __dirname,
  '../../src/core/prompt/templates/jobs/code/nodes/plan/rules.md',
);

const assetEntry = { source: 'assets/game/models/Duck.glb', destination: 'codebase/public/models/Duck.glb' };

describe('planDeclaresNoWork — emptiness covers every mutation key', () => {
  it('the exact level-dashing-plumb plan (assets only, others empty) declares WORK', () => {
    const plan = {
      task: { id: 'boss-model-asset-replacement', goal: '…' },
      implementation: { create: [], modify: [], delete: [], assets: [assetEntry] },
    };
    expect(planDeclaresNoWork(plan)).toBe(false);
    expect(countPlanMutations(plan)).toBe(1);
  });

  it('the canonical empty-plan sentinel still declares NO work', () => {
    const plan = {
      task: { id: 't', goal: 'Nothing to do' },
      implementation: { create: [], modify: [], delete: [], assets: [] },
    };
    expect(planDeclaresNoWork(plan)).toBe(true);
  });

  it('the legacy 3-key sentinel shape (no assets key at all) still declares NO work', () => {
    const plan = { implementation: { create: [], modify: [], delete: [] } };
    expect(planDeclaresNoWork(plan)).toBe(true);
  });

  it.each(PLAN_MUTATION_KEYS)('a lone non-empty %s key declares WORK', (key) => {
    const plan = { implementation: { [key]: [{ target: 'x', source: 'a', destination: 'b' }] } };
    expect(planDeclaresNoWork(plan)).toBe(false);
  });

  it('absent keys count as empty — { modify: [] } alone is NO work (documented generalization)', () => {
    // The legacy predicate applied `?? 0` to `delete` only, so this shape
    // slipped through as a "real" plan and entered execute with nothing to do.
    expect(planDeclaresNoWork({ implementation: { modify: [] } })).toBe(true);
  });

  it('non-array key values do not throw and count as empty', () => {
    expect(planDeclaresNoWork({ implementation: { create: null, assets: 'nope' } })).toBe(true);
  });

  it('a malformed / non-object plan is treated as declaring no work rather than throwing', () => {
    expect(planDeclaresNoWork(undefined)).toBe(true);
    expect(planDeclaresNoWork('not json')).toBe(true);
    expect(planDeclaresNoWork({})).toBe(true);
  });
});

describe('planDeclaresNoWork — fan-out guard', () => {
  // Absent-as-empty would make a fan-out plan (work lives in the children,
  // never in `implementation`) self-destruct through the sentinel. The legacy
  // predicate was protected only accidentally, by `undefined?.length === 0`
  // being false.
  it('a batches[] plan with NO implementation block declares WORK', () => {
    const plan = { task: { id: 't' }, parentReasoning: '…', batches: [{ name: 'b1', rationale: 'r' }] };
    expect(planDeclaresFanOut(plan)).toBe(true);
    expect(planDeclaresNoWork(plan)).toBe(false);
  });

  it('a seam regions[] plan (rewritten into batches only later) declares WORK', () => {
    const plan = { task: { id: 't' }, regions: [{ name: 'r1', rationale: 'r' }] };
    expect(planDeclaresFanOut(plan)).toBe(true);
    expect(planDeclaresNoWork(plan)).toBe(false);
  });

  it('empty fan-out arrays do not count as fan-out', () => {
    expect(planDeclaresFanOut({ batches: [], regions: [] })).toBe(false);
    expect(planDeclaresNoWork({ batches: [], implementation: { create: [] } })).toBe(true);
  });
});

describe('extractAssetPlacements', () => {
  it('extracts and trims well-formed pairs', () => {
    const plan = { implementation: { assets: [{ source: ' a.glb ', destination: ' b.glb ' }] } };
    expect(extractAssetPlacements(plan)).toEqual([{ source: 'a.glb', destination: 'b.glb' }]);
  });

  it('drops malformed entries instead of throwing — one bad entry must not kill the phase', () => {
    const plan = {
      implementation: {
        assets: [assetEntry, { source: 'x' }, null, 'nope', { source: '', destination: 'y' }],
      },
    };
    expect(extractAssetPlacements(plan)).toEqual([assetEntry]);
  });

  it('returns [] when assets is absent or not an array', () => {
    expect(extractAssetPlacements({ implementation: {} })).toEqual([]);
    expect(extractAssetPlacements({ implementation: { assets: {} } })).toEqual([]);
    expect(extractAssetPlacements(undefined)).toEqual([]);
  });
});

describe('the verbatim incident payload reaches execute', () => {
  // Copied byte-for-byte from the failing job's `sessions/chat.jsonl` plan card.
  // It was fully schema-conformant; the sentinel discarded it anyway.
  const REAL_PLAN = `{
  "task": {
    "id": "boss-model-asset-replacement",
    "goal": "기존 정적 모델 경로의 손상된 보스 Duck GLB를 정상 제공 파일로 교체해 현재 로더와 보스 렌더링 계약을 유지한다."
  },
  "implementation": {
    "create": [],
    "modify": [],
    "delete": [],
    "assets": [
      {
        "source": "assets/game/models/Duck.glb",
        "destination": "codebase/public/models/Duck.glb"
      }
    ]
  }
}`;

  it('is not mistaken for an empty plan', () => {
    expect(planDeclaresNoWork(JSON.parse(REAL_PLAN))).toBe(false);
  });

  it('finalize routes it to execute (done:false) with the plan body preserved', () => {
    const task: any = {
      id: 'replace-boss-duck-asset',
      name: '보스 몬스터 모델 에셋 교체',
      type: 'feature',
      priority: 300,
      selfVerifyOnDone: true,
    };
    const state: any = {
      currentTask: task,
      conversations: {},
      completedTasksDetails: [],
      recursionCount: 0,
      recursionLimit: 200,
      _verifyEntered: false,
    };

    const result = finalizePlanOutcome(state, task, {
      preSplitPlanText: REAL_PLAN,
      callSite: 'plan-llm-toolloop',
      skipBatchSplit: true,
    });

    // Was: done:true, planText:'' → execute skipped, 0 files written, success reported.
    expect(result.llmResponse?.done).toBe(false);
    expect(result.planText).toContain('Duck.glb');
  });

  it('the placement it declares is extractable for execute + the completion gate', () => {
    expect(extractAssetPlacements(JSON.parse(REAL_PLAN))).toEqual([
      { source: 'assets/game/models/Duck.glb', destination: 'codebase/public/models/Duck.glb' },
    ]);
  });
});

describe('anti-drift lock — prompt schema keys === PLAN_MUTATION_KEYS', () => {
  const rules = fs.readFileSync(PLAN_RULES, 'utf-8');

  /** Collect the keys of every `"implementation": { ... }` block in the template. */
  function implementationKeyBlocks(): string[][] {
    const blocks: string[][] = [];
    const re = /"implementation":\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rules))) {
      // Walk braces to the matching close so nested entry objects are included.
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < rules.length; i++) {
        if (rules[i] === '{') depth++;
        else if (rules[i] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      const body = rules.slice(m.index + m[0].length, i);
      // Only top-level keys of this block (depth 0 within the body).
      const keys: string[] = [];
      let d = 0;
      const keyRe = /(\{|\}|\[|\]|"([a-zA-Z_]+)":)/g;
      let k: RegExpExecArray | null;
      while ((k = keyRe.exec(body))) {
        if (k[1] === '{' || k[1] === '[') d++;
        else if (k[1] === '}' || k[1] === ']') d--;
        else if (k[2] && d === 0) keys.push(k[2]);
      }
      if (keys.length) blocks.push(keys);
    }
    return blocks;
  }

  it('the template actually contains implementation blocks to check', () => {
    expect(implementationKeyBlocks().length).toBeGreaterThan(0);
  });

  it('every key the prompt teaches under implementation is a known mutation key', () => {
    const taught = new Set(implementationKeyBlocks().flat());
    const unknown = [...taught].filter((k) => !(PLAN_MUTATION_KEYS as readonly string[]).includes(k));
    expect(
      unknown,
      `The plan prompt teaches implementation key(s) ${JSON.stringify(unknown)} that PLAN_MUTATION_KEYS ` +
        `does not cover. An unmodelled key makes a plan carrying only that key look EMPTY, so its body is ` +
        `discarded and the task completes without doing the work (level-dashing-plumb). Add it to ` +
        `PLAN_MUTATION_KEYS — or remove it from the template.`,
    ).toEqual([]);
  });

  it('every mutation key is actually taught by the prompt (no dead schema surface)', () => {
    const taught = new Set(implementationKeyBlocks().flat());
    const untaught = (PLAN_MUTATION_KEYS as readonly string[]).filter((k) => !taught.has(k));
    expect(
      untaught,
      `PLAN_MUTATION_KEYS declares ${JSON.stringify(untaught)} but the plan prompt never teaches it, so no ` +
        `LLM will ever emit it. Either teach it in the schema or drop it from the contract.`,
    ).toEqual([]);
  });

  it('the mandatory empty-plan example zeroes every mutation key', () => {
    // A partial empty-plan example is what made `assets`-only plans mimic it.
    const emptyExample = rules.match(/"goal":\s*"Nothing to do"[\s\S]{0,400}?\n\s*\}/);
    expect(emptyExample, 'empty-plan example not found in plan rules.md').not.toBeNull();
    for (const key of PLAN_MUTATION_KEYS) {
      expect(
        emptyExample![0],
        `The empty-plan example must show "${key}": [] — otherwise a plan whose only content is ` +
          `"${key}" is textually identical to "nothing to do".`,
      ).toContain(`"${key}": []`);
    }
  });
});

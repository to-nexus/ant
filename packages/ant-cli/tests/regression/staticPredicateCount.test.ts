/**
 * R1-carve-out regression guard.
 *
 * NODE_GRAPH_LAYOUT §3 R1-carve-out allows phase layer files to directly
 * import `tasks/{type}/model/is.ts` predicates (`isDocTask`, `isErrorTask`,
 * `isVerificationTask`, ...) only when all three conditions hold:
 *   1. predicate is pure (no state/context dependency)
 *   2. the literal `task.type === '...'` comparison is contained inside the
 *      predicate file
 *   3. a hook would add no value (static per-type fact)
 *
 * The risk is drift: new predicates slip into phase nodes one at a time and
 * the carve-out silently widens. We pin the current usage count so any
 * increase triggers a review of the three conditions before merging.
 *
 * If this test fails after a legitimate addition, update MEASURED_COUNT in
 * the same PR that adds the usage, and include justification in the PR
 * description referencing the three conditions above.
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../../src/agents/architect/graph/code');
const PREDICATES = [
  'isDocTask',
  'isErrorTask',
  'isVerificationTask',
  'isSetupTask',
  'isUiTask',
  'isFeatureTask',
  'isDesignSystemTask',
  'isTestCodeTask',
  'isExplainTask',
];

/**
 * Measured once at plan execution time. Increase requires justification per
 * the R1-carve-out conditions. Do NOT lower silently — a drop usually means
 * a predicate usage was converted to a hook, which is always welcome and
 * should be captured as a new, lower pin in the same PR.
 *
 * 84 — verification fix-책임 제거 리팩토링 재산정:
 *   - `nodes/plan/parts/planHistory.ts` 파일 자체 폐기. helper 가 들고 있던
 *     `isVerificationTask + isErrorTask` import + 호출 쌍이 사라지고,
 *     호출 사이트 3 곳(index.ts × 1, planLLM.ts × 2)에 1줄 인라인으로
 *     이전. `isRemediationTask = isVerificationTask(task) || isErrorTask(task)`
 *     로컬이 각 사이트마다 평가되며, planLLM.ts overLimit 분기는 이전부터
 *     이 로컬을 보유했음.
 *   - `nodes/plan/parts/entry.ts` 의 `isVerificationRetry` / verification
 *     retry 분기 통째 삭제. retry 분기에 있던 `isVerificationTask` 호출
 *     1 개가 사라짐. fresh-entry 의 verification init 호출은 유지.
 *   - `nodes/plan/parts/batchSplit.ts` 의 `plan_too_short` 로그 enrichment
 *     케이스(2 개 호출)는 always-fan-out 로 분기가 정리되며 일부 줄어듦.
 *   - `nodes/plan/index.ts` 의 `assertVerificationPlanIsFanoutOnly`
 *     호출은 invariant 가드의 1 회 사용만 추가.
 *
 * R1 conditions still hold: predicates are pure; the literal
 * `task.type === '...'` lives inside `tasks/<type>/model/is.ts`; the
 * usages reflect short-circuit / log-shape / invariant branching, none
 * of which would be simplified by a hook.
 */
const MEASURED_COUNT = 84;

async function walkSourceFiles(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tasks') continue;
      await walkSourceFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
}

function countMatches(source: string): number {
  let total = 0;
  for (const name of PREDICATES) {
    const re = new RegExp(`\\b${name}\\b`, 'g');
    const matches = source.match(re);
    if (matches) total += matches.length;
  }
  return total;
}

describe('R1-carve-out regression guard', () => {
  it('static type predicate usage in phase layer stays within budget', async () => {
    const files: string[] = [];
    await walkSourceFiles(ROOT, files);
    let count = 0;
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      count += countMatches(source);
    }
    expect(count).toBeLessThanOrEqual(MEASURED_COUNT);
  });
});

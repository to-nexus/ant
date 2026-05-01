/**
 * Compute CodeGen call budget from planText.
 *
 * `create` ≈ 1 call (`<file>` tag), `modify` ≈ 3 calls (read + edit + retry).
 * `undefined` when the plan can't be parsed → caller falls back to default.
 * Floor of 10 covers wiring/import overhead.
 */
export function computeBudgetFromPlanText(planText: string): number | undefined {
  try {
    const parsed = JSON.parse(planText);
    const impl = parsed.implementation;
    if (!impl) return undefined;

    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;

    if (createCount === 0 && modifyCount === 0) return undefined;

    const budget = createCount * 1 + modifyCount * 3;
    return Math.max(budget, 10);
  } catch {
    return undefined;
  }
}

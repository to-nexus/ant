/**
 * mock-content-imagery activation gate (SBS SSOT).
 *
 * The `mock-content-imagery` partial is gated on three axes:
 *
 *   service domain × frontend stack × feature task
 *
 * Domain-Branching Locality (I1) forbids `{{#if (eq domain 'service')}}`
 * inside `templates/jobs/<job>/nodes/<node>/...` rules.md, so the three
 * axes are derived in code and surfaced to Handlebars as a single boolean
 * variable (`mockContentImageryActive`). Both plan and execute call sites
 * import this helper to keep the gate predicate as a single source of
 * truth.
 *
 * Companion to `mock-adapter-contract` (mock data body) and `ui-source-*`
 * (design-system assets); see `.cursorrules` Mock-use prompt SSOTs table.
 */

export interface MockContentImageryGateInput {
  /** Has at least one frontend stack tech tier (or empty stacks set). */
  hasFrontend: boolean;
  /** Workspace domain — only `'service'` activates content imagery; the
   *  `'game'` domain is served by `game-art-source` instead. */
  domain: string | undefined;
  /** Task type at the call site. plan uses `taskType`; execute uses
   *  `currentTask.type` — callers pass the resolved string. */
  taskType: string | undefined;
}

/**
 * @returns `true` iff all three gate axes pass (service domain, frontend
 *          stack present, feature task).
 */
export function isMockContentImageryActive(input: MockContentImageryGateInput): boolean {
  return (
    input.hasFrontend === true &&
    input.domain === 'service' &&
    input.taskType === 'feature'
  );
}

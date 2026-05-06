/**
 * service-virtualization-imagery activation gate (SBS SSOT).
 *
 * Image subtype of FAKE data — placeholder imagery for slots fed by user-
 * uploaded / DB-fetched content (avatar, thumbnail, cover, gallery). Three
 * gate axes:
 *
 *   service domain × frontend stack × feature task
 *
 * Domain-Branching Locality (I1) forbids `{{#if (eq domain 'service')}}`
 * inside `templates/jobs/<job>/nodes/<node>/...` rules.md, so the three
 * axes are derived in code and surfaced to Handlebars as a single boolean
 * variable (`serviceVirtualizationImageryActive`). Both plan and execute
 * call sites import this helper to keep the gate predicate as a single
 * source of truth.
 *
 * Companions:
 *   - `service-virtualization-contract` (port shape + toggle grammar)
 *   - `service-virtualization-data`     (non-image FAKE body realism)
 */

export interface ServiceVirtualizationImageryGateInput {
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
export function isServiceVirtualizationImageryActive(
  input: ServiceVirtualizationImageryGateInput,
): boolean {
  return (
    input.hasFrontend === true &&
    input.domain === 'service' &&
    input.taskType === 'feature'
  );
}

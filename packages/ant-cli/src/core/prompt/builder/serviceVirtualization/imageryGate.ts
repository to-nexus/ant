/**
 * service-virtualization-imagery activation gate (SBS SSOT).
 *
 * Image subtype of FAKE data — placeholder imagery for slots fed by user-
 * uploaded / DB-fetched content (avatar, thumbnail, cover, gallery). Three
 * gate axes:
 *
 *   service domain × frontend stack × rendering/scaffolding task type
 *
 * The partial owns two responsibilities: (1) placeholder URL authoring
 * rules (host choice, deterministic seed), and (2) a rendering contract
 * for placeholder URLs (`unoptimized` or plain `<img>` to bypass the
 * framework image optimizer, since placeholder services redirect to CDN
 * hosts that are rarely documented and structurally fragile to allowlist
 * against). (1) applies to task types that author new placeholders;
 * (2) applies to ANY task that touches a component or config consuming
 * those URLs — including error/verification cycles that diagnose and
 * fix broken imagery. The task-type set below reflects both axes.
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

/**
 * Task types that touch image rendering surfaces or placeholder URL
 * authoring. Excluded: `doc` (no rendering surface), `test-code` (test
 * fixtures, not user-facing render), `explain` (read-only). If a new
 * task type lands that authors or modifies image-bearing components or
 * mock data, add it here.
 */
const IMAGERY_ENABLED_TASK_TYPES: ReadonlySet<string> = new Set([
  'feature',
  'ui',
  'design-system',
  'setup',
  'error',
  'verification',
]);

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
 *          stack present, task type is in
 *          {@link IMAGERY_ENABLED_TASK_TYPES}).
 */
export function isServiceVirtualizationImageryActive(
  input: ServiceVirtualizationImageryGateInput,
): boolean {
  return (
    input.hasFrontend === true &&
    input.domain === 'service' &&
    input.taskType !== undefined &&
    IMAGERY_ENABLED_TASK_TYPES.has(input.taskType)
  );
}

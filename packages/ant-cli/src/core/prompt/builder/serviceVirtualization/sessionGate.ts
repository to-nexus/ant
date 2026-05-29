/**
 * service-virtualization-session activation gate (SBS SSOT).
 *
 * The `service-virtualization-session` partial governs the cross-body,
 * across-time coherence of a virtualized adapter — the running demo
 * session that emerges when many requests are answered out of the same
 * simulated world. Whereas `data` governs ONE response body and
 * `contract` governs system boundary, `session` governs:
 *
 *   - Seeded identities (inhabitants) exposed on entry surfaces
 *   - Authorization graph (role / organization edges) reachable per
 *     inhabitant
 *   - Cross-body entity coherence (same id resolves to same entity
 *     across endpoints)
 *   - Multi-endpoint cardinality (every key navigation surface seeded
 *     non-empty)
 *   - Mutation persistence (writes survive subsequent reads and the
 *     surface's expected lifetime — refresh / multi-tab / cross-device)
 *   - Surface discoverability (entry surfaces expose seeded inhabitants
 *     and entities through a platform-appropriate mechanism)
 *
 * Gate axes:
 *
 *   hasBusinessConnection × (taskType ∈ { feature, ui, design-system, setup })
 *
 * The taskType set mirrors `data` plus `setup`. Setup is included
 * because seed code (initial fixtures, `.env.example`, adapter
 * scaffolding) is frequently authored during setup tasks; excluding it
 * would force the LLM to re-discover the session contract one task
 * later and risk producing seed code that violates it.
 */

export interface ServiceVirtualizationSessionGateInput {
  /** True when the codebase declares at least one `business` connection. */
  hasBusinessConnection: boolean;
  /** Task type at the call site (`currentTask.type` for execute, plan-side
   *  task type for plan). Callers pass the resolved string. */
  taskType: string | undefined;
}

/**
 * @returns `true` iff `hasBusinessConnection === true` AND `taskType` is
 *          one of the session-authoring types
 *          (feature / ui / design-system / setup).
 */
export function isServiceVirtualizationSessionActive(
  input: ServiceVirtualizationSessionGateInput,
): boolean {
  if (input.hasBusinessConnection !== true) return false;
  return (
    input.taskType === 'feature' ||
    input.taskType === 'ui' ||
    input.taskType === 'design-system' ||
    input.taskType === 'setup'
  );
}

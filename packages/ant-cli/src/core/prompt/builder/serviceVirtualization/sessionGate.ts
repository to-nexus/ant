/**
 * service-virtualization-session activation gates (SBS SSOT).
 *
 * The `service-virtualization-session` partial governs cross-body, across-time
 * coherence of a virtualized adapter. It is split into THREE decision blocks,
 * each gated by a DIFFERENT existing signal (no new task type, no new band
 * value — `band` is read-only):
 *
 *   - World seed     — the shared demo world (inhabitants / authorization
 *                      graph / cross-body entity coherence). Owned by the
 *                      platform-band shared-service feature task, or by setup
 *                      that scaffolds the seed. Gate: (feature ∧ band=platform)
 *                      ∨ setup.
 *   - Store lifecycle — write-path + single-instance invariants (mutation
 *                      persistence, store continuity) of the virtualized
 *                      world's STORE. These are properties of the store OWNER,
 *                      not of a read-surface consumer, so the gate is identical
 *                      to the world-seed owner: the task that defines the seed
 *                      is the task that owns how writes persist through it.
 *                      Gate: (feature ∧ band=platform) ∨ setup.
 *   - Body lifecycle — read-surface invariants (empty-surface avoidance,
 *                      adapter-fed rendering, seed reference): every
 *                      data-bearing VISUAL SURFACE. Gate: `renderable` (the
 *                      ui-pairing-derived task flag — a ui task, or a feature
 *                      paired with a ui task incl. a chrome host). A headless
 *                      feature with no rendered surface is excluded — taskType
 *                      alone (feature/ui) would wrongly include headless hooks,
 *                      so the precise signal is `renderable`, not the task type.
 *
 * Identity / entry / auth behavior is NOT a separate gated block — it is the
 * partial's always-on umbrella reminder (a virtualized identity leg behaves
 * like the real backend: no auto-bind, lands a usable session, persists
 * identity mutations, enters via the real sign-in). Navigable-target / callback
 * reachability is owned by `service-virtualization-contract`; the session
 * partial defers, never restates it.
 *
 * `hasBusinessConnection` is the common precondition. `design-system` (token
 * infrastructure) is intentionally in NONE of the blocks — tokens author no
 * demo world or response body.
 */

export interface ServiceVirtualizationSessionGateInput {
  /** True when the codebase declares at least one `business` connection. */
  hasBusinessConnection: boolean;
  /** Task type at the call site (`currentTask.type` for execute, plan-side
   *  task type for plan). Optional because the body-lifecycle block keys on
   *  `renderable` alone; the world-seed caller always passes it. */
  taskType?: string | undefined;
  /** Scheduling band of the current task (read-only). Used ONLY to route the
   *  World-seed block to the platform-band shared-service owner; never written. */
  band?: string | undefined;
  /** ui-pairing-derived flag (`task.renderable`): the current task renders a
   *  user-visible visual surface. Read-only; routes the body-lifecycle block to
   *  every data-bearing surface (screens, ui, chrome) while excluding headless. */
  renderable?: boolean | undefined;
}

/**
 * World-seed block: the shared demo world owned by the platform-band shared
 * service (or seeded by setup).
 */
export function isSvWorldSeedActive(
  input: ServiceVirtualizationSessionGateInput,
): boolean {
  if (input.hasBusinessConnection !== true) return false;
  return (
    (input.taskType === 'feature' && input.band === 'platform') ||
    input.taskType === 'setup'
  );
}

/**
 * Store-lifecycle block: the write-path + single-instance invariants of the
 * virtualized world's STORE (mutation persistence, store continuity). These
 * are properties of the store OWNER — the platform-band shared-service feature
 * that authors the adapter, or setup that scaffolds the seed — NOT of a
 * read-surface consumer. The gate is identical to the world-seed owner: the
 * task that defines the seed is the task that owns how writes persist through
 * it. A renderable read-surface consumer is intentionally excluded — it reads
 * the store, it does not author how the store persists writes.
 */
export function isSvStoreLifecycleActive(
  input: ServiceVirtualizationSessionGateInput,
): boolean {
  return isSvWorldSeedActive(input);
}

/**
 * Body-lifecycle block: the read-surface invariants for every data-bearing
 * VISUAL SURFACE (cardinality, adapter-fed rendering, cross-body reference),
 * gated by the ui-pairing-derived `renderable` flag (screens, ui, chrome
 * hosts). A headless feature, `design-system`, and `setup` are excluded — they
 * render no body. Write-path/store-instance invariants live in
 * `isSvStoreLifecycleActive`, which gates on the store owner instead.
 */
export function isSvBodyLifecycleActive(
  input: ServiceVirtualizationSessionGateInput,
): boolean {
  if (input.hasBusinessConnection !== true) return false;
  return input.renderable === true;
}

/**
 * Include gate for the `service-virtualization-session` partial — true iff
 * ANY block is active (world-seed / store-lifecycle ⊆ world-seed / body-
 * lifecycle). `design-system` is excluded (every block is false for it). The
 * always-on identity/entry umbrella reminder rides along whenever the partial
 * is included — it owns no separate gate.
 *
 * @returns `true` iff `hasBusinessConnection === true` AND at least one block
 *          (world-seed / body-lifecycle) activates for this task.
 */
export function isServiceVirtualizationSessionActive(
  input: ServiceVirtualizationSessionGateInput,
): boolean {
  return isSvWorldSeedActive(input) || isSvBodyLifecycleActive(input);
}

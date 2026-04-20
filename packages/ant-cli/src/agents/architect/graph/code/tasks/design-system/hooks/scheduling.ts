/**
 * design-system/hooks/scheduling.ts — TaskSchedulingHook (intentionally empty)
 *
 * Design-system tasks in the code pipeline build the visual
 * infrastructure (token → CSS bridge at priority 200, shared component
 * library at priority 201+, all sharing `parallelGroup: "design-system"`).
 * Their ordering is enforced WITHOUT any type-level hook flag:
 *
 *   Within-bundle ordering — priority + parallelGroup
 *     Siblings share `parallelGroup: "design-system"` so the orchestrator
 *     serialises them; the queue is priority-ordered, so priority 200
 *     (tokens) is always assigned before priority 201+ (wiring). No
 *     type-level barrier participates.
 *
 *   Cross-type ordering — `hasPreFeatureWork` via priority
 *     `parallel/TaskOrchestrator.ts` defines `isFoundationTask(t)` as
 *     `priority >= 200 && priority <= 299`. Any task inside that window —
 *     setup OR design-system — activates `hasPreFeatureWork`, which
 *     gates priority ≥ 300 tasks (feature / ui / test-code / doc /
 *     integration) until the foundation window clears. This producer
 *     predicate is a **cross-type priority window** and intentionally
 *     stays inline in the orchestrator (see TaskOrchestrator.ts L101–115
 *     note "Priority-based predicates stay inline — they are cross-type
 *     and have no sensible home in a per-task bundle").
 *
 * As a consequence this bundle publishes **zero** scheduling flags:
 *
 *   Intentionally unpublished — consumer flags
 *     - preUiBarrier / preTestgenBarrier / preDocBarrier / preIntegrationBarrier
 *       Design-system sits at priority 200–299, below FEATURE_CRITICAL
 *       (300), so it never needs to consume a type-level barrier — its
 *       turn comes before any consumer-barrier producer can run.
 *
 *   Intentionally unpublished — producer flags
 *     - blocksUi / blocksTestgen / blocksDoc / blocksIntegration
 *       The "design-system blocks priority ≥ 300 tasks" semantic is
 *       already expressed by the priority-window predicate
 *       `isFoundationTask` that drives `hasPreFeatureWork`. Publishing
 *       any `blocksXxx` flag here would duplicate that semantic in a
 *       second place (hook flags vs. priority window), inviting drift.
 *       In particular setting `blocksUi=true` would make ui tasks
 *       "correctly" wait during design-system, but the gating would
 *       then flow through two independent code paths — the foundation
 *       gate (inline in orchestrator) and the type-level
 *       `hasPreUiWork` gate (via `schedBlocks`) — with no single source
 *       of truth for the ordering.
 *
 * NOTE — the `hasPreAssetsWork` / `hasPreSpecWork` barriers in
 * `TaskOrchestrator.ts` (driven by `isTokensTask` / `isTokensOrAssetsTask`)
 * exist for the **design job** orchestrator, which sets `barriers.assets`
 * / `barriers.spec` to `true`. The **code job** (`graph.ts` L282) enables
 * only `{ feature, integration, ui, 'test-code', doc }`, so those two
 * barriers are inert here. They are mentioned only to dispel the
 * assumption that design-system ordering inside the code pipeline uses
 * them.
 *
 * This module exists purely for structural parity with the other task
 * bundles (every bundle has a scheduling file so registry authors are
 * not tempted to special-case design-system). The empty export is
 * locked by `tests/tasks/design-system/hooks.test.ts`, which asserts
 * `designSystemBundle.scheduling` is undefined so a drive-by flag
 * addition is caught immediately.
 *
 * History — this invariant has not changed across T6b passes:
 * design-system never adopted the T6b-ε producer/consumer flag pattern
 * (feature / setup / test-code did) precisely because its ordering is
 * priority-based, not type-based.
 */

export {};

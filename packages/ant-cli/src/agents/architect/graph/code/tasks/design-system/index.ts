/**
 * tasks/design-system/index.ts — design-system task bundle.
 *
 * Design-system tasks build the visual infrastructure in the code
 * pipeline — token→CSS bridge (priority 200) and shared component
 * library (priority 201+), all sharing `parallelGroup: "design-system"`.
 *
 * Hooks published:
 *   - conversations.convKey    — per-task conversation scope (pre-wiring;
 *                                phase layer still shares
 *                                `CONV_KEYS.NODE_EXECUTE`).
 *   - scheduling.classify      — per-task scheduling role based on
 *                                priority band: priority 200–299
 *                                returns `isFoundation=true` +
 *                                `expandedRagQuota=true`. Activates
 *                                `hasPreFeatureWork` in the
 *                                orchestrator (foundation barrier)
 *                                and extended RAG quota in
 *                                `nodes/plan/rag/combine.ts`.
 *   - plan.extraTemplateVars   — workspace-dep-snapshot reader.
 *
 * Intentionally absent:
 *   - scheduling.{pre*Barrier, blocks*} — design-system's ordering role
 *     is expressed via classify (priority-band SSOT owned by THIS
 *     bundle). Publishing a separate type-level flag would duplicate
 *     that semantic — classify is the single dispatch point.
 *   - decompose.isExclusive — design-system tasks are parallel-safe
 *     within the foundation priority tier; serialisation comes from the
 *     shared `parallelGroup`, not from type-level exclusivity.
 *   - check.evaluate / budgetExhaustedHint — the LLM <done> signal is
 *     sufficient; no disk-level completion gate needed.
 *
 * Phase-layer `task.type === 'design-system'` predicate adoption is
 * completed at T6b-κ via `isDesignSystemTask`. Before the
 * classify-adoption change, this bundle published NO scheduling slot
 * at all and the orchestrator relied on an inline priority window
 * predicate (`isFoundationTask`, priority 200–299). classify closes
 * that R1 residual.
 */

import type { TaskHooks } from '../_shared/types';

import { convKey } from './hooks/conversations';
import { extraTemplateVars as planExtraTemplateVars } from './hooks/plan';
import { classify as schedulingClassify } from './hooks/scheduling';

// `plan.extraTemplateVars` publishes the workspace-dep-snapshot template
// variables so design-system tasks see existing pins for libraries they
// commonly add (`tailwindcss`, `@radix-ui/*`, `@emotion/*`,
// `class-variance-authority`, etc.) before declaring a different
// version. The policy guard in `manifestPinPolicy.ts` enforces the
// constraint at write/install time; this hook is the read-only
// visibility surface.
export const hooks: TaskHooks = {
  conversations: { convKey },
  plan: { extraTemplateVars: planExtraTemplateVars },
  scheduling: { classify: schedulingClassify },
};

export { isDesignSystemTask } from './model/is';

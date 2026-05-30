import type { IntentId, JobType } from '@ant/shared';
import type { HeaviestNodeId, HeaviestNodeReason } from '@ant/shared';
import { TEMPLATE_PATHS, type TemplatePathTriple } from '../prompt/builder/templatePaths';

export interface HeaviestNodeMapping {
  job: JobType;
  node: HeaviestNodeId;
  reason: HeaviestNodeReason;
  /**
   * Templates triple consumed by the estimator's PromptBuilder.build call.
   * MUST point at the same `TEMPLATE_PATHS` reference that the production
   * graph builder uses, so the heaviest-node estimate renders the same
   * static skeleton as the live first call. Path drift is locked at
   * compile-time by tests/baselineEstimate/template-path-ssot-locked.test.ts.
   */
  templates: TemplatePathTriple;
}

/**
 * Heaviest-node mapping per intent. Used exclusively by
 * `core/baselineEstimate/estimator.ts` to render the static skeleton of the
 * heaviest LLM call before the job runs. Each entry's `templates` triple
 * MUST reference `TEMPLATE_PATHS.X` — never inline raw strings — so the
 * estimator and the production graph builder share a single source of truth.
 *
 * Visual intents (`gen-visual-logo/icon/hero/illustration`) are intentionally
 * absent. The visual job's heaviest call is image generation, not a
 * PromptBuilder call, so a text-token estimate would be semantically
 * misleading. `estimateBaseline` returns `intent-unmapped` (400) for those
 * intents and the FE `useBaselineEstimate` hook hides the TurnTokenRing
 * silently (already wired). `explain-visual` is also dropped because the
 * creator/visual explain node uses single-shot `pb.render()` without the
 * compaction-aware compound flow the estimator emulates.
 */
export const HEAVIEST_NODE_BY_INTENT: Partial<Record<IntentId, HeaviestNodeMapping>> = {
  // Code (5) — decompose dominates (full RAC pool + role-scoped 8K/2K compaction).
  'gen-code-sys':             { job: 'code',   node: 'decompose', reason: 'static-max',  templates: TEMPLATE_PATHS.codeDecompose },
  'gen-code-spec':            { job: 'code',   node: 'decompose', reason: 'static-max',  templates: TEMPLATE_PATHS.codeDecompose },
  'gen-code-directive':       { job: 'code',   node: 'decompose', reason: 'static-max',  templates: TEMPLATE_PATHS.codeDecompose },
  'rev-code':                 { job: 'code',   node: 'decompose', reason: 'static-max',  templates: TEMPLATE_PATHS.codeDecompose },
  'explain-code':             { job: 'code',   node: 'detect',    reason: 'no-decompose', templates: TEMPLATE_PATHS.detect },

  // Design UI (4)
  'gen-ui-figma':             { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designUiByFigma },
  'gen-ui-desc':              { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designUiByDesc },
  'rev-ui':                   { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designUiByFigma },
  'explain-ui':               { job: 'design', node: 'detect',    reason: 'no-decompose', templates: TEMPLATE_PATHS.detect },

  // Design Game Art (4) — reuse UI variants until game-art templates land.
  'gen-game-art-figma':       { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designUiByFigma },
  'gen-game-art-desc':        { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designUiByDesc },
  'rev-game-art':             { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designUiByFigma },
  'explain-game-art':         { job: 'design', node: 'detect',    reason: 'no-decompose', templates: TEMPLATE_PATHS.detect },

  // Design System (5)
  'gen-sys-fe':               { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designSystem },
  'gen-sys-be':               { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designSystem },
  'gen-sys-full':             { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designSystem },
  'rev-sys':                  { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designSystem },
  'explain-sys':              { job: 'design', node: 'detect',    reason: 'no-decompose', templates: TEMPLATE_PATHS.detect },

  // Design Spec (3)
  'gen-spec':                 { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designSpec },
  'rev-spec':                 { job: 'design', node: 'docGen',    reason: 'static-max',  templates: TEMPLATE_PATHS.designSpec },
  'explain-spec':             { job: 'design', node: 'detect',    reason: 'no-decompose', templates: TEMPLATE_PATHS.detect },

  // Plan (3)
  'gen-plan':                 { job: 'plan',   node: 'generate',  reason: 'static-max',  templates: TEMPLATE_PATHS.plannerPlan },
  'rev-plan':                 { job: 'plan',   node: 'generate',  reason: 'static-max',  templates: TEMPLATE_PATHS.plannerPlan },
  'explain-plan':             { job: 'plan',   node: 'detect',    reason: 'no-decompose', templates: TEMPLATE_PATHS.detect },

  // Visual (5) — retired. Image-generation jobs have no PromptBuilder-based
  // heaviest call; baseline-estimate returns `intent-unmapped` (400) and the
  // FE gauge stays hidden. Tracked in the file-level JSDoc.

  // Learn (1) — uses code job's decompose.
  'gen-learn':                { job: 'code',   node: 'decompose', reason: 'static-max',  templates: TEMPLATE_PATHS.codeDecompose },

  // Ask (3)
  'ask-evaluate':             { job: 'ask',    node: 'agent',     reason: 'no-decompose', templates: TEMPLATE_PATHS.askAgent },
  'ask-ant':                  { job: 'ask',    node: 'agent',     reason: 'no-decompose', templates: TEMPLATE_PATHS.askAgent },
  'ask-general':              { job: 'ask',    node: 'agent',     reason: 'no-decompose', templates: TEMPLATE_PATHS.askAgent },
};

export function heaviestNodeFor(intent: IntentId): HeaviestNodeMapping {
  const hit = HEAVIEST_NODE_BY_INTENT[intent];
  if (!hit) {
    throw new Error(
      `[heaviestNodeFor] No mapping for intent "${intent}". ` +
      `Add to HEAVIEST_NODE_BY_INTENT in core/baselineEstimate/heaviestNode.ts.`,
    );
  }
  return hit;
}

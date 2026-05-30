/**
 * Template Path SSOT.
 *
 * Single source of truth for every (job × node × variant) prompt template
 * triple that PromptBuilder.build / .render consumes. Two classes of caller
 * MUST import from this module instead of inlining raw `'jobs/...'` strings:
 *
 *   1. Production graph builders (architect / planner / creator agents).
 *   2. baselineEstimate (`HEAVIEST_NODE_BY_INTENT` mapping table).
 *
 * Why this exists: `baselineEstimate/estimator.ts` (origin commit 0da20cb4,
 * 2026-05-20) hardcoded a generic `jobs/${job}/nodes/${node}/base` pattern
 * that never matched the variant-segmented layout actually used by production
 * builders. The mismatch produced silent critical-template failures across
 * every baseline-estimate request (all 9 heaviestNode mappings deadlinked)
 * and dramatically under-reported the FE TurnTokenRing baseline. Consolidating
 * the path strings here lets the regression-locker test (path-existence +
 * raw-literal AST grep) reject any future drift at CI time.
 *
 * Naming convention: `{job}{Node}{Variant?}` in lowerCamelCase. Variant key
 * is omitted when the node has a single default variant unambiguously owned
 * by the job (e.g. `askAgent`, `codeDecompose`). The triple's `rules` and
 * `system` fields are optional because a small number of nodes intentionally
 * omit them (design plan / planner plan / ask agent skip the job-level
 * system prompt; some nodes render `rules` as a partial inside `base`).
 */

export interface TemplatePathTriple {
  base: string;
  rules?: string;
  system?: string;
}

export const TEMPLATE_PATHS = {
  // ─── architect / code ────────────────────────────────────────────────────
  codeDecompose: {
    base: 'jobs/code/nodes/decompose/variants/default/base',
    rules: 'jobs/code/nodes/decompose/variants/default/rules',
    system: 'jobs/code/base/system',
  },
  codeDirect: {
    base: 'jobs/code/nodes/direct/variants/default/base',
    rules: 'jobs/code/nodes/direct/variants/default/rules',
    system: 'jobs/code/base/system',
  },
  codePlanDefault: {
    base: 'jobs/code/nodes/plan/base',
    rules: 'jobs/code/nodes/plan/rules',
    system: 'jobs/code/base/system',
  },
  codePlanKeyword: {
    base: 'jobs/code/nodes/plan/base-keyword',
    rules: 'jobs/code/nodes/plan/rules-keyword',
    system: 'jobs/code/base/system',
  },
  // codePlanError / codePlanTestCode intentionally lack a `rules` slot —
  // their variant directories ship only `base.md`. The rules layer for
  // error / test-code plan flows comes from the default plan rules
  // partial included inside the variant base.md.
  codePlanError: {
    base: 'jobs/code/nodes/plan/variants/error/base',
    system: 'jobs/code/base/system',
  },
  codePlanVerification: {
    base: 'jobs/code/nodes/plan/variants/verification/base',
    rules: 'jobs/code/nodes/plan/variants/verification/rules',
    system: 'jobs/code/base/system',
  },
  codePlanTestCode: {
    base: 'jobs/code/nodes/plan/variants/test-code/base',
    system: 'jobs/code/base/system',
  },
  codeExecuteDefault: {
    base: 'jobs/code/nodes/execute/variants/default/base',
    rules: 'jobs/code/nodes/execute/variants/default/rules',
    system: 'jobs/code/base/system',
  },
  codeExecuteError: {
    base: 'jobs/code/nodes/execute/variants/error/base',
    rules: 'jobs/code/nodes/execute/variants/error/rules',
    system: 'jobs/code/base/system',
  },
  codeExecuteVerification: {
    base: 'jobs/code/nodes/execute/variants/verification/base',
    rules: 'jobs/code/nodes/execute/variants/verification/rules',
    system: 'jobs/code/base/system',
  },
  codeExecuteTestCode: {
    base: 'jobs/code/nodes/execute/variants/test-code/base',
    rules: 'jobs/code/nodes/execute/variants/test-code/rules',
    system: 'jobs/code/base/system',
  },
  codeExecuteDocgen: {
    base: 'jobs/code/nodes/execute/variants/docgen/base',
    rules: 'jobs/code/nodes/execute/variants/docgen/rules',
    system: 'jobs/code/base/system',
  },
  codeRevise: {
    base: 'jobs/code/nodes/revise/variants/default/base',
    rules: 'jobs/code/nodes/revise/variants/default/rules',
    system: 'jobs/code/base/system',
  },

  // ─── architect / design ──────────────────────────────────────────────────
  designSpec: {
    base: 'jobs/design/nodes/execute/variants/spec/base',
    rules: 'jobs/design/nodes/execute/variants/spec/rules',
    system: 'jobs/design/base/system',
  },
  designSystem: {
    base: 'jobs/design/nodes/execute/variants/system-design/base',
    rules: 'jobs/design/nodes/execute/variants/system-design/rules',
    system: 'jobs/design/base/system',
  },
  designUiByFigma: {
    base: 'jobs/design/nodes/execute/variants/ui-design-by-figma/base',
    rules: 'jobs/design/nodes/execute/variants/ui-design-by-figma/rules',
    system: 'jobs/design/base/system',
  },
  designUiByDesc: {
    base: 'jobs/design/nodes/execute/variants/ui-design-by-desc/base',
    rules: 'jobs/design/nodes/execute/variants/ui-design-by-desc/rules',
    system: 'jobs/design/base/system',
  },
  designExplain: {
    base: 'jobs/design/nodes/execute/variants/explain-only/base',
    rules: 'jobs/design/nodes/execute/variants/explain-only/rules',
    system: 'jobs/design/base/system',
  },
  designPlan: {
    base: 'jobs/design/nodes/plan/base',
    rules: 'jobs/design/nodes/plan/rules',
    system: 'jobs/design/base/system',
  },
  designRevise: {
    base: 'jobs/design/nodes/revise/variants/default/base',
    rules: 'jobs/design/nodes/revise/variants/default/rules',
    system: 'jobs/design/base/system',
  },
  designDecomposeSystem: {
    base: 'jobs/design/nodes/decompose/variants/system-design/base',
    rules: 'jobs/design/nodes/decompose/variants/system-design/rules',
    system: 'jobs/design/base/system',
  },

  // ─── architect / ask ─────────────────────────────────────────────────────
  // No job-level system prompt — ask agent embeds its system header inside
  // the variant base.md.
  askAgent: {
    base: 'jobs/ask/nodes/agent/variants/default/base',
    rules: 'jobs/ask/nodes/agent/variants/default/rules',
  },

  // ─── planner / plan ──────────────────────────────────────────────────────
  // No job-level system prompt — planner embeds its system header inside the
  // variant base.md (mirrors ask).
  plannerPlan: {
    base: 'jobs/plan/nodes/plan/variants/default/base',
    rules: 'jobs/plan/nodes/plan/variants/default/rules',
  },

  // ─── creator / visual ────────────────────────────────────────────────────
  // Visual nodes render via PromptBuilder.render() (single-shot) rather than
  // PromptBuilder.build(). Each entry below names the canonical first partial
  // the node opens with; siblings (`context`, `classify`, `fidelity-prefix`)
  // are rendered separately and live as raw literals at the caller because
  // they are payload templates rather than node-base prompts. Visual is also
  // excluded from baselineEstimate's heaviestNode table (gen-visual-* intents
  // are image-generation; PromptBuilder-based token estimate is not faithful).
  visualExplain: {
    base: 'jobs/visual/nodes/explain/variants/default/base',
  },
  visualEngrave: {
    base: 'jobs/visual/nodes/engrave/variants/default/base',
    rules: 'jobs/visual/nodes/engrave/variants/default/rules',
  },
  visualDirect: {
    base: 'jobs/visual/nodes/direct/variants/default/base',
    rules: 'jobs/visual/nodes/direct/variants/default/rules',
  },

  // ─── shared ──────────────────────────────────────────────────────────────
  triage: {
    base: 'jobs/shared/nodes/triage/variants/default/base',
    rules: 'jobs/shared/nodes/triage/variants/default/rules',
  },
  detect: {
    base: 'jobs/shared/nodes/detect/variants/default/base',
    rules: 'jobs/shared/nodes/detect/variants/default/rules',
  },
} as const satisfies Record<string, TemplatePathTriple>;

export type TemplatePathKey = keyof typeof TEMPLATE_PATHS;

/**
 * seam/hooks/execute.ts — TaskExecuteHook for seam tasks.
 *
 * Seam EXECUTE applies the closure remediation (resolve-or-remove) over the
 * materialized graph. It ships a DEDICATED variant rather than riding the
 * default execute, because the default execute's essence is AUTHORING ("wire
 * every interactive control", "functional-completeness check") whereas seam's
 * essence is CLOSURE — every reference/affordance must resolve, and a control
 * that resolves to nothing must be REMOVED, not authored into existence.
 *
 * The variant base/rules manually include the common code-job partials (antrules
 * / dep-self-contained / tool-calling / batch) the same way the error variant
 * does; the seam-specific remediation framing comes from the type-gated
 * `seam-connectivity-closure` partial included in the seam rules.
 *
 * R2 compliance: depends on `_shared/types` only.
 */

import type { TaskExecuteHook } from '../../_shared/types';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';

const templatePaths = {
  base: TEMPLATE_PATHS.codeExecuteSeam.base,
  rules: TEMPLATE_PATHS.codeExecuteSeam.rules!,
} as const;

const runtimePlanFraming = {
  label: '🔗 CLOSURE PLAN (Structured JSON — FOLLOW EXACTLY)',
  description:
    'The following JSON contains the reference/affordance closure plan for this\n' +
    'module (or slice). Apply it exactly:\n' +
    '- resolve each listed reference/affordance to its real destination, OR\n' +
    '- remove a control that resolves to nothing (no legitimate destination).',
} as const;

function emptyPlanFallback(): string {
  return '**Closure analysis found no unresolved references or affordances. Output `<done>true</done>` immediately.**';
}

export const executeHook: TaskExecuteHook = {
  templatePaths,
  skipExamples: true,
  runtimePlanFraming,
  emptyPlanFallback,
};

/**
 * tasks/_shared/helpers/planPrompt.ts — prompt-authoring helpers shared
 * across plan hooks and the generic plan path.
 *
 * Earlier revisions (T6b-β) duplicated these two helpers across
 * `tasks/_shared/verify/prompt/buildPlanPrompt.ts`, `tasks/error/hooks/plan.ts`,
 * `tasks/setup/hooks/plan.ts`, and `nodes/plan/planGeneration.ts`. The
 * copies drifted trivially to maintain (e.g. adding a new language
 * required editing all four files). Extracting them here keeps R2
 * (hooks depend only on `_shared` + `model/`) intact because `_shared`
 * does not import from `nodes/` / `routers/` / `parallel/`.
 */

/**
 * Render the "Retrieved Files" section consumed by both verification
 * and error plan variants. Returns an empty string when no files were
 * retrieved so templates can treat the value as falsy.
 */
export function formatCodeContext(ctx: unknown): string {
  const files = (ctx as { files?: unknown })?.files;
  if (!Array.isArray(files) || files.length === 0) return '';
  const lines = files.map((f: any) => `- \`${f.path}\``).join('\n');
  return `**Retrieved Files** (${files.length} files):\n\n${lines}`;
}

/**
 * Substantive-prePlanText predicate — the single definition of "this
 * batch-split sub-task carries a parent pre-plan worth injecting".
 * Sub-50-char bodies are treated as absent (truncated/degenerate carries;
 * the parent-pre-plan partial would render a useless stub). Shared by the
 * generic plan path (`nodes/plan/llm/prompt.ts`) and the error plan hook.
 */
export function substantivePrePlanText(task: { prePlanText?: string }): string | undefined {
  const raw = task.prePlanText;
  return typeof raw === 'string' && raw.length > 50 ? raw : undefined;
}

/**
 * Coarse language → language-hint folder mapping. The plan/verification
 * template tree keys hint partials under
 * `jobs/code/nodes/plan/variants/verification/basis/techTier/{lang}/hints`
 * and setup uses the same four buckets for setup-constraint partials.
 * Unknown / empty language falls back to `typescript` which is the
 * default stack.
 */
export function mapLang(language: string): string {
  const l = language.toLowerCase();
  if (l.includes('go')) return 'go';
  if (l.includes('python')) return 'python';
  if (l.includes('rust')) return 'rust';
  if (l.includes('java')) return 'java';
  return 'typescript';
}

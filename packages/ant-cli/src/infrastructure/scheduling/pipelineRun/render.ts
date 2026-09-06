/**
 * Template rendering for directives and context pins — pure functions over
 * `(template, run)`. The variable whitelist is the format contract's; anything
 * else is validator-refused at save.
 */

import type { RunRecord } from '@ant/shared';

/** Static whitelist substitution — shared by directives and context pins. */
export function renderStaticVars(template: string, run: RunRecord): string {
  const prev = run.prevSuccessFireEpoch;
  return template
    .replace(/\{\{\s*trigger\.fireDate\s*\}\}/g, new Date(run.fireEpoch).toISOString())
    .replace(/\{\{\s*trigger\.fireEpoch\s*\}\}/g, String(run.fireEpoch))
    .replace(/\{\{\s*run\.id\s*\}\}/g, run.runId)
    // Cross-run watermark — the first run renders empty.
    .replace(/\{\{\s*run\.prevSuccess\.fireDate\s*\}\}/g, prev !== undefined ? new Date(prev).toISOString() : '')
    .replace(/\{\{\s*run\.prevSuccess\.fireEpoch\s*\}\}/g, prev !== undefined ? String(prev) : '');
}

export function renderDirective(template: string, run: RunRecord): string {
  const outputOf = (stepId: string) => run.steps.find((s) => s.stepId === stepId)?.output;
  return renderStaticVars(template, run)
    // Step-output substitution — validated at save time against the needs
    // closure, so the referenced step is terminal here; a skipped/no-output
    // upstream renders empty (recorded as unresolved on the dispatch event).
    .replace(/\{\{\s*steps\.([a-z0-9-]+)\.answer\s*\}\}/g, (_, id: string) => outputOf(id)?.answer ?? '')
    .replace(/\{\{\s*steps\.([a-z0-9-]+)\.artifacts\s*\}\}/g, (_, id: string) => (outputOf(id)?.artifacts ?? []).join('\n'));
}

/** Step-output refs in the template that render empty — dispatch-event audit detail. */
export function unresolvedStepRefs(template: string, run: RunRecord): string[] {
  const out: string[] = [];
  const re = /\{\{\s*(steps\.([a-z0-9-]+)\.(answer|artifacts))\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    const output = run.steps.find((s) => s.stepId === m![2])?.output;
    const value = m[3] === 'answer' ? output?.answer : output?.artifacts?.join('');
    if (!value) out.push(m[1]);
  }
  return [...new Set(out)];
}

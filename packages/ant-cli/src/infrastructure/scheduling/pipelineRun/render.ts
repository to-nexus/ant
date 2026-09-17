/**
 * Template rendering for directives and context pins — pure functions over
 * `(template, run)`. The variable whitelist is the format contract's; anything
 * else is validator-refused at save.
 */

import type { RunRecord } from '@ant/shared';

/** The claimed item's vars (fetch-fired runs) — key + declared fields. ONE pattern: the render and the audit read the same one. */
const ITEM_VAR = /\{\{\s*trigger\.item\.([a-zA-Z0-9]+)\s*\}\}/g;
const itemVar = (run: RunRecord, name: string): string | undefined => (name === 'key' ? run.item?.key : run.item?.fields?.[name]);

/** The upstream node's vars (event-fired runs) — directive-only, like item fields: another run's text never names a path. */
const UPSTREAM_VAR = /\{\{\s*trigger\.upstream\.([a-zA-Z]+)\s*\}\}/g;
const upstreamVar = (run: RunRecord, name: string): string | undefined => {
  const u = run.upstream;
  if (!u) return undefined;
  switch (name) {
    case 'pipelineId': return u.pipelineId;
    case 'runId': return u.runId;
    case 'step': return u.step;
    case 'outcome': return u.outcome;
    case 'verdict': return u.verdict;
    case 'answer': return u.answer;
    default: return undefined;
  }
};

/** Static whitelist substitution — shared by directives and context pins. */
export function renderStaticVars(template: string, run: RunRecord): string {
  const prev = run.prevSuccessFireEpoch;
  return template
    .replace(/\{\{\s*trigger\.fireDate\s*\}\}/g, new Date(run.fireEpoch).toISOString())
    .replace(/\{\{\s*trigger\.fireEpoch\s*\}\}/g, String(run.fireEpoch))
    .replace(/\{\{\s*run\.id\s*\}\}/g, run.runId)
    // Cross-run watermark — the first run renders empty.
    .replace(/\{\{\s*run\.prevSuccess\.fireDate\s*\}\}/g, prev !== undefined ? new Date(prev).toISOString() : '')
    .replace(/\{\{\s*run\.prevSuccess\.fireEpoch\s*\}\}/g, prev !== undefined ? String(prev) : '')
    // A missing field / a run without an item renders empty — and is reported
    // by `unresolvedTemplateRefs` on the dispatch event.
    .replace(ITEM_VAR, (_, name: string) => itemVar(run, name) ?? '');
}

export function renderDirective(template: string, run: RunRecord): string {
  const outputOf = (stepId: string) => run.steps.find((s) => s.stepId === stepId)?.output;
  return renderStaticVars(template, run)
    // Step-output substitution — validated at save time against the needs
    // closure, so the referenced step is terminal here; a skipped/no-output
    // upstream renders empty (recorded as unresolved on the dispatch event).
    .replace(/\{\{\s*steps\.([a-z0-9-]+)\.answer\s*\}\}/g, (_, id: string) => outputOf(id)?.answer ?? '')
    .replace(/\{\{\s*steps\.([a-z0-9-]+)\.artifacts\s*\}\}/g, (_, id: string) => (outputOf(id)?.artifacts ?? []).join('\n'))
    .replace(UPSTREAM_VAR, (_, name: string) => upstreamVar(run, name) ?? '');
}

/** Template refs that render empty (`steps.*` outputs, `trigger.item.*` / `trigger.upstream.*` fields) — dispatch-event audit detail. */
export function unresolvedTemplateRefs(template: string, run: RunRecord): string[] {
  const out: string[] = [];
  const steps = /\{\{\s*(steps\.([a-z0-9-]+)\.(answer|artifacts))\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = steps.exec(template)) !== null) {
    const output = run.steps.find((s) => s.stepId === m![2])?.output;
    const value = m[3] === 'answer' ? output?.answer : output?.artifacts?.join('');
    if (!value) out.push(m[1]);
  }
  for (const [, name] of template.matchAll(ITEM_VAR)) {
    if (!itemVar(run, name)) out.push(`trigger.item.${name}`);
  }
  for (const [, name] of template.matchAll(UPSTREAM_VAR)) {
    if (!upstreamVar(run, name)) out.push(`trigger.upstream.${name}`);
  }
  return [...new Set(out)];
}

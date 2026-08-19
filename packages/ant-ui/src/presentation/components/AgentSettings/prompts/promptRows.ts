/**
 * Prompts-card scope + row model — pure, store-free, so tests exercise
 * the truth table without a DOM.
 *
 * This surface is BASE PROSE ONLY: the definition files with structure are
 * owned by their own cards (agent.yaml / job.yaml / intents/{id}/infer.md /
 * prompt.md / hooks.yaml each get their own editing surface over the same
 * buffer), so listing them here too would re-open the two-writers-one-file
 * hazard. What remains is `base/*.md` — so the result is a FLAT row list (no
 * grouping survived the injections removal: every file here is base prose) and
 * the card renders on agent/job levels only (an intent's prose is its prompt
 * card).
 */

import type { CustomAgentDefinitionFileNode } from '@ant/shared';

export type PromptsScope = { level: 'agent' } | { level: 'job'; jobId: string };

export interface PromptRow {
  /** Full definition path (API vocabulary). */
  path: string;
  /** File name shown in the list. */
  name: string;
}

function collectFiles(nodes: CustomAgentDefinitionFileNode[], out: CustomAgentDefinitionFileNode[] = []) {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n);
    if (n.children) collectFiles(n.children, out);
  }
  return out;
}

/** Flatten the definition tree into the selection's base-prose surface. */
export function buildPromptRows(
  tree: CustomAgentDefinitionFileNode[],
  scope: PromptsScope,
): PromptRow[] {
  const files = collectFiles(tree);
  const prefix = scope.level === 'agent' ? '' : `jobs/${scope.jobId}/`;
  return files
    .filter((f) => /^base\/[^/]+\.md$/.test(f.path.slice(prefix.length)) && f.path.startsWith(prefix))
    .map((f) => ({ path: f.path, name: f.name }));
}

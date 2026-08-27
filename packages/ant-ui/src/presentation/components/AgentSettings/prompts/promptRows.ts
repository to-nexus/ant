/**
 * Prompts-card scope + row model — pure, store-free, so tests exercise
 * the truth table without a DOM.
 *
 * Two groups, split by DELIVERY, which is the only distinction a reader of
 * this card needs: `base/*.md` is injected on every turn, `on-demand/**` is
 * rendered as paths the model pulls with `read_file`. Files with structure
 * (agent.yaml / job.yaml / intents/{id}/*) are owned by their own cards and
 * deliberately absent here — listing them too would re-open the
 * two-writers-one-file hazard. On-demand docs have no other card, so this one
 * both lists and edits them.
 */

import { ON_DEMAND_DIR_NAME, type CustomAgentDefinitionFileNode } from '@ant/shared';

export type PromptsScope = { level: 'agent' } | { level: 'job'; jobId: string };

/** Which delivery channel a row belongs to. */
export type PromptRowGroup = 'base' | 'on-demand';

export interface PromptRow {
  /** Full definition path (API vocabulary). */
  path: string;
  /** Label shown in the list — a bare file name for base prose, the path under
   *  `on-demand/` for on-demand docs (they nest, so basenames collide). */
  name: string;
  group: PromptRowGroup;
}

function collectFiles(nodes: CustomAgentDefinitionFileNode[], out: CustomAgentDefinitionFileNode[] = []) {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n);
    if (n.children) collectFiles(n.children, out);
  }
  return out;
}

/** Flatten the definition tree into the selection's two prompt groups. */
export function buildPromptRows(
  tree: CustomAgentDefinitionFileNode[],
  scope: PromptsScope,
): PromptRow[] {
  const files = collectFiles(tree);
  const prefix = scope.level === 'agent' ? '' : `jobs/${scope.jobId}/`;
  const onDemandRel = new RegExp(`^${ON_DEMAND_DIR_NAME}/(.+\\.(?:md|json))$`);
  const rows: PromptRow[] = [];
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rel = f.path.slice(prefix.length);
    if (/^base\/[^/]+\.md$/.test(rel)) {
      rows.push({ path: f.path, name: f.name, group: 'base' });
      continue;
    }
    const onDemand = onDemandRel.exec(rel);
    if (onDemand) rows.push({ path: f.path, name: onDemand[1], group: 'on-demand' });
  }
  return rows;
}

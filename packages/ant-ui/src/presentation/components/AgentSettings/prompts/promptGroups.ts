/**
 * Prompts-card scope + grouping model — pure, store-free, so tests exercise
 * the truth table without a DOM.
 *
 * This surface is PROSE ONLY: the definition yaml files are owned by their
 * own cards (agent.yaml / job.yaml / intents.yaml each get a structured form
 * and a raw YAML view over the same buffer), so listing them here too would
 * re-open the two-writers-one-file hazard. The scoped shape is fixed and
 * shallow (agent = base/*.md · job = its jobs/{id}/ subtree · intent = only
 * the bound injection files), so the list is FLAT and grouped by semantics —
 * base = always injected, injections = intent-gated — instead of mirroring
 * directory nesting that carries no extra information.
 */

import type { CustomAgentDefinitionFileNode } from '@ant/shared';

export type PromptsScope =
  | { level: 'agent' }
  | { level: 'job'; jobId: string }
  | { level: 'intent'; jobId: string; intentInjections: string[] };

export type PromptRowKind = 'base' | 'injection';

export interface PromptRow {
  /** Full definition path (API vocabulary). */
  path: string;
  /** File name shown in the list. */
  name: string;
  kind: PromptRowKind;
  /** Intent ids that inline this file when active — injection rows only. */
  boundIntents: string[];
}

export interface PromptGroup {
  id: 'base' | 'injections' | 'bound';
  /** i18n key in the `agents` namespace. */
  labelKey: string;
  rows: PromptRow[];
}

function collectFiles(nodes: CustomAgentDefinitionFileNode[], out: CustomAgentDefinitionFileNode[] = []) {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n);
    if (n.children) collectFiles(n.children, out);
  }
  return out;
}

function toRow(
  node: CustomAgentDefinitionFileNode,
  kind: PromptRowKind,
  intentBindings: Record<string, string[]>,
): PromptRow {
  return {
    path: node.path,
    name: node.name,
    kind,
    boundIntents: kind === 'injection' ? (intentBindings[node.path] ?? []) : [],
  };
}

/** Flatten the definition tree into the selection's grouped prompt surface. */
export function buildPromptGroups(
  tree: CustomAgentDefinitionFileNode[],
  scope: PromptsScope,
  intentBindings: Record<string, string[]>,
): PromptGroup[] {
  const files = collectFiles(tree);
  const groups: PromptGroup[] = [];
  const push = (id: PromptGroup['id'], labelKey: string, rows: PromptRow[]) => {
    if (rows.length > 0) groups.push({ id, labelKey, rows });
  };

  if (scope.level === 'agent') {
    push(
      'base',
      'prompts.groupBase',
      files.filter((f) => /^base\/[^/]+\.md$/.test(f.path)).map((f) => toRow(f, 'base', intentBindings)),
    );
    return groups;
  }

  const prefix = `jobs/${scope.jobId}/`;
  const jobFiles = files.filter((f) => f.path.startsWith(prefix));

  if (scope.level === 'intent') {
    push(
      'bound',
      'prompts.groupBound',
      jobFiles
        .filter(
          (f) =>
            /^injections\/[^/]+\.md$/.test(f.path.slice(prefix.length)) &&
            scope.intentInjections.includes(f.name),
        )
        .map((f) => toRow(f, 'injection', intentBindings)),
    );
    return groups;
  }

  push(
    'base',
    'prompts.groupBase',
    jobFiles
      .filter((f) => /^base\/[^/]+\.md$/.test(f.path.slice(prefix.length)))
      .map((f) => toRow(f, 'base', intentBindings)),
  );
  push(
    'injections',
    'prompts.groupInjections',
    jobFiles
      .filter((f) => /^injections\/[^/]+\.md$/.test(f.path.slice(prefix.length)))
      .map((f) => toRow(f, 'injection', intentBindings)),
  );
  return groups;
}

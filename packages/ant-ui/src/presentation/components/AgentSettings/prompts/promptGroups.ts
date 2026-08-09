/**
 * Prompts-card scope + grouping model — pure, store-free, so tests exercise
 * the truth table without a DOM.
 *
 * The scoped surface has a fixed, shallow shape (agent = base/*.md +
 * agent.yaml · job = its jobs/{id}/ subtree · intent = only the bound
 * injection files), so the list is FLAT and grouped by semantics — base =
 * always injected, injections = intent-gated, config = the yaml hatches —
 * instead of mirroring directory nesting that carries no extra information.
 */

import type { CustomAgentDefinitionFileNode } from '@ant/shared';

export type PromptsScope =
  | { level: 'agent' }
  | { level: 'job'; jobId: string }
  | { level: 'intent'; jobId: string; intentInjections: string[] };

export type PromptRowKind = 'base' | 'injection' | 'config';

export interface PromptRow {
  /** Full definition path (API vocabulary). */
  path: string;
  /** File name shown in the list. */
  name: string;
  kind: PromptRowKind;
  /** Intent ids that inline this file when active — injection rows only. */
  boundIntents: string[];
  /** Structural files can never be renamed or deleted from the UI. */
  structural: boolean;
}

export interface PromptGroup {
  id: 'base' | 'injections' | 'config' | 'bound';
  /** i18n key in the `agents` namespace. */
  labelKey: string;
  rows: PromptRow[];
}

const STRUCTURAL_FILE = /^(agent\.yaml|jobs\/[^/]+\/job\.yaml)$/;

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
    structural: STRUCTURAL_FILE.test(node.path),
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
    push(
      'config',
      'prompts.groupConfig',
      files.filter((f) => f.path === 'agent.yaml').map((f) => toRow(f, 'config', intentBindings)),
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
  push(
    'config',
    'prompts.groupConfig',
    jobFiles
      .filter((f) => f.path === `${prefix}job.yaml` || f.path === `${prefix}intents.yaml`)
      .map((f) => toRow(f, 'config', intentBindings)),
  );
  return groups;
}

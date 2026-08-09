/**
 * buildPromptGroups — the Prompts card's selection-scoping + grouping truth
 * table. Prose only: Agent = base/*.md · Job = its jobs/{id}/ subtree grouped
 * base / injections · Intent = only the bound injection files. Definition
 * yaml never appears — each file is owned by its own card.
 */

import { describe, it, expect } from 'vitest';
import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import { buildPromptGroups } from '../../src/presentation/components/AgentSettings/prompts/promptGroups';

const file = (name: string, path: string): CustomAgentDefinitionFileNode => ({ name, path, type: 'file' });
const dir = (
  name: string,
  path: string,
  children: CustomAgentDefinitionFileNode[],
): CustomAgentDefinitionFileNode => ({ name, path, type: 'directory', children });

const TREE: CustomAgentDefinitionFileNode[] = [
  file('agent.yaml', 'agent.yaml'),
  dir('base', 'base', [file('role.md', 'base/role.md')]),
  dir('jobs', 'jobs', [
    dir('weekly', 'jobs/weekly', [
      file('job.yaml', 'jobs/weekly/job.yaml'),
      file('intents.yaml', 'jobs/weekly/intents.yaml'),
      dir('base', 'jobs/weekly/base', [file('system.md', 'jobs/weekly/base/system.md')]),
      dir('injections', 'jobs/weekly/injections', [
        file('style.md', 'jobs/weekly/injections/style.md'),
        file('extra.md', 'jobs/weekly/injections/extra.md'),
      ]),
    ]),
    dir('daily', 'jobs/daily', [file('job.yaml', 'jobs/daily/job.yaml')]),
  ]),
];

const BINDINGS = {
  'jobs/weekly/injections/style.md': ['research', 'cite'],
};

describe('buildPromptGroups', () => {
  it('agent scope = base group only (no jobs subtree, no agent.yaml)', () => {
    const groups = buildPromptGroups(TREE, { level: 'agent' }, {});
    expect(groups.map((g) => g.id)).toEqual(['base']);
    expect(groups[0].rows.map((r) => r.path)).toEqual(['base/role.md']);
  });

  it('job scope = base / injections of that job only, bindings propagated', () => {
    const groups = buildPromptGroups(TREE, { level: 'job', jobId: 'weekly' }, BINDINGS);
    expect(groups.map((g) => g.id)).toEqual(['base', 'injections']);
    const [base, injections] = groups;
    expect(base.rows.map((r) => r.path)).toEqual(['jobs/weekly/base/system.md']);
    expect(injections.rows.map((r) => [r.name, r.boundIntents])).toEqual([
      ['style.md', ['research', 'cite']],
      ['extra.md', []], // unbound → empty (renders the "not bound" pill)
    ]);
    expect(groups.flatMap((g) => g.rows).every((r) => r.path.startsWith('jobs/weekly/'))).toBe(true);
  });

  it('definition yaml is never listed — it is owned by its own card', () => {
    const paths = [
      ...buildPromptGroups(TREE, { level: 'agent' }, {}),
      ...buildPromptGroups(TREE, { level: 'job', jobId: 'weekly' }, BINDINGS),
    ].flatMap((g) => g.rows.map((r) => r.path));
    expect(paths.some((p) => p.endsWith('.yaml'))).toBe(false);
  });

  it('intent scope = only the bound injection files, as a single group', () => {
    const groups = buildPromptGroups(
      TREE,
      { level: 'intent', jobId: 'weekly', intentInjections: ['style.md'] },
      BINDINGS,
    );
    expect(groups.map((g) => g.id)).toEqual(['bound']);
    expect(groups[0].rows.map((r) => r.path)).toEqual(['jobs/weekly/injections/style.md']);
    expect(groups[0].rows[0].boundIntents).toEqual(['research', 'cite']);
  });

  it('unknown job / no bound injections → no groups (empty groups are dropped)', () => {
    expect(buildPromptGroups(TREE, { level: 'job', jobId: 'ghost' }, {})).toEqual([]);
    expect(
      buildPromptGroups(TREE, { level: 'intent', jobId: 'weekly', intentInjections: [] }, {}),
    ).toEqual([]);
  });
});

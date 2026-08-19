/**
 * buildPromptRows — the Prompts card's selection-scoping truth table.
 * Base prose only: Agent = base/*.md · Job = jobs/{id}/base/*.md. Structured
 * definition files (yaml, and every intents/{id}/ file — infer.md, prompt.md,
 * hooks.yaml) never appear — each is owned by its own card.
 */

import { describe, it, expect } from 'vitest';
import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import { buildPromptRows } from '../../src/presentation/components/AgentSettings/prompts/promptRows';

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
      dir('intents', 'jobs/weekly/intents', [
        dir('research', 'jobs/weekly/intents/research', [
          file('infer.md', 'jobs/weekly/intents/research/infer.md'),
          file('prompt.md', 'jobs/weekly/intents/research/prompt.md'),
          file('hooks.yaml', 'jobs/weekly/intents/research/hooks.yaml'),
        ]),
      ]),
      dir('base', 'jobs/weekly/base', [file('system.md', 'jobs/weekly/base/system.md')]),
    ]),
    dir('daily', 'jobs/daily', [file('job.yaml', 'jobs/daily/job.yaml')]),
  ]),
];

describe('buildPromptRows', () => {
  it('agent scope = agent base/*.md only (no jobs subtree, no agent.yaml)', () => {
    expect(buildPromptRows(TREE, { level: 'agent' }).map((r) => r.path)).toEqual(['base/role.md']);
  });

  it('job scope = that job\'s base/*.md only', () => {
    expect(buildPromptRows(TREE, { level: 'job', jobId: 'weekly' }).map((r) => r.path)).toEqual([
      'jobs/weekly/base/system.md',
    ]);
  });

  it('yaml and per-intent md files are never listed — each is owned by its own card', () => {
    const paths = [
      ...buildPromptRows(TREE, { level: 'agent' }),
      ...buildPromptRows(TREE, { level: 'job', jobId: 'weekly' }),
    ].map((r) => r.path);
    expect(paths.some((p) => p.endsWith('.yaml'))).toBe(false);
    expect(paths.some((p) => p.includes('/intents/'))).toBe(false);
  });

  it('unknown job → no rows', () => {
    expect(buildPromptRows(TREE, { level: 'job', jobId: 'ghost' })).toEqual([]);
  });
});

/**
 * buildPromptRows — the Prompts card's selection-scoping truth table.
 * Two groups per scope: `base/*.md` (injected every turn) and `on-demand/**`
 * (paths only, .md/.json, any depth). Structured definition files (yaml, and
 * every intents/{id}/ file — infer.md, prompt.md, hooks.yaml) never appear —
 * each is owned by its own card, and listing them twice would re-open the
 * two-writers-one-file hazard. On-demand docs have no other card, so they
 * belong here.
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
  dir('on-demand', 'on-demand', [file('spec.md', 'on-demand/spec.md')]),
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
      dir('on-demand', 'jobs/weekly/on-demand', [
        file('fields.md', 'jobs/weekly/on-demand/fields.md'),
        dir('vendor', 'jobs/weekly/on-demand/vendor', [
          file('openapi.json', 'jobs/weekly/on-demand/vendor/openapi.json'),
          file('notes.txt', 'jobs/weekly/on-demand/vendor/notes.txt'),
        ]),
      ]),
    ]),
    dir('daily', 'jobs/daily', [file('job.yaml', 'jobs/daily/job.yaml')]),
  ]),
];

describe('buildPromptRows', () => {
  it('agent scope = agent base/*.md + agent on-demand/** (no jobs subtree, no agent.yaml)', () => {
    expect(buildPromptRows(TREE, { level: 'agent' })).toEqual([
      { path: 'base/role.md', name: 'role.md', group: 'base' },
      { path: 'on-demand/spec.md', name: 'spec.md', group: 'on-demand' },
    ]);
  });

  it('job scope = that job\'s base/*.md + its on-demand/**, at any depth', () => {
    expect(buildPromptRows(TREE, { level: 'job', jobId: 'weekly' })).toEqual([
      { path: 'jobs/weekly/base/system.md', name: 'system.md', group: 'base' },
      { path: 'jobs/weekly/on-demand/fields.md', name: 'fields.md', group: 'on-demand' },
      // Nested docs keep their path as the label — bare basenames collide.
      { path: 'jobs/weekly/on-demand/vendor/openapi.json', name: 'vendor/openapi.json', group: 'on-demand' },
    ]);
  });

  it('an on-demand file outside .md/.json is not listed (the whitelist refuses it too)', () => {
    const paths = buildPromptRows(TREE, { level: 'job', jobId: 'weekly' }).map((r) => r.path);
    expect(paths).not.toContain('jobs/weekly/on-demand/vendor/notes.txt');
  });

  it('a scope never lists the other level\'s on-demand docs', () => {
    const agent = buildPromptRows(TREE, { level: 'agent' }).map((r) => r.path);
    expect(agent.some((p) => p.startsWith('jobs/'))).toBe(false);
    const job = buildPromptRows(TREE, { level: 'job', jobId: 'weekly' }).map((r) => r.path);
    expect(job).not.toContain('on-demand/spec.md');
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

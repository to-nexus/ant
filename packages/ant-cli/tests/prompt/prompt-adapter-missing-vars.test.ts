/**
 * FilePromptAdapter missing-vars validator — span-based false-positive guard.
 *
 * The legacy heuristic matched `{{#if X}}[\s\S]*?{{var}}` from the FIRST
 * `#if` in the file, was blind to `{{#each}}` scoping, and flagged vars used
 * purely as `#if` gate heads. Every execute/plan render warned about
 * `visualTierActive` / `pairedFeature` / `label` / `path` — pure log noise
 * (broad-mining-minty cleanup). This locks the corrected semantics: a var is
 * missing only when some occurrence would actually render undefined content.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

let baseDir: string;
let adapter: FilePromptAdapter;

async function addTemplate(name: string, source: string): Promise<void> {
  const file = join(baseDir, `${name}.md`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source, 'utf8');
}

async function violationsFor(name: string, vars: Record<string, any>): Promise<string[]> {
  adapter.clearViolations();
  await adapter.render(name, vars);
  return adapter.lastViolations.flatMap(v => v.missingVars);
}

beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'prompt-adapter-test-'));
  adapter = new FilePromptAdapter(baseDir);
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('FilePromptAdapter missing-vars validation', () => {
  it('does not flag a var used only as an #if gate head', async () => {
    await addTemplate('gate-head', 'A{{#if visualTierActive}}tier on{{/if}}B');
    expect(await violationsFor('gate-head', {})).toEqual([]);
  });

  it('does not flag each-scoped iteration fields', async () => {
    await addTemplate(
      'each-scoped',
      '{{#each docs}}### {{#if label}}{{label}}{{else}}{{path}}{{/if}}\n{{{content}}}\n{{/each}}',
    );
    expect(await violationsFor('each-scoped', { docs: [{ path: 'a.md', content: 'x' }] })).toEqual([]);
  });

  it('does not flag self-guarded dotted usage ({{#if x}}{{x.name}}{{/if}})', async () => {
    await addTemplate('self-guarded', '{{#if pairedFeature}}twin: {{pairedFeature.name}}{{/if}}');
    expect(await violationsFor('self-guarded', {})).toEqual([]);
  });

  it('does not flag a var whose only rendering guard is falsy', async () => {
    await addTemplate('other-guard-falsy', '{{#if showExtra}}extra: {{extraNote}}{{/if}}');
    expect(await violationsFor('other-guard-falsy', { showExtra: false })).toEqual([]);
  });

  it('still flags a genuinely missing unguarded var', async () => {
    await addTemplate('really-missing', 'Task: {{taskName}}');
    expect(await violationsFor('really-missing', {})).toEqual(['taskName']);
  });

  it('still flags a missing var behind a truthy guard', async () => {
    await addTemplate('truthy-guard', '{{#if showExtra}}extra: {{extraNote}}{{/if}}');
    expect(await violationsFor('truthy-guard', { showExtra: true })).toEqual(['extraNote']);
  });

  it('does not flag registered helper names used in expressions ({{json …}})', async () => {
    // lapis-oaring-drain forensics noise: the hand-maintained helper list
    // omitted `json`, so every detect/triage render warned
    // "missing variables [json]" and JobWorker quoted it as a failure reason.
    await addTemplate('json-helper', 'Spec docs: {{json specDocNames}}');
    expect(await violationsFor('json-helper', { specDocNames: ['a.md'] })).toEqual([]);
  });
});

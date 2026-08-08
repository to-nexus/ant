/**
 * Universal prompt injection — gate truth table, not prose:
 *   1. wrapCustomJobContent produces the boundary-tagged inert block.
 *   2. PromptBuilder.build() places `inertSystemAppend` INSIDE the system
 *      prompt, after the merged injections and before the policy section
 *      (guardrail-first / policy-last invariants hold).
 *   3. Omitting inertSystemAppend injects nothing (gate off).
 */

import { describe, it, expect } from 'vitest';
import { wrapCustomJobContent } from '../../src/core/prompt/builder/InputSanitizer';
import { PromptBuilder } from '../../src/core/prompt/builder/PromptBuilder';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { TEMPLATE_PATHS } from '../../src/core/prompt/builder/templatePaths';
import { buildCustomJobSystemBlock, INJECTION_INLINE_CAP } from '../../src/agents/universal/graph/nodes/agent';
import type { ResolvedCustomJob, InjectionTocEntry } from '../../src/core/customAgents/types';

const SENTINEL = 'UNIQUE-CUSTOM-DEFINITION-SENTINEL-9313';

describe('wrapCustomJobContent', () => {
  it('wraps in <custom_job_instructions> with id + source attributes', () => {
    const wrapped = wrapCustomJobContent('persona prose', 'ops/weekly');
    expect(wrapped).toContain('<custom_job_instructions id="ops/weekly" source="workspace">');
    expect(wrapped).toContain('persona prose');
    expect(wrapped.trimEnd().endsWith('</custom_job_instructions>')).toBe(true);
  });

  it('empty content passes through unchanged', () => {
    expect(wrapCustomJobContent('', 'a/b')).toBe('');
  });
});

describe('PromptBuilder inertSystemAppend gate', () => {
  const builder = new PromptBuilder(new FilePromptAdapter());
  const baseVars = {
    isKorean: false,
    agentName: 'Ops',
    jobName: 'Weekly',
    jobDescription: '',
    artifactsOverview: '(empty)',
    workspaceAccess: 'none',
    hasMcpServers: false,
    definitionMount: '_agent-definition/',
  };

  it('ON: custom block lands in system, after rules/injections content', async () => {
    const inert = wrapCustomJobContent(SENTINEL, 'ops/weekly');
    const result = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: baseVars,
      inertSystemAppend: inert,
    });

    expect(result.system).toContain(SENTINEL);
    expect(result.user).not.toContain(SENTINEL);

    // after the rules section content
    const rulesIdx = result.system.indexOf('Runtime Contract');
    const customIdx = result.system.indexOf(SENTINEL);
    expect(rulesIdx).toBeGreaterThanOrEqual(0);
    expect(customIdx).toBeGreaterThan(rulesIdx);
  });

  it('ON + policy guardrails: custom block stays BEFORE the policy section (policy-last)', async () => {
    const inert = wrapCustomJobContent(SENTINEL, 'ops/weekly');
    const result = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: baseVars,
      inertSystemAppend: inert,
      pipeline: { applyPolicyGuardrails: true },
    });
    const customIdx = result.system.indexOf(SENTINEL);
    expect(customIdx).toBeGreaterThanOrEqual(0);
    if (result.sections.policy) {
      const policyIdx = result.system.indexOf(result.sections.policy);
      expect(customIdx).toBeLessThan(policyIdx);
    }
    if (result.sections.guardrail) {
      const guardrailIdx = result.system.indexOf(result.sections.guardrail);
      expect(guardrailIdx).toBeLessThan(customIdx);
    }
  });

  it('OFF: nothing injected without inertSystemAppend', async () => {
    const result = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: baseVars,
    });
    expect(result.system).not.toContain(SENTINEL);
    // rules.md legitimately NAMES the tag; only an actual opening tag with
    // attributes would mean an injected block.
    expect(result.system).not.toContain('<custom_job_instructions id=');
  });

  it('plan gate: off → no plan section; suggested/required → gated section with planDir', async () => {
    const offResult = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: { ...baseVars, planMode: 'off', planDir: undefined },
    });
    expect(offResult.user).not.toContain('Plan Directory');

    const suggested = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: { ...baseVars, planMode: 'suggested', planDir: 'plan/ops/weekly' },
    });
    expect(suggested.user).toContain('plan/ops/weekly');
    expect(suggested.user).not.toContain('REQUIRED');

    const required = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: { ...baseVars, planMode: 'required', planDir: 'plan/ops/weekly' },
    });
    expect(required.user).toContain('plan/ops/weekly');
    expect(required.user).toContain('REQUIRED');
  });
});

// ── intent-gated injection inlining (buildCustomJobSystemBlock) ──────────────

function makeResolved(toc: InjectionTocEntry[]): ResolvedCustomJob {
  return {
    agentId: 'ops',
    jobId: 'weekly',
    scope: 'user',
    agentName: 'Ops',
    jobName: 'Weekly',
    description: '',
    prose: 'PERSONA-PROSE',
    injectionsToc: toc,
    intents: [],
    mcpServers: {},
    builtinTools: [],
    approval: {},
    workspace: 'none',
    models: {},
    plan: 'suggested',
    outputs: { mode: 'free' },
    agentDir: '/tmp/x',
    jobDir: '/tmp/x/jobs/weekly',
  };
}

function entry(file: string, opts?: { intents?: string[]; body?: string }): InjectionTocEntry {
  return { file, summary: `${file} summary`, absolutePath: `/tmp/x/injections/${file}`, ...opts };
}

describe('buildCustomJobSystemBlock — intent gate truth table', () => {
  it('matched intent → body inlined in the Active section, entry ABSENT from TOC', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('a.md', { intents: ['research'], body: 'A-BODY' })]),
      ['research'],
    );
    expect(block).toContain('Active Situation Instructions');
    expect(block).toContain('A-BODY');
    expect(block).not.toContain('_agent-definition/injections/a.md');
  });

  it('unmatched intent → TOC entry only (current on-demand behavior)', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('a.md', { intents: ['research'], body: 'A-BODY' })]),
      ['other'],
    );
    expect(block).not.toContain('Active Situation Instructions');
    expect(block).not.toContain('A-BODY');
    expect(block).toContain('_agent-definition/injections/a.md');
  });

  it('unmapped injection → always pure TOC regardless of active intents (backcompat)', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('free.md')]),
      ['research'],
    );
    expect(block).toContain('_agent-definition/injections/free.md');
    expect(block).not.toContain('Active Situation Instructions');
  });

  it('general-only → even mapped injections stay TOC (always-on prose belongs in base/)', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('a.md', { intents: ['research'], body: 'A-BODY' })]),
      ['general'],
    );
    expect(block).not.toContain('A-BODY');
    expect(block).toContain('_agent-definition/injections/a.md');
  });

  it('overflow → the oversized file demotes WHOLESALE to TOC with the applies-now marker', () => {
    const huge = 'X'.repeat(INJECTION_INLINE_CAP + 1);
    const block = buildCustomJobSystemBlock(
      makeResolved([
        entry('big.md', { intents: ['research'], body: huge }),
        entry('small.md', { intents: ['research'], body: 'SMALL-BODY' }),
      ]),
      ['research'],
    );
    expect(block).not.toContain(huge);
    expect(block).toContain('applies to the current request');
    // Remaining budget still inlines the smaller sibling.
    expect(block).toContain('SMALL-BODY');
  });

  it('no activeIntents argument (default []) → legacy TOC-only rendering', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('a.md', { intents: ['research'], body: 'A-BODY' })]),
    );
    expect(block).not.toContain('A-BODY');
    expect(block).toContain('_agent-definition/injections/a.md');
  });
});

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
import { buildCustomJobSystemBlock, INJECTION_INLINE_CAP } from '../../src/core/customAgents/promptBlock';
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
    hasMcpServers: false,
    definitionMount: '_agent-definition/',
    planTurn: false,
    planDocsDir: 'plan/ops/weekly',
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

  it('plan-turn gate: off → no PLAN TURN section; on → section with the plan docs dir', async () => {
    const offResult = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: { ...baseVars, planTurn: false },
    });
    expect(offResult.user).not.toContain('PLAN TURN');

    const onResult = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: { ...baseVars, planTurn: true },
    });
    expect(onResult.user).toContain('PLAN TURN');
    expect(onResult.user).toContain('plan/ops/weekly');
  });

  it('planDocs gate: off → no Plan Documents band; on → listed paths', async () => {
    const offResult = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: baseVars,
    });
    expect(offResult.user).not.toContain('Plan Documents');

    const onResult = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: { ...baseVars, planDocs: ['plan/ops/weekly/report-plan.md'] },
    });
    expect(onResult.user).toContain('Plan Documents');
    expect(onResult.user).toContain('plan/ops/weekly/report-plan.md');
  });

  it('existingChecklist gate: off → no Working Checklist band; on → serialized list (+ plan source)', async () => {
    const offResult = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: baseVars,
    });
    expect(offResult.user).not.toContain('Working Checklist');

    const onResult = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: {
        ...baseVars,
        existingChecklist: '- [x] first\n- [~] second',
        existingChecklistPlan: 'plan/ops/weekly/report-plan.md',
      },
    });
    expect(onResult.user).toContain('Working Checklist');
    expect(onResult.user).toContain('- [~] second');
    expect(onResult.user).toContain('plan/ops/weekly/report-plan.md');
  });

  it('checklist contract is always-on in rules (creation stays conditional in prose)', async () => {
    const result = await builder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: baseVars,
    });
    expect(result.system).toContain('Checklist Contract');
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
    prose: 'PERSONA-PROSE',
    injectionsToc: toc,
    intents: [],
    mcpServers: {},
    builtinTools: [],
    approval: {},
    agentDir: '/tmp/x',
    jobDir: '/tmp/x/jobs/weekly',
  };
}

function entry(file: string, opts?: { intents?: string[]; body?: string }): InjectionTocEntry {
  return { file, summary: `${file} summary`, absolutePath: `/tmp/x/jobs/weekly/injections/${file}`, ...opts };
}

const TOC_PATH = (file: string): string => `_agent-definition/jobs/weekly/injections/${file}`;

describe('buildCustomJobSystemBlock — intent gate truth table', () => {
  it('matched intent → body inlined in the Active section, entry ABSENT from TOC', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('a.md', { intents: ['research'], body: 'A-BODY' })]),
      ['research'],
    );
    expect(block.text).toContain('Active Situation Instructions');
    expect(block.text).toContain('A-BODY');
    expect(block.text).not.toContain(TOC_PATH('a.md'));
    expect(block.inlined).toEqual(['a.md']);
    expect(block.toc).toEqual([]);
  });

  it('unmatched intent → TOC entry only (current on-demand behavior)', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('a.md', { intents: ['research'], body: 'A-BODY' })]),
      ['other'],
    );
    expect(block.text).not.toContain('Active Situation Instructions');
    expect(block.text).not.toContain('A-BODY');
    expect(block.text).toContain(TOC_PATH('a.md'));
    expect(block.inlined).toEqual([]);
    expect(block.toc).toEqual(['a.md']);
  });

  it('unmapped injection → always pure TOC regardless of active intents (backcompat)', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('free.md')]),
      ['research'],
    );
    expect(block.text).toContain(TOC_PATH('free.md'));
    expect(block.text).not.toContain('Active Situation Instructions');
  });

  it('general-only → even mapped injections stay TOC (always-on prose belongs in base/)', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('a.md', { intents: ['research'], body: 'A-BODY' })]),
      ['general'],
    );
    expect(block.text).not.toContain('A-BODY');
    expect(block.text).toContain(TOC_PATH('a.md'));
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
    expect(block.text).not.toContain(huge);
    expect(block.text).toContain('applies to the current request');
    // Remaining budget still inlines the smaller sibling.
    expect(block.text).toContain('SMALL-BODY');
    expect(block.inlined).toEqual(['small.md']);
    expect(block.toc).toEqual(['big.md']);
  });

  it('no activeIntents argument (default []) → legacy TOC-only rendering', () => {
    const block = buildCustomJobSystemBlock(
      makeResolved([entry('a.md', { intents: ['research'], body: 'A-BODY' })]),
    );
    expect(block.text).not.toContain('A-BODY');
    expect(block.text).toContain(TOC_PATH('a.md'));
  });
});

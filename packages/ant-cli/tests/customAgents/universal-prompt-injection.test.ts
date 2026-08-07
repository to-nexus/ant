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
});

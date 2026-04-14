/**
 * Policy ruleset loader — isolates fs dependency from PromptBuilder.
 *
 * Loads ruleset.json once (lazy, cached) and provides formatting helpers
 * for guardrail and quality-policy sections.
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePathResolver } from '../../config/WorkspacePathResolver';

export interface PolicyRuleset {
  common: {
    format: Record<string, string>;
    prohibited: string[];
    quality: string[];
  };
  [job: string]: any;
}

let cachedRuleset: PolicyRuleset | null = null;

export function loadPolicyRuleset(): PolicyRuleset {
  if (cachedRuleset) return cachedRuleset;

  const policiesPath = WorkspacePathResolver.getPoliciesPath();
  const rulesetPath = path.join(policiesPath, 'ruleset.json');

  if (!fs.existsSync(rulesetPath)) {
    throw new Error(`Policy ruleset not found at: ${rulesetPath}\nANT_CLI_ROOT: ${process.env.ANT_CLI_ROOT || '(not set)'}`);
  }

  cachedRuleset = JSON.parse(fs.readFileSync(rulesetPath, 'utf8'));
  return cachedRuleset!;
}

export function buildPolicySection(
  ruleset: PolicyRuleset,
  job: string,
  phase: string,
  strictValidation?: boolean,
): string {
  const sections: string[] = [];

  sections.push('<quality_policies>');

  sections.push('\n## Output Format Rules');
  Object.entries(ruleset.common.format).forEach(([, value]) => {
    sections.push(`- ${value}`);
  });

  sections.push('\n## Prohibited Patterns');
  ruleset.common.prohibited.forEach((rule: string) => {
    sections.push(`- ${rule}`);
  });

  sections.push('\n## Quality Requirements');
  ruleset.common.quality.forEach((rule: string) => {
    sections.push(`- ${rule}`);
  });

  const taskSpecific = ruleset[job]?.[phase];
  if (taskSpecific?.rules) {
    sections.push(`\n## ${job.toUpperCase()} ${phase.toUpperCase()} Rules`);
    taskSpecific.rules.forEach((rule: string) => {
      sections.push(`- ${rule}`);
    });
  }

  if (taskSpecific?.validation) {
    sections.push('\n## Pre-Output Validation Checklist');
    taskSpecific.validation.forEach((check: string) => {
      sections.push(`- [ ] ${check}`);
    });
  }

  if (strictValidation) {
    const strictConfig = ruleset.strict_mode;
    if (strictConfig?.enabled_for?.includes(job)) {
      sections.push('\n## ⚠️ STRICT MODE ENABLED');
      sections.push('**CRITICAL REQUIREMENTS:**');
      strictConfig.rules.forEach((rule: string) => {
        sections.push(`- ❌ ${rule}`);
      });
    }
  }

  sections.push('</quality_policies>');

  return sections.join('\n');
}

export function buildGuardrailSection(
  ruleset: PolicyRuleset,
  job: string,
): string {
  const guardrails: string[] = [];

  guardrails.push('<guardrails>');
  guardrails.push('Before responding, you MUST:');

  const jobGuardrails = ruleset?.guardrails?.[job] as string[] | undefined;
  if (jobGuardrails && jobGuardrails.length > 0) {
    jobGuardrails.forEach((rule: string, i: number) => {
      guardrails.push(`${i + 1}. ✓ ${rule}`);
    });
  }

  guardrails.push('\nIf validation fails, revise your output before responding.');
  guardrails.push('</guardrails>');

  return guardrails.join('\n');
}

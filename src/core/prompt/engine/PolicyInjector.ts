import * as fs from "fs";
import * as path from "path";
import { AgentTask } from "../../types";
import { PromptModeConfig } from "./ModeController";

/**
 * Policy rules loaded from ruleset
 */
export interface PolicyRules {
  common: {
    format: Record<string, string>;
    prohibited: string[];
    quality: string[];
  };
  taskSpecific?: {
    rules?: string[];
    validation?: string[];
  };
  strictMode?: {
    enabled: boolean;
    rules: string[];
  };
}

/**
 * PolicyInjector - Layer 5
 * Injects quality control policies and guardrails into prompts
 * 
 * Responsibilities:
 * - Load policy ruleset
 * - Select applicable rules for mode
 * - Format rules for injection
 * - Apply strict mode when needed
 */
export class PolicyInjector {
  private ruleset: any;
  
  constructor() {
    // Load ruleset from JSON
    // PolicyInjector is in src/core/prompt/engine/
    // ruleset.json is in src/core/policies/prompts/
    const rulesetPath = path.join(__dirname, "../..", "policies", "prompts", "ruleset.json");
    this.ruleset = JSON.parse(fs.readFileSync(rulesetPath, "utf8"));
  }
  
  /**
   * Build policy section for prompt
   */
  buildPolicySection(modeConfig: PromptModeConfig): string {
    const rules = this.selectRules(modeConfig);
    return this.formatPolicySection(rules, modeConfig);
  }
  
  /**
   * Select applicable rules for mode
   */
  private selectRules(modeConfig: PromptModeConfig): PolicyRules {
    const rules: PolicyRules = {
      common: this.ruleset.common
    };
    
    // Add task-specific rules
    if (this.ruleset[modeConfig.task]) {
      rules.taskSpecific = this.ruleset[modeConfig.task][modeConfig.phase];
    }
    
    // Add strict mode if applicable
    if (modeConfig.flags.strictValidation) {
      const strictConfig = this.ruleset.strict_mode;
      rules.strictMode = {
        enabled: strictConfig.enabled_for.includes(modeConfig.task),
        rules: strictConfig.rules
      };
    }
    
    return rules;
  }
  
  /**
   * Format policy section for prompt injection
   */
  private formatPolicySection(rules: PolicyRules, modeConfig: PromptModeConfig): string {
    const sections: string[] = [];
    
    sections.push('<quality_policies>');
    
    // Common rules
    sections.push('\n## Output Format Rules');
    Object.entries(rules.common.format).forEach(([key, value]) => {
      sections.push(`- ${value}`);
    });
    
    sections.push('\n## Prohibited Patterns');
    rules.common.prohibited.forEach(rule => {
      sections.push(`- ${rule}`);
    });
    
    sections.push('\n## Quality Requirements');
    rules.common.quality.forEach(rule => {
      sections.push(`- ${rule}`);
    });
    
    // Task-specific rules
    if (rules.taskSpecific?.rules) {
      sections.push(`\n## ${modeConfig.task.toUpperCase()} ${modeConfig.phase.toUpperCase()} Rules`);
      rules.taskSpecific.rules.forEach(rule => {
        sections.push(`- ${rule}`);
      });
    }
    
    // Validation checklist
    if (rules.taskSpecific?.validation) {
      sections.push('\n## Pre-Output Validation Checklist');
      rules.taskSpecific.validation.forEach(check => {
        sections.push(`- [ ] ${check}`);
      });
    }
    
    // Strict mode warnings
    if (rules.strictMode?.enabled) {
      sections.push('\n## ⚠️ STRICT MODE ENABLED');
      sections.push('**CRITICAL REQUIREMENTS:**');
      rules.strictMode.rules.forEach(rule => {
        sections.push(`- ❌ ${rule}`);
      });
    }
    
    sections.push('</quality_policies>');
    
    return sections.join('\n');
  }
  
  /**
   * Build guardrail section (inserted at top of prompt)
   */
  buildGuardrailSection(modeConfig: PromptModeConfig): string {
    const guardrails: string[] = [];
    
    guardrails.push('<guardrails>');
    guardrails.push('Before responding, you MUST:');
    
    // Task-specific guardrails
    if (modeConfig.task === 'code') {
      guardrails.push('1. ✓ Verify all code is complete (no ellipsis or placeholders)');
      guardrails.push('2. ✓ Check all imports are valid');
      guardrails.push('3. ✓ Ensure proper error handling');
      guardrails.push('4. ✓ Validate types and interfaces');
    } else if (modeConfig.task === 'design') {
      guardrails.push('1. ✓ Include all required sections');
      guardrails.push('2. ✓ Define clear interfaces and contracts');
      guardrails.push('3. ✓ Consider edge cases and error scenarios');
      guardrails.push('4. ✓ Specify data flow and dependencies');
    }
    
    guardrails.push('\nIf validation fails, revise your output before responding.');
    guardrails.push('</guardrails>');
    
    return guardrails.join('\n');
  }
}


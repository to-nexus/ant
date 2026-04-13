/**
 * PromptBuilder — Declarative 4-tier prompt assembly.
 *
 * Replaces the PromptEngine's 6-layer pipeline with a single build(config) entry point.
 * Injection resolution: Tier I + Tier A + Tier D + Tier N → deduplicated list.
 *
 * Returns both:
 *   - Merged system/user strings (for simple callers)
 *   - Granular sections (for cache-block-aware callers like execute promptBuilder)
 */

import type { PromptPort, ProfilePort } from '../../ports';
import type { PolicyKey, TechTier, ResolvedArtifact } from '@ant/shared';
import { getPromptPolicies, POLICY_TEMPLATE_MAP } from '@ant/shared';
import type { PromptBuildConfig, PromptBuildResult } from './PromptBuildConfig';
import { AutoInjectionResolver } from './AutoInjectionResolver';
import { sanitizeInjectionVars } from './InputSanitizer';
import {
  loadPolicyRuleset,
  buildPolicySection,
  buildGuardrailSection,
  type PolicyRuleset,
} from './policyRules';

export class PromptBuilder implements PromptPort {
  private autoResolver = new AutoInjectionResolver();
  private systemPromptCache: Record<string, string> = {};
  private policyRuleset: PolicyRuleset | null = null;

  constructor(
    private promptPort: PromptPort,
    private profilePort?: ProfilePort,
  ) {}

  /**
   * Simple render — direct template rendering without injection resolution.
   * Use for nodes that just need a rendered template (detect, revise, keyword, etc.).
   */
  async render(templatePath: string, vars: Record<string, any>): Promise<string> {
    return await this.promptPort.render(templatePath, vars);
  }

  /**
   * Build a prompt from a declarative config.
   *
   * 1. Merge injections from all 4 tiers
   * 2. Render templates (system, rules, base, injections, profiles, examples)
   * 3. Optionally sanitize user-controlled input
   * 4. Return both merged output and granular sections
   */
  async build(config: PromptBuildConfig): Promise<PromptBuildResult> {
    const startTime = Date.now();
    const failedTemplates: string[] = [];

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 1: Resolve all injections
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const allInjections = this.resolveInjections(config);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 2: Prepare template variables
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let vars = { ...config.vars };

    const processedArtifacts = config.artifacts?.length ? config.artifacts : undefined;

    if (processedArtifacts?.length) {
      vars['documents'] = processedArtifacts;
      vars['hasDocuments'] = true;
    }

    if (vars['resolvedAction'] && processedArtifacts?.length) {
      vars['resolvedAction'] = {
        ...(vars['resolvedAction'] as Record<string, unknown>),
        documents: processedArtifacts,
        artifacts: processedArtifacts,
      };
    }

    if (config.pipeline.sanitizeInput) {
      vars = sanitizeInjectionVars(vars);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 3: Render all sections
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 3a. System prompt (cached by job prefix)
    let systemBase = '';
    if (config.templates.system) {
      systemBase = await this.getSystemPrompt(config.templates.system);
    }

    // 3b. Tech profile (language + framework)
    let profiles = '';
    if (config.pipeline.includeTechProfile) {
      const techTier = config.techContext?.techTier;
      profiles = await this.buildProfileSection(techTier);
    }

    // 3c. Rules template
    const rules = await this.renderTemplate(config.templates.rules, vars, failedTemplates, true);

    // 3d. Injections
    const injectionParts: string[] = [];
    for (const injPath of allInjections) {
      const rendered = await this.renderTemplate(injPath, vars, failedTemplates);
      if (rendered) {
        injectionParts.push(rendered);
      }
    }
    const injectionsMerged = injectionParts.join('\n\n');

    // 3e. Examples (optional)
    let examples = '';
    if (config.pipeline.includeExamples) {
      const job = this.inferJob(config);
      examples = await this.renderTemplate(`${job}/base/examples`, {}, failedTemplates);
    }

    // 3f. Base (user) template
    const user = await this.renderTemplate(config.templates.base, vars, failedTemplates, true);

    if (failedTemplates.length > 0) {
      console.error(`🚨 [PromptBuilder] ${failedTemplates.length} template(s) failed: ${failedTemplates.join(', ')}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 4: Assemble merged output
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const systemParts = [systemBase, profiles, rules, injectionsMerged, examples].filter(Boolean);

    let guardrail = '';
    let policy = '';
    if (config.pipeline.applyPolicyGuardrails) {
      const ruleset = this.getRuleset();
      const job = this.inferJob(config);
      const phase = this.inferPhase(config);
      guardrail = buildGuardrailSection(ruleset, job);
      policy = buildPolicySection(ruleset, job, phase, config.pipeline.strictValidation);
      systemParts.unshift(guardrail);
      systemParts.push(policy);
    }

    const system = systemParts.join('\n\n');

    return {
      system,
      user,
      sections: {
        systemBase,
        rules,
        injections: injectionsMerged,
        profiles,
        examples,
        guardrail,
        policy,
        failedTemplates,
      },
      injections: allInjections,
      buildTimeMs: Date.now() - startTime,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Injection Resolution
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private resolveInjections(config: PromptBuildConfig): string[] {
    const injectionPaths: string[] = [];

    // Tier I: Intent-driven static policies
    if (config.intent) {
      const intentPolicy = getPromptPolicies(config.intent);
      for (const pk of intentPolicy.policies) {
        const tmpl = POLICY_TEMPLATE_MAP[pk];
        if (tmpl) injectionPaths.push(tmpl);
      }
    }

    // Tier A + D: Auto-resolved injections
    if (config.techContext) {
      const autoInjections = this.autoResolver.resolve({
        job: this.inferJob(config),
        phase: this.inferPhase(config),
        taskType: config.techContext.taskType,
        mode: config.techContext.mode,
        resolvedAction: config.techContext.resolvedAction,
        techTiers: config.techContext.techTiers,
        techTier: config.techContext.techTier,
        data: this.extractDataSignals(config),
      });
      for (const path of autoInjections) {
        injectionPaths.push(path);
      }
    }

    // Tier N: Artifact-conditional policies
    if (config.artifactPolicies?.length) {
      for (const pk of config.artifactPolicies) {
        const tmpl = POLICY_TEMPLATE_MAP[pk];
        if (tmpl) injectionPaths.push(tmpl);
      }
    }

    return this.deduplicate(injectionPaths);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Template Rendering
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private async getSystemPrompt(templatePath: string): Promise<string> {
    if (!this.systemPromptCache[templatePath]) {
      try {
        this.systemPromptCache[templatePath] = await this.promptPort.render(templatePath, {});
      } catch {
        console.warn(`⚠️ [PromptBuilder] System template not found: ${templatePath}`);
        return '';
      }
    }
    return this.systemPromptCache[templatePath];
  }

  private async buildProfileSection(techTier?: TechTier | null): Promise<string> {
    if (!this.profilePort || !techTier) return '';

    const sections: string[] = [];

    if (techTier.language) {
      const profile = await this.profilePort.loadLanguage(techTier.language);
      if (profile) {
        sections.push(`<tech_profile language="${techTier.language}">\n${profile}\n</tech_profile>`);
      }
    }

    if (techTier.framework) {
      const profile = await this.profilePort.loadFramework(techTier.framework);
      if (profile) {
        sections.push(`<framework_profile framework="${techTier.framework}">\n${profile}\n</framework_profile>`);
      }
    }

    return sections.join('\n\n');
  }

  private async renderTemplate(
    templatePath: string | undefined,
    vars: Record<string, unknown>,
    failedTemplates: string[],
    critical = false,
  ): Promise<string> {
    if (!templatePath) return '';
    try {
      return await this.promptPort.render(templatePath, vars as Record<string, any>);
    } catch (err) {
      failedTemplates.push(templatePath);
      if (critical) {
        console.error(`🚨 [PromptBuilder] Critical template failed: ${templatePath}`);
      }
      return '';
    }
  }

  /**
   * Render an enforcement/retry prompt for validation failures.
   */
  async renderEnforcement(violationMessage: string): Promise<string> {
    return await this.render('code/phases/enforce/rules-enforcement', { errorText: violationMessage });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private inferJob(config: PromptBuildConfig): string {
    return config.templates.base.split('/')[0] || 'code';
  }

  private inferPhase(config: PromptBuildConfig): 'plan' | 'execute' {
    const basePath = config.templates.base;
    if (basePath.includes('/phases/execute/') || basePath.includes('/execute/')) return 'execute';
    if (basePath.includes('/phases/plan/') || basePath.includes('/plan/')) return 'plan';
    return 'execute';
  }

  private extractDataSignals(config: PromptBuildConfig): Record<string, boolean> {
    const v = config.vars;
    return {
      hasDirective: Boolean(v['directive']),
      hasMemory: Boolean(v['memory']),
      hasGitDiff: Boolean(
        (v['projectCodeContext'] as any)?.gitDiff,
      ),
      hasRetrievedCode: Boolean(
        (v['projectCodeContext'] as any)?.files?.length > 0,
      ),
      hasReferenceCode: Boolean(
        v['referenceCodeContexts'] && (v['referenceCodeContexts'] as unknown[]).length > 0,
      ),
      hasProjectCode: Boolean(
        v['hasProjectCode'] || (v['projectCodeContext'] as any)?.files?.length > 0,
      ),
      hasRetryContext: Boolean(v['retryContext']),
      hasLessons: Boolean(v['lessons'] && (v['lessons'] as unknown[]).length > 0),
      hasSessionContext: Boolean((v['sessionContext'] as any)?.totalRuns > 0),
      hasMissingDependency: Boolean(v['hasMissingDependency']),
      hasRuntimeError: Boolean(v['hasRuntimeError']),
    };
  }

  private getRuleset(): PolicyRuleset {
    if (!this.policyRuleset) {
      this.policyRuleset = loadPolicyRuleset();
    }
    return this.policyRuleset;
  }

  private deduplicate(arr: string[]): string[] {
    const seen = new Set<string>();
    return arr.filter(v => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
  }
}

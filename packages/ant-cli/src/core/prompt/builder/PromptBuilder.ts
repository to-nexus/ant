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

import type { PromptPort } from '../../ports';
import type { PolicyKey, Basis } from '@ant/shared';
import { getPromptPolicies, POLICY_TEMPLATE_MAP } from '@ant/shared';
import {
  resolveLanguageVariants,
  TECH_TIER_TEMPLATE_PATHS,
  FRAMEWORK_NONE,
  VISUAL_TIER_TEMPLATE_PATHS,
  VISUAL_TIER_LAYER_KEYS,
  type SupportedLanguage,
  type SupportedStack,
} from '@ant/shared';
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

  constructor(private promptPort: PromptPort) {}

  /**
   * Simple render — direct template rendering without injection resolution.
   * Use for nodes that just need a rendered template (detect, revise, keyword, etc.).
   */
  async render(templatePath: string, vars: Record<string, any>): Promise<string> {
    return await this.promptPort.render(templatePath, vars);
  }

  /**
   * Render only the basis section (stack + language + framework + visualTier).
   * For nodes that use render() but still need basis context (e.g., plan).
   */
  async renderBasis(
    basis: Basis | undefined,
    job: string,
    taskTechTiers?: import('@ant/shared').TechTier[],
    domain?: string,
  ): Promise<string> {
    return this.buildBasisSection(basis, job, taskTechTiers, domain);
  }

  /**
   * Build a prompt from a declarative config.
   *
   * 1. Merge injections from all 4 tiers
   * 2. Render templates (system, rules, base, injections, basis, examples)
   * 3. Optionally sanitize user-controlled input
   * 4. Return both merged output and granular sections
   */
  async build(config: PromptBuildConfig): Promise<PromptBuildResult> {
    const startTime = Date.now();
    const failedTemplates: string[] = [];

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 1: Resolve all injections
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const resolvedInjections = this.resolveInjections(config);

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

    // Defensive bridge: if config.artifacts was not passed but resolvedAction
    // already has artifacts (e.g. from explicit path), ensure documents is populated
    if (vars['resolvedAction'] && !processedArtifacts?.length) {
      const ra = vars['resolvedAction'] as Record<string, unknown>;
      const existing = (ra.artifacts as unknown[]) ?? (ra.documents as unknown[]);
      if (existing?.length && !ra.documents) {
        vars['resolvedAction'] = { ...ra, documents: existing };
      }
    }

    if (config.pipeline?.sanitizeInput) {
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

    // 3b. Basis section: root(stack) + task-scoped(lang+variant+fw)
    let basisSection = '';
    const basisPaths = new Set<string>();
    if (config.pipeline?.includeBasis && config.basis) {
      const job = this.inferJob(config);
      const domain = config.techContext?.resolvedAction?.domain;
      const taskTechTiers = config.techContext?.techTiers;
      basisSection = await this.buildBasisSection(config.basis, job, taskTechTiers, domain, basisPaths);
    } else if (config.pipeline?.includeBasis && !config.basis) {
      console.warn(`⚠️  [PromptBuilder] includeBasis=true but config.basis is ${config.basis === undefined ? 'undefined' : 'falsy'} — skipping basis section`);
    }

    // Dedup: remove paths already rendered in the basis section so injections
    // don't double-render the same template (e.g. `jobs/code/basis/techTier/framework/nextjs`
    // appears in both basisSection and AutoInjectionResolver output).
    const allInjections = resolvedInjections.filter(p => !basisPaths.has(p));

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
    if (config.pipeline?.includeExamples) {
      const job = this.inferJob(config);
      examples = await this.renderTemplate(`jobs/${job}/base/examples`, {}, failedTemplates);
    }

    // 3f. Base (user) template
    const user = await this.renderTemplate(config.templates.base, vars, failedTemplates, true);

    if (failedTemplates.length > 0) {
      console.error(`🚨 [PromptBuilder] ${failedTemplates.length} template(s) failed: ${failedTemplates.join(', ')}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 4: Assemble merged output
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const systemParts = [systemBase, basisSection, rules, injectionsMerged, examples].filter(Boolean);

    let guardrail = '';
    let policy = '';
    if (config.pipeline?.applyPolicyGuardrails) {
      const ruleset = this.getRuleset();
      const job = this.inferJob(config);
      const node = this.inferNode(config);
      guardrail = buildGuardrailSection(ruleset, job);
      policy = buildPolicySection(ruleset, job, node, config.pipeline?.strictValidation);
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
        profiles: basisSection,
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
        node: this.inferNode(config),
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

  private async buildBasisSection(
    basis: Basis | undefined,
    job: string,
    taskTechTiers?: import('@ant/shared').TechTier[],
    domain?: string,
    outPaths?: Set<string>,
  ): Promise<string> {
    if (!basis) {
      console.warn(`⚠️  [PromptBuilder.buildBasisSection] basis is undefined — returning empty`);
      return '';
    }
    const sections: string[] = [];
    console.log(`📐 [PromptBuilder.buildBasisSection] job=${job}, stack=${basis.techTier?.stack || 'none'}, fe=${basis.techTier?.frontend?.language || 'none'}/${basis.techTier?.frontend?.framework || 'none'}, visualTier=${basis.visualTier ? Object.keys(basis.visualTier).join(',') : 'none'}, taskTechTiers=${taskTechTiers?.length || 0}`);

    // Root: stack template (shared across all tasks)
    const basisStack = basis.techTier?.stack as SupportedStack | undefined;
    if (basisStack) {
      await this.pushBasisTemplate(sections, TECH_TIER_TEMPLATE_PATHS.stack(basisStack), outPaths);
    }

    // Task-scoped: language base + variant + framework (from taskTechTiers or config tiers)
    const tiers = taskTechTiers?.length
      ? taskTechTiers
      : [basis.techTier?.frontend, basis.techTier?.backend].filter(
          (t): t is import('@ant/shared').TechTier => !!t,
        );

    const injectedLangs = new Set<string>();
    const injectedVariants = new Set<string>();
    const injectedFrameworks = new Set<string>();

    for (const tier of tiers) {
      if (!tier.language) continue;
      const lang = tier.language as SupportedLanguage;
      const tierStack = tier.stack as SupportedStack | undefined;

      if (!injectedLangs.has(lang)) {
        injectedLangs.add(lang);
        const basePath = TECH_TIER_TEMPLATE_PATHS.languageBase(lang);
        if (basePath) {
          await this.pushBasisTemplate(sections, basePath, outPaths);
        }
      }

      const variants = resolveLanguageVariants(lang, tierStack);
      for (const variant of variants) {
        if (injectedVariants.has(variant)) continue;
        injectedVariants.add(variant);
        await this.tryPushBasisTemplate(
          sections,
          TECH_TIER_TEMPLATE_PATHS.jobLanguageVariant(job, variant),
          outPaths,
        );
      }

      if (tier.framework && tier.framework !== FRAMEWORK_NONE && !injectedFrameworks.has(tier.framework)) {
        injectedFrameworks.add(tier.framework);
        await this.tryPushBasisTemplate(
          sections,
          TECH_TIER_TEMPLATE_PATHS.jobFramework(job, tier.framework),
          outPaths,
        );
      }
    }

    if (domain) {
      const jobDomainPath = TECH_TIER_TEMPLATE_PATHS.jobDomain(job, domain);
      const loaded = await this.tryPushBasisTemplate(sections, jobDomainPath, outPaths);
      if (!loaded) {
        await this.pushBasisTemplate(sections, `basis/domain/${domain}`, outPaths);
      }
    }

    if (basis.visualTier?.designSystem) {
      await this.pushBasisTemplate(sections, `basis/visualTier/design-system/${basis.visualTier.designSystem}`, outPaths);
    }

    const hasVisualTierLayers = VISUAL_TIER_LAYER_KEYS.some(k => basis.visualTier?.[k]);
    if (hasVisualTierLayers) {
      const vt = basis.visualTier!;
      await this.tryPushBasisTemplate(sections, VISUAL_TIER_TEMPLATE_PATHS.preamble(), outPaths);
      for (const layer of VISUAL_TIER_LAYER_KEYS) {
        const variant = vt[layer];
        if (variant) {
          await this.pushBasisTemplate(sections, VISUAL_TIER_TEMPLATE_PATHS[layer](variant), outPaths);
        }
      }
      await this.tryPushBasisTemplate(sections, VISUAL_TIER_TEMPLATE_PATHS.jobPreamble(job), outPaths);
    }

    if (sections.length === 0) {
      console.warn(`⚠️  [PromptBuilder.buildBasisSection] All template renders resulted in 0 sections`);
    } else {
      console.log(`📐 [PromptBuilder.buildBasisSection] Loaded ${sections.length} basis section(s)`);
    }
    return sections.join('\n\n');
  }

  /** Returns true if template was found and pushed. */
  private async tryPushBasisTemplate(sections: string[], path: string, outPaths?: Set<string>): Promise<boolean> {
    try {
      const content = this.promptPort.renderRaw
        ? await this.promptPort.renderRaw(path)
        : await this.promptPort.render(path, {});
      if (content) {
        sections.push(`<basis axis="${path}">\n${content}\n</basis>`);
        outPaths?.add(path);
        return true;
      }
      return false;
    } catch { return false; }
  }

  private async pushBasisTemplate(sections: string[], path: string, outPaths?: Set<string>): Promise<void> {
    try {
      const content = this.promptPort.renderRaw
        ? await this.promptPort.renderRaw(path)
        : await this.promptPort.render(path, {});
      if (content) {
        sections.push(`<basis axis="${path}">\n${content}\n</basis>`);
        outPaths?.add(path);
      } else {
        console.warn(`⚠️  [PromptBuilder.pushBasisTemplate] Template rendered empty: ${path}`);
      }
    } catch (err) {
      console.warn(`⚠️  [PromptBuilder.pushBasisTemplate] Failed to render: ${path}`, (err as Error).message);
    }
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
   * Build the visualTier basis section independently.
   * Used by UI design docGen which assembles prompts manually (not via build()).
   */
  async buildVisualTierBasis(basis: Basis | undefined, job: string): Promise<string> {
    const hasLayers = VISUAL_TIER_LAYER_KEYS.some(k => basis?.visualTier?.[k]);
    if (!hasLayers) return '';
    const sections: string[] = [];
    const vt = basis!.visualTier!;

    await this.tryPushBasisTemplate(sections, VISUAL_TIER_TEMPLATE_PATHS.preamble());
    for (const layer of VISUAL_TIER_LAYER_KEYS) {
      const variant = vt[layer];
      if (variant) {
        await this.pushBasisTemplate(sections, VISUAL_TIER_TEMPLATE_PATHS[layer](variant));
      }
    }
    await this.tryPushBasisTemplate(sections, VISUAL_TIER_TEMPLATE_PATHS.jobPreamble(job));

    return sections.join('\n\n');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private inferJob(config: PromptBuildConfig): string {
    const parts = config.templates.base.split('/');
    if (parts[0] === 'jobs' && parts.length > 1) return parts[1];
    return parts[0] || 'code';
  }

  private inferNode(config: PromptBuildConfig): 'plan' | 'execute' {
    const basePath = config.templates.base;
    if (basePath.includes('/nodes/execute/') || basePath.includes('/execute/')) return 'execute';
    if (basePath.includes('/nodes/plan/') || basePath.includes('/plan/')) return 'plan';
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

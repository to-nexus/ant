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
import type { PolicyKey, Basis, BasisSlotConfig, Domain, TierKey, GameArtTier } from '@ant/shared';
import { getPromptPolicies, POLICY_TEMPLATE_MAP } from '@ant/shared';
import {
  resolveLanguageVariants,
  TECH_TIER_TEMPLATE_PATHS,
  FRAMEWORK_NONE,
  VISUAL_TIER_TEMPLATE_PATHS,
  VISUAL_TIER_LAYER_KEYS,
  GAME_ART_TIER_TEMPLATE_PATHS,
  GAME_ART_TIER_AXIS_KEYS,
  GAME_CONTENT_TIER_TEMPLATE_PATHS,
  TIER_KEYS,
  isTierActive,
  getEffectiveDomain,
  getConfigSlots,
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
   * Render only the basis section (stack + language + framework + visualTier
   * + gameArtTier + gameContentTier + domain). For nodes that use render() but
   * still need basis context (e.g., plan / verify / error / test-code hooks).
   *
   * Phase 1 (BC4) — `slot` is REQUIRED. Callers MUST pass
   * `getConfigSlots(intent)?.basis` so the matrix gate (`isTierActive`)
   * runs. Skipping the slot would silently inject every tier with data
   * regardless of the matrix; we removed the legacy permissive fallback
   * to keep the SSOT honoured at every callsite.
   */
  async renderBasis(
    basis: Basis | undefined,
    job: string,
    taskTechTiers: import('@ant/shared').TechTier[] | undefined,
    domain: Domain | string | undefined,
    slot: BasisSlotConfig | undefined,
  ): Promise<string> {
    return this.buildBasisSection(basis, job, taskTechTiers, domain, undefined, slot);
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

    // 3b. Basis section: tier-iterating (matrix-driven, Phase 1)
    let basisSection = '';
    const basisPaths = new Set<string>();
    if (config.pipeline?.includeBasis && config.basis) {
      const job = this.inferJob(config);
      const rac = config.techContext?.resolvedAction;
      const domain = rac?.domain;
      const taskTechTiers = config.techContext?.techTiers;
      const intent = rac?.intent;
      const slot = intent ? getConfigSlots(intent)?.basis : undefined;
      basisSection = await this.buildBasisSection(config.basis, job, taskTechTiers, domain, basisPaths, slot);
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

  /**
   * Tier-iterating basis assembly (Phase 1, D7 / BC4).
   *
   * Iterates through `TIER_KEYS` in canonical order. For each tier the
   * matrix gate (`isTierActive(tier, slot, domain, runtime)`) decides
   * whether to inject it; a per-tier dispatch then builds the section.
   *
   * BC4 — `slot` is required at every callsite. The legacy permissive
   * fallback (`!slot` ⇒ every tier active) is removed so the matrix is
   * the single authority. When `slot` is undefined we treat the call as
   * "no basis to inject" and return empty (with a loud warn), rather
   * than silently injecting every tier with data.
   */
  private async buildBasisSection(
    basis: Basis | undefined,
    job: string,
    taskTechTiers: import('@ant/shared').TechTier[] | undefined,
    domain: Domain | string | undefined,
    outPaths: Set<string> | undefined,
    slot: BasisSlotConfig | undefined,
  ): Promise<string> {
    if (!basis) {
      console.warn(`⚠️  [PromptBuilder.buildBasisSection] basis is undefined — returning empty`);
      return '';
    }
    if (!slot) {
      console.warn(
        `⚠️  [PromptBuilder.buildBasisSection] slot is undefined (job=${job}) — basis injection skipped. ` +
        `Callers MUST pass getConfigSlots(intent)?.basis so the matrix gate runs.`,
      );
      return '';
    }
    const sections: string[] = [];
    const effectiveDomain = getEffectiveDomain(domain as Domain | undefined);
    const runtime = { techTier: basis.techTier, hasUiDoc: false };

    console.log(
      `📐 [PromptBuilder.buildBasisSection] job=${job}, domain=${effectiveDomain}, ` +
      `stack=${basis.techTier?.stack || 'none'}, ` +
      `fe=${basis.techTier?.frontend?.language || 'none'}/${basis.techTier?.frontend?.framework || 'none'}, ` +
      `gameEngine=${basis.techTier?.frontend?.gameEngine ?? basis.techTier?.backend?.gameEngine ?? 'none'}, ` +
      `visualTier=${basis.visualTier ? Object.keys(basis.visualTier).join(',') : 'none'}, ` +
      `gameArtTier=${basis.gameArtTier ? Object.keys(basis.gameArtTier).join(',') : 'none'}, ` +
      `gameContentTier=${basis.gameContentTier ? Object.keys(basis.gameContentTier).join(',') : 'none'}, ` +
      `taskTechTiers=${taskTechTiers?.length || 0}`
    );

    // Phase 2 (D23) + D27 (v6): `domain` is rendered ONCE up-front,
    // independent of the tier loop, because it is the workspace selector
    // *above* the tier set (= basis). The partial-injection contract still
    // layers `templates/domain/{d}.md` (identity) and
    // `templates/jobs/{job}/domain/{d}.md` (job × domain meta-pattern overlay)
    // on top of each other. The matrix decides which tiers to inject for
    // the current intent / domain — domain itself is not a tier.
    await this.renderDomainTier(sections, basis, job, effectiveDomain, outPaths);

    for (const tier of TIER_KEYS) {
      if (!isTierActive(tier as TierKey, slot, effectiveDomain, runtime)) continue;

      switch (tier) {
        case 'techTier':
          await this.renderTechTier(sections, basis, job, taskTechTiers, effectiveDomain, outPaths);
          break;
        case 'visualTier':
          await this.renderVisualTier(sections, basis, job, outPaths);
          break;
        case 'gameArtTier':
          await this.renderGameArtTier(sections, basis, job, outPaths);
          break;
        case 'gameContentTier':
          await this.renderGameContentTier(sections, basis, job, outPaths);
          break;
      }
    }

    if (sections.length === 0) {
      console.warn(`⚠️  [PromptBuilder.buildBasisSection] All template renders resulted in 0 sections`);
    } else {
      console.log(`📐 [PromptBuilder.buildBasisSection] Loaded ${sections.length} basis section(s)`);
    }
    return sections.join('\n\n');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Per-tier render dispatchers (Phase 1)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private async renderDomainTier(
    sections: string[],
    _basis: Basis,
    job: string,
    domain: Domain,
    outPaths?: Set<string>,
  ): Promise<void> {
    // D27 (v6): both files live ABOVE basis/ to reflect that domain is a
    // workspace selector, not a tier. Order:
    //   1. templates/domain/{d}.md            — global identity (job-agnostic)
    //   2. templates/jobs/{job}/domain/{d}.md — job × domain meta-pattern
    // When both exist, both are injected: identity first, then the job
    // overlay layers job-specific guidance (e.g. plan job → GDD/PRD skeleton).
    await this.tryPushBasisTemplate(sections, TECH_TIER_TEMPLATE_PATHS.basisDomain(domain), outPaths);
    await this.tryPushBasisTemplate(sections, TECH_TIER_TEMPLATE_PATHS.jobDomain(job, domain), outPaths);
  }

  private async renderTechTier(
    sections: string[],
    basis: Basis,
    job: string,
    taskTechTiers: import('@ant/shared').TechTier[] | undefined,
    domain: Domain,
    outPaths?: Set<string>,
  ): Promise<void> {
    const basisStack = basis.techTier?.stack as SupportedStack | undefined;
    if (basisStack) {
      await this.pushBasisTemplate(sections, TECH_TIER_TEMPLATE_PATHS.stack(basisStack), outPaths);
    }

    const tiers = taskTechTiers?.length
      ? taskTechTiers
      : [basis.techTier?.frontend, basis.techTier?.backend].filter(
          (t): t is import('@ant/shared').TechTier => !!t,
        );

    const injectedLangs = new Set<string>();
    const injectedVariants = new Set<string>();
    const injectedFrameworks = new Set<string>();
    const injectedEngines = new Set<string>();
    let preambleEmitted = false;

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

      // Phase 1: gameEngine 5th slot. Only inject for game domain (the
      // matrix already gated us in here, but we double-check the slot is
      // populated). `react+phaser` ⇒ both framework=react AND gameEngine
      // partials are emitted, by design.
      if (domain === 'game' && tier.gameEngine && !injectedEngines.has(tier.gameEngine)) {
        injectedEngines.add(tier.gameEngine);
        if (!preambleEmitted) {
          preambleEmitted = true;
          await this.tryPushBasisTemplate(sections, TECH_TIER_TEMPLATE_PATHS.gameEnginePreamble(), outPaths);
        }
        await this.tryPushBasisTemplate(sections, TECH_TIER_TEMPLATE_PATHS.gameEngine(tier.gameEngine), outPaths);
        await this.tryPushBasisTemplate(sections, TECH_TIER_TEMPLATE_PATHS.jobGameEngine(job, tier.gameEngine), outPaths);
      }
    }
  }

  private async renderVisualTier(
    sections: string[],
    basis: Basis,
    job: string,
    outPaths?: Set<string>,
  ): Promise<void> {
    if (basis.visualTier?.designSystem) {
      await this.pushBasisTemplate(sections, `basis/visualTier/design-system/${basis.visualTier.designSystem}`, outPaths);
    }
    const hasVisualTierLayers = VISUAL_TIER_LAYER_KEYS.some(k => basis.visualTier?.[k]);
    if (!hasVisualTierLayers) return;
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

  private async renderGameArtTier(
    sections: string[],
    basis: Basis,
    job: string,
    outPaths?: Set<string>,
  ): Promise<void> {
    const gat = basis.gameArtTier;
    if (!gat) return;
    const hasAnyAxis = GAME_ART_TIER_AXIS_KEYS.some(k => gat[k as keyof GameArtTier]);
    if (!hasAnyAxis) return;
    await this.tryPushBasisTemplate(sections, GAME_ART_TIER_TEMPLATE_PATHS.preamble(), outPaths);
    for (const axis of GAME_ART_TIER_AXIS_KEYS) {
      const value = gat[axis as keyof GameArtTier];
      if (!value) continue;
      const pathFn = GAME_ART_TIER_TEMPLATE_PATHS[axis as keyof typeof GAME_ART_TIER_TEMPLATE_PATHS];
      if (typeof pathFn === 'function') {
        await this.tryPushBasisTemplate(sections, (pathFn as (v: string) => string)(value as string), outPaths);
      }
    }
    await this.tryPushBasisTemplate(sections, GAME_ART_TIER_TEMPLATE_PATHS.jobPreamble(job), outPaths);
  }

  private async renderGameContentTier(
    sections: string[],
    basis: Basis,
    job: string,
    outPaths?: Set<string>,
  ): Promise<void> {
    const gct = basis.gameContentTier;
    if (!gct) return;
    const hasAnyAxis = !!(gct.genre || gct.coreLoop);
    if (!hasAnyAxis) return;
    await this.tryPushBasisTemplate(sections, GAME_CONTENT_TIER_TEMPLATE_PATHS.preamble(), outPaths);
    if (gct.genre) {
      await this.tryPushBasisTemplate(sections, GAME_CONTENT_TIER_TEMPLATE_PATHS.genre(gct.genre), outPaths);
    }
    if (gct.coreLoop) {
      await this.tryPushBasisTemplate(sections, GAME_CONTENT_TIER_TEMPLATE_PATHS.coreLoop(gct.coreLoop), outPaths);
    }
    await this.tryPushBasisTemplate(sections, GAME_CONTENT_TIER_TEMPLATE_PATHS.jobPreamble(job), outPaths);
  }

  /**
   * Returns true if template was found and pushed.
   *
   * Uses `render(path, {})` so Handlebars partial references inside basis
   * templates expand. Basis files are static markdown with no
   * `{{variable}}` bindings, so passing an empty var map is safe.
   */
  private async tryPushBasisTemplate(sections: string[], path: string, outPaths?: Set<string>): Promise<boolean> {
    try {
      const content = await this.promptPort.render(path, {});
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
      const content = await this.promptPort.render(path, {});
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

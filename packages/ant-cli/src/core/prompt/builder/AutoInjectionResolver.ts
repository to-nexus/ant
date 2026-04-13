/**
 * AutoInjectionResolver — Tier A + Tier D injection resolution.
 *
 * Extracted from PromptResolver.selectInjections().
 * Determines which injection templates to include based on:
 *   Tier A: techTier, taskType, mode, job, phase (static tech/workflow context)
 *   Tier D: data-presence flags (directive, memory, git-diff, etc.)
 *
 * Does NOT handle Tier I (intent policies) or Tier N (artifact-conditional policies).
 * Those are resolved by PromptBuilder via prompt-policy-matrix and ArtifactRoleResolver.
 */

import type { ResolvedActionContext, TechTier, Mode } from '@ant/shared';

// ============================================
// Input Types
// ============================================

export interface AutoInjectionInput {
  job: string;
  phase: 'plan' | 'execute';
  taskType?: string;
  mode?: Mode;
  resolvedAction?: ResolvedActionContext;

  /** Tech tiers (per-task or graph-level). */
  techTiers?: TechTier[];
  techTier?: TechTier;

  /** Data presence signals (Tier D). */
  data: {
    hasDirective?: boolean;
    hasMemory?: boolean;
    hasGitDiff?: boolean;
    hasRetrievedCode?: boolean;
    hasReferenceCode?: boolean;
    hasProjectCode?: boolean;
    hasRetryContext?: boolean;
    hasLessons?: boolean;
    hasSessionContext?: boolean;
    hasMissingDependency?: boolean;
    hasRuntimeError?: boolean;
  };
}

// ============================================
// AutoInjectionResolver
// ============================================

export class AutoInjectionResolver {
  /**
   * Resolve all Tier A + Tier D injections.
   * Returns an ordered, deduplicated list of injection template paths.
   */
  resolve(input: AutoInjectionInput): string[] {
    const injections: string[] = [];
    const { job, phase, taskType, mode, resolvedAction, data } = input;

    const tiers = input.techTiers ?? (input.techTier ? [input.techTier] : []);
    const stacks = new Set(tiers.map(t => t.stack).filter(Boolean));
    const hasFrontend = stacks.size === 0 || stacks.has('frontend') || stacks.has('fullstack');
    const hasBackend = stacks.has('backend') || stacks.has('fullstack');

    const isVerification = taskType === 'verification';
    const isError = taskType === 'error';
    const isTestCode = taskType === 'test-code';
    const isDoc = taskType === 'doc';
    const skipStaticPolicy = isVerification || isTestCode || isDoc;

    const commonPrefix = 'common/injections';
    const jobPrefix = `${job}/base/injections`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Tier D: Data Presence
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (data.hasDirective) {
      injections.push(`${commonPrefix}/directive`);
    }
    if (data.hasMemory) {
      injections.push(`${commonPrefix}/memory`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Tier A: visual-source-authority (frontend static policy)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!skipStaticPolicy && hasFrontend) {
      injections.push(`${commonPrefix}/visual-source-authority`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Tier A: Setup task constraints
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (taskType === 'setup') {
      const language = this.resolveLanguage(tiers);
      if (language) {
        injections.push(`${job}/phases/execute/languages/${language}/setup/constraints`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Code job: data-presence injections (Tier D)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (job === 'code') {
      if (data.hasGitDiff) injections.push(`${jobPrefix}/git-diff`);
      if (data.hasRetrievedCode) injections.push(`${jobPrefix}/retrieved-code`);
      if (data.hasReferenceCode) injections.push(`${jobPrefix}/reference-code`);

      const isRefactor = mode === 'refactor' || (data.hasProjectCode && taskType === 'error');
      const isExplicit = resolvedAction?.source === 'explicit';
      if ((isExplicit && resolvedAction?.mode === 'refactor') || isRefactor) {
        injections.push(`${jobPrefix}/behavioral-debugging`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Phase: execute
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (phase === 'execute') {
      const language = this.resolveLanguage(tiers);
      const skipEnvRules = isVerification || isError || isTestCode || isDoc;

      if (!skipEnvRules && language && job === 'code') {
        this.addEnvironmentInjections(injections, job, tiers, language, hasFrontend, hasBackend);

        if (hasFrontend) {
          this.pushUnique(injections, `${jobPrefix}/preview-setup`);
        }
        this.pushUnique(injections, `${jobPrefix}/tool-calling-rules-compact`);
      }

      if (isError && hasFrontend) {
        this.pushUnique(injections, `${jobPrefix}/preview-setup`);
      }

      if (isTestCode && language && job === 'code') {
        injections.push(`${job}/phases/execute/tasks/test-code/languages/${language}/hints`);
      }

      if (job === 'code' && !isVerification && !isDoc && hasBackend) {
        injections.push('code/phases/execute/injections/backend-safety');
      }

      if (job === 'code' && !isTestCode && !isDoc) {
        this.pushUnique(injections, `${jobPrefix}/preview-env-contract`);
        injections.push('code/phases/execute/injections/port-management');
      }

      // Design job injections
      if (job === 'design') {
        injections.push('design/base/injections/document-language');
      }

      // Tier D: execute-phase data-presence
      if (data.hasRetryContext) injections.push('code/phases/execute/injections/retry-context');
      if (data.hasLessons) injections.push('code/phases/execute/injections/lessons');
      if (data.hasSessionContext) injections.push('code/phases/execute/injections/session-context');
      if (data.hasMissingDependency && language && job === 'code') {
        injections.push('code/phases/execute/injections/missing-dependency-fix');
      }
      if (data.hasRuntimeError) {
        injections.push('code/phases/execute/injections/runtime-error-fix');
      }

      if (!data.hasProjectCode && job === 'code' && taskType === 'setup' && language) {
        injections.push(`${job}/phases/execute/languages/${language}/setup/config`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RAC-driven injections
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (resolvedAction) {
      injections.push('common/injections/action-context');
      if (resolvedAction.mode === 'refactor') {
        injections.push('common/injections/refactor-guidance');
      }
      if (resolvedAction.mode === 'explain') {
        injections.push('common/injections/explain-guidance');
      }
    }

    return this.deduplicate(injections);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Private helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private addEnvironmentInjections(
    injections: string[],
    job: string,
    tiers: TechTier[],
    fallbackLanguage: string,
    hasFrontend: boolean,
    hasBackend: boolean,
  ): void {
    if (tiers.length === 0) {
      const envPath = `${job}/phases/execute/languages/${fallbackLanguage}/environments/browser/rules`;
      this.pushUnique(injections, envPath);
      return;
    }

    for (const tier of tiers) {
      const lang = tier.language ?? 'typescript';
      if (tier.stack === 'fullstack') {
        this.pushUnique(injections, `${job}/phases/execute/languages/${lang}/environments/browser/rules`);
        const backendEnv = lang === 'go' ? 'go-api' : 'node-api';
        this.pushUnique(injections, `${job}/phases/execute/languages/${lang}/environments/${backendEnv}/rules`);
      } else {
        const env = tier.stack === 'frontend' ? 'browser'
          : tier.stack === 'backend' ? (lang === 'go' ? 'go-api' : 'node-api')
          : 'browser';
        this.pushUnique(injections, `${job}/phases/execute/languages/${lang}/environments/${env}/rules`);
      }
    }

    if (hasFrontend && hasBackend) {
      const primaryLang = tiers[0]?.language ?? 'typescript';
      this.pushUnique(injections, `${job}/phases/execute/languages/${primaryLang}/environments/fullstack/rules`);
    }
  }

  private resolveLanguage(tiers: TechTier[]): string {
    const lang = tiers[0]?.language;
    if (lang) return lang;
    return 'typescript';
  }

  private pushUnique(arr: string[], value: string): void {
    if (!arr.includes(value)) arr.push(value);
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

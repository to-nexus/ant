/**
 * AutoInjectionResolver — Tier A + Tier D injection resolution.
 *
 * Determines which injection templates to include based on:
 *   Tier A: techTier, taskType, mode, job, node (static tech/workflow context)
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
  node: 'plan' | 'execute';
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
    const { job, node, taskType, mode, resolvedAction, data } = input;

    const tiers = input.techTiers ?? (input.techTier ? [input.techTier] : []);
    const stacks = new Set(tiers.map(t => t.stack).filter(Boolean));
    const hasFrontend = stacks.size === 0 || stacks.has('frontend') || stacks.has('fullstack');
    const hasBackend = stacks.has('backend') || stacks.has('fullstack');

    const isVerification = taskType === 'verification';
    const isError = taskType === 'error';
    const isTestCode = taskType === 'test-code';
    const isDoc = taskType === 'doc';
    const skipStaticPolicy = isVerification || isTestCode || isDoc;

    const commonPrefix = 'jobs/shared/injections';
    const jobPrefix = `jobs/${job}/base/injections`;

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
    // Tier A: Setup task constraints (code job only)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (taskType === 'setup' && job === 'code') {
      const language = this.resolveLanguage(tiers);
      if (language) {
        injections.push(`jobs/${job}/nodes/execute/basis/techTier/${language}/setup/constraints`);
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
    // Node: execute
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (node === 'execute') {
      const language = this.resolveLanguage(tiers);
      const skipEnvRules = isVerification || isError || isTestCode || isDoc;

      if (!skipEnvRules && language && job === 'code') {
        this.addEnvironmentInjections(injections, job, tiers, language, hasFrontend, hasBackend);

        if (hasFrontend) {
          this.pushUnique(injections, `${jobPrefix}/preview-setup`);
        }
        this.pushUnique(injections, `${jobPrefix}/tool-calling-rules-compact`);
      }

      if (isError && hasFrontend && job === 'code') {
        this.pushUnique(injections, `${jobPrefix}/preview-setup`);
      }

      if (isTestCode && language && job === 'code') {
        injections.push(`jobs/${job}/nodes/execute/variants/test-code/basis/techTier/${language}/hints`);
      }

      if (job === 'code' && !isVerification && !isDoc && hasBackend) {
        injections.push('jobs/code/nodes/execute/injections/backend-safety');
      }

      if (job === 'code' && !isTestCode && !isDoc) {
        this.pushUnique(injections, `${jobPrefix}/preview-env-contract`);
        injections.push('jobs/code/nodes/execute/injections/port-management');
      }

      // Design job injections
      if (job === 'design') {
        injections.push('jobs/design/base/injections/document-language');
      }

      // Tier D: execute-node data-presence
      if (data.hasRetryContext) injections.push('jobs/code/nodes/execute/injections/retry-context');
      if (data.hasLessons) injections.push('jobs/code/nodes/execute/injections/lessons');
      if (data.hasSessionContext) injections.push('jobs/code/nodes/execute/injections/session-context');
      if (data.hasMissingDependency && language && job === 'code') {
        injections.push('jobs/code/nodes/execute/injections/missing-dependency-fix');
      }
      if (data.hasRuntimeError) {
        injections.push('jobs/code/nodes/execute/injections/runtime-error-fix');
      }

      if (!data.hasProjectCode && job === 'code' && taskType === 'setup' && language) {
        injections.push(`jobs/${job}/nodes/execute/basis/techTier/${language}/setup/config`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RAC-driven injections
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (resolvedAction) {
      injections.push('jobs/shared/injections/action-context');
      if (resolvedAction.mode === 'refactor') {
        injections.push('jobs/shared/injections/refactor-guidance');
      }
      if (resolvedAction.mode === 'explain') {
        injections.push('jobs/shared/injections/explain-guidance');
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
    const base = `jobs/${job}/nodes/execute/basis/techTier`;

    if (tiers.length === 0) {
      // Go has no browser environment rules; only TypeScript does
      if (fallbackLanguage !== 'go') {
        this.pushUnique(injections, `${base}/${fallbackLanguage}/environments/browser/rules`);
      }
      return;
    }

    for (const tier of tiers) {
      const lang = tier.language ?? 'typescript';
      if (tier.stack === 'fullstack') {
        if (lang !== 'go') {
          this.pushUnique(injections, `${base}/${lang}/environments/browser/rules`);
        }
        const backendEnv = lang === 'go' ? 'go-api' : 'node-api';
        this.pushUnique(injections, `${base}/${lang}/environments/${backendEnv}/rules`);
      } else {
        const env = tier.stack === 'frontend'
          ? (lang === 'go' ? null : 'browser')
          : tier.stack === 'backend' ? (lang === 'go' ? 'go-api' : 'node-api')
          : (lang === 'go' ? null : 'browser');
        if (env) {
          this.pushUnique(injections, `${base}/${lang}/environments/${env}/rules`);
        }
      }
    }

    if (hasFrontend && hasBackend) {
      const primaryLang = tiers[0]?.language ?? 'typescript';
      if (primaryLang !== 'go') {
        this.pushUnique(injections, `${base}/${primaryLang}/environments/fullstack/rules`);
      }
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

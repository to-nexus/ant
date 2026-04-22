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
    // Tier A: Blind-spot hints (basis/techTier — Hints 계층)
    // SSOT for `jobs/{job}/basis/techTier/{language,framework}/...` injection.
    // See docs/architecture/13-prompt-system.md "Hints 계층".
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (job === 'code' || job === 'design') {
      for (const path of this.resolveTechTierInjections(job as 'code' | 'design', tiers, taskType)) {
        injections.push(path);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Code job: refactor behavioural-debugging guard
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (job === 'code') {
      const isRefactor = mode === 'refactor' || taskType === 'error';
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
        if (hasFrontend) {
          this.pushUnique(injections, `${jobPrefix}/preview-setup`);
        }
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

      // UI interpretation partial — dispatched per UiSource (ant / figma / handoff).
      // Injected for BOTH 'ui' and 'design-system' task types because a
      // design-system skeleton task needs the same per-source reading rules
      // as an individual ui task. The dispatcher itself is a no-op when the
      // `uiSource` template variable is null.
      if (job === 'code' && (taskType === 'ui' || taskType === 'design-system')) {
        injections.push(`${jobPrefix}/ui-source-dispatch`);
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

      // Setup task = new project definition = no existing code. Inject the
      // language-specific setup/config partial to seed the first build.
      if (job === 'code' && taskType === 'setup' && language) {
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

  private resolveLanguage(tiers: TechTier[]): string {
    const lang = tiers[0]?.language;
    if (lang) return lang;
    return 'typescript';
  }

  /**
   * Hints-layer language mapping (SSOT for `jobs/{job}/basis/techTier/language/*`).
   *
   * Returns null instead of falling back to avoid injecting the wrong file.
   * The allowed filename set is:
   *   code: typescript-node | typescript-browser | go
   *   design: (same set; contents curated separately)
   *
   * Intentionally stricter than `resolveLanguage` which uses a 'typescript' fallback.
   */
  private resolveTechTierLanguage(tiers: TechTier[]): string | null {
    const tier = tiers[0];
    if (!tier?.language) return null;
    const lang = tier.language;
    const stack = tier.stack;
    if (lang === 'go') return 'go';
    if (lang === 'typescript') {
      if (stack === 'backend') return 'typescript-node';
      if (stack === 'frontend' || stack === 'fullstack') return 'typescript-browser';
      return null;
    }
    return null;
  }

  /**
   * Hints-layer framework mapping (SSOT for `jobs/{job}/basis/techTier/framework/*`).
   *
   * Returns null instead of falling back. Allowed sets are hardcoded per job
   * to prevent silent injection of a file that does not exist on disk.
   */
  private resolveTechTierFramework(tiers: TechTier[], job: 'code' | 'design'): string | null {
    const fw = tiers[0]?.framework?.toLowerCase();
    if (!fw) return null;
    const allowed = job === 'code'
      ? ['nextjs', 'react', 'react-native', 'nestjs', 'gin']
      : ['nextjs', 'go'];
    if (allowed.includes(fw)) return fw;
    if (fw.includes('next')) return 'nextjs';
    return null;
  }

  /**
   * Hints-layer SSOT. Returns the list of injection paths for the given
   * (job, tiers, taskType). Exposed as the public surface so that callers
   * outside PromptBuilder (e.g. design docGen logging) reuse the same
   * decision logic instead of duplicating the framework/language mapping.
   *
   * Code job scope: `taskType ∈ {verification, error, ui, feature, setup}`.
   * Blind-spot hints are prevention knowledge (forbidden patterns, version
   * boundaries) — they must reach the LLM at WRITE time (feature/setup) too,
   * not only at diagnosis time (verification/error). Hints complement, rather
   * than duplicate, the dedicated `setup/config` injection. `test-code` and
   * `doc` task types remain excluded — the framework blind-spot catalog is
   * not relevant to test scaffolding or documentation authoring.
   *
   * Design job scope: all task types when language/framework are detectable.
   */
  resolveTechTierInjections(
    job: 'code' | 'design',
    tiers: TechTier[],
    taskType: string | undefined,
  ): string[] {
    const paths: string[] = [];
    const framework = this.resolveTechTierFramework(tiers, job);
    const language = this.resolveTechTierLanguage(tiers);

    if (job === 'code') {
      const injectable = ['verification', 'error', 'ui', 'feature', 'setup'].includes(taskType ?? '');
      if (!injectable) return paths;
      if (framework) paths.push(`jobs/code/basis/techTier/framework/${framework}`);
      if (language) paths.push(`jobs/code/basis/techTier/language/${language}`);
      return paths;
    }

    if (job === 'design') {
      // Design job currently has framework files only (nextjs, go).
      // `framework/go.md` is named after the language because the historical
      // entry was "Go API backend" rather than a specific Go web framework —
      // accept `language === 'go' && stack === 'backend'` as a synonym so
      // callers (e.g. text-search fallback producing a pseudo-techTier with
      // just `language: 'go'`) resolve to the same file.
      if (framework) {
        paths.push(`jobs/design/basis/techTier/framework/${framework}`);
      } else {
        const tier = tiers[0];
        if (tier?.language === 'go' && tier?.stack === 'backend') {
          paths.push('jobs/design/basis/techTier/framework/go');
        }
      }
      return paths;
    }

    return paths;
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

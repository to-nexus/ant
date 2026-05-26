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
import { deriveCodebaseRole } from '@ant/shared';

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
    /**
     * Codebase Channel SSOT — workspace contains an existing codebase
     * (disk walk OR memory index). Combined with the intent it derives
     * `codebaseRole` ('ref' / 'context') and conditionally injects the
     * `codebase-channel` partial.
     */
    hasCodebase?: boolean;
  };
}

// ============================================
// AutoInjectionResolver
// ============================================

export class AutoInjectionResolver {
  /**
   * Compute frontend/backend presence flags from a tier set.
   *
   * SSOT for `hasFrontend` / `hasBackend` semantics — used by the resolver
   * itself for execute-side gating AND by plan-node call sites that pass
   * the same flags down to Handlebars templates as `{{#if hasFrontend}}`
   * guards on partial inclusions (see `plan/base.md`'s `preview-setup`
   * include). Keeping the predicate here prevents drift between the
   * resolver's gate and the template's gate.
   */
  static computeStackFlags(
    techTiers?: TechTier[],
    techTier?: TechTier,
  ): { hasFrontend: boolean; hasBackend: boolean } {
    const tiers = techTiers?.length ? techTiers : (techTier ? [techTier] : []);
    const stacks = new Set(tiers.map(t => t.stack).filter(Boolean));
    const hasFrontend = stacks.size === 0 || stacks.has('frontend') || stacks.has('fullstack');
    const hasBackend = stacks.has('backend') || stacks.has('fullstack');
    return { hasFrontend, hasBackend };
  }

  /**
   * Resolve all Tier A + Tier D injections.
   * Returns an ordered, deduplicated list of injection template paths.
   */
  resolve(input: AutoInjectionInput): string[] {
    const injections: string[] = [];
    const { job, node, taskType, mode, resolvedAction, data } = input;

    const tiers = input.techTiers ?? (input.techTier ? [input.techTier] : []);
    const { hasFrontend, hasBackend } = AutoInjectionResolver.computeStackFlags(
      input.techTiers,
      input.techTier,
    );

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

      // UI / Game-art interpretation partial — D28 vertical domain split.
      //   service domain → ui-source-dispatch (per UiSource: ant / figma / handoff)
      //   game domain    → game-art-source (single flat partial, D24)
      //
      // Injected for BOTH 'ui' and 'design-system' task types because a
      // design-system skeleton task needs the same per-source reading rules
      // as an individual ui task. The ui-source-dispatch partial itself is
      // a no-op when the `uiSource` template variable is null.
      //
      // Routing the domain branch HERE keeps `ui-source-dispatch.md` free of
      // domain conditionals — a Domain-Branching Locality (I1) requirement.
      if (job === 'code' && (taskType === 'ui' || taskType === 'design-system')) {
        const domain = resolvedAction?.domain;
        if (domain === 'game') {
          injections.push(`${jobPrefix}/game-art-source`);
        } else {
          injections.push(`${jobPrefix}/ui-source-dispatch`);
        }
      }

      // Design job injections
      if (job === 'design') {
        injections.push('jobs/design/base/injections/document-language');
      }

      // Code job response-language — mirrors design's document-language.
      // Self-gated partial (`{{#unless (eq userLanguage "en")}}`) renders
      // nothing when the user's language is English. Carries the policy
      // for user-facing text (task names, descriptions, plan rationale,
      // batch labels, chat replies, code comments) vs. code identifiers
      // (which stay English by universal coding convention).
      if (job === 'code') {
        injections.push('jobs/code/base/injections/response-language');
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
    // Codebase Channel SSOT — single partial gates on `codebaseRole`
    // ('ref' for code-anchored intents, 'context' for plan/design in
    // existing-project workspaces). Injected once across all jobs/nodes
    // — partial self-gates so greenfield workspaces emit nothing.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const codebaseRole = deriveCodebaseRole(
      resolvedAction?.intent,
      { hasCodebase: data.hasCodebase },
    );
    if (codebaseRole) {
      injections.push(`${commonPrefix}/codebase-channel`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RAC-driven injections
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (resolvedAction) {
      // Normalize `resolvedAction.documents` entries so the `action-context`
      // partial — which references `{label, path, content}` inside an
      // `{{#each resolvedAction.documents}}` block — does not trip the
      // FilePromptAdapter `missingVars` validator. The validator checks
      // template variables against top-level `vars` membership and is
      // unaware of `#each` block scopes, so absent keys on document entries
      // surface as spurious "missing variables" warnings.
      //
      // When `documents` is undefined the partial's outer
      // `{{#if resolvedAction.documents}}` short-circuits and no warning
      // fires — so we only normalize when the array exists. Mutating
      // in-place keeps callers' references stable; filling with empty
      // strings is safe because the partial's inner conditionals
      // (`{{#if (eq role "ref")}}` etc.) treat them as falsy.
      const docs = (resolvedAction as { documents?: Array<Record<string, unknown>> }).documents;
      if (Array.isArray(docs)) {
        for (const entry of docs) {
          if (entry && typeof entry === 'object') {
            if (entry.label === undefined || entry.label === null) entry.label = '';
            if (entry.path === undefined || entry.path === null) entry.path = '';
            if (entry.content === undefined || entry.content === null) entry.content = '';
          }
        }
      }

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
   * Code job scope: `taskType ∈ {verification, error, ui, feature, setup,
   * test-code}`. Blind-spot hints are prevention knowledge (forbidden
   * patterns, version boundaries, toolchain compatibility) — they must
   * reach the LLM at WRITE time (feature / setup / test-code) as well as
   * diagnosis time (verification / error). `test-code` was previously
   * excluded on the assumption that "test scaffolding does not need
   * framework hints"; in practice test configuration (Jest ↔ SWC/Babel,
   * jsdom versions, `"type": "module"` interactions) is one of the most
   * framework-sensitive surfaces in a code job, so the hints now reach it
   * as well. Hints complement, rather than duplicate, the dedicated
   * `setup/config` injection. `doc` and `explain` remain excluded — they
   * do not generate buildable code.
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
      const injectable = ['verification', 'error', 'ui', 'feature', 'setup', 'test-code'].includes(taskType ?? '');
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

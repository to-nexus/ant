/**
 * PromptBuildConfig — Declarative prompt build specification.
 *
 * Callers describe WHAT to build; PromptBuilder decides HOW.
 * Replaces the implicit coupling between PromptEngine's 6-layer pipeline
 * and the many ad-hoc caller sites.
 *
 * Injection resolution follows 4 independent tiers:
 *   Tier I: Intent          → prompt-policy-matrix[intent].policies
 *   Tier A: Auto (tech)     → AutoInjectionResolver (techTier, taskType, mode)
 *   Tier D: Data presence   → data fields on vars/techContext
 *   Tier N: Artifact-cond   → deriveArtifactPolicies() from config-matrix slots
 */

import type {
  IntentId,
  ResolvedActionContext,
  ResolvedArtifact,
  TechTier,
  PolicyKey,
} from '@ant/shared';
import type { Mode } from '@ant/shared';

// ============================================
// PromptBuildConfig
// ============================================

export interface PromptBuildConfig {
  /** Template paths (relative to templates/ root, no .md extension). */
  templates: {
    base: string;
    rules?: string;
    system?: string;
  };

  /** Tier I: intent determines static policies. */
  intent?: IntentId;

  /** Tier N: pre-computed artifact-conditional policies (from deriveArtifactPolicies). */
  artifactPolicies?: PolicyKey[];

  /**
   * Tier A + D input signals — consumed by the engine to resolve auto-injections.
   * Separated from `vars` because these drive injection decisions, not template rendering.
   */
  techContext?: {
    techTier?: TechTier;
    techTiers?: TechTier[];
    taskType?: string;
    mode?: Mode;
    resolvedAction?: ResolvedActionContext;
  };

  /** Pipeline feature flags. Omitted flags default to false. */
  pipeline: {
    sanitizeInput?: boolean;
    includeTechProfile?: boolean;
    includeExamples?: boolean;
    applyPolicyGuardrails?: boolean;
    strictValidation?: boolean;
    formatForLLM?: boolean;
  };

  /** Template variables — consumed by Handlebars rendering. */
  vars: Record<string, unknown>;

  /** Role-labeled artifacts for prompt content. */
  artifacts?: ResolvedArtifact[];
}

// ============================================
// LLM Message Types (migrated from PromptFormatter)
// ============================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FormattedPrompt {
  messages: LLMMessage[];
  parameters: {
    temperature: number;
    maxTokens?: number;
    topP?: number;
    stopSequences?: string[];
  };
  metadata: {
    job: string;
    phase: string;
    mode?: string;
    timestamp: string;
  };
}

// ============================================
// PromptBuildResult
// ============================================

export interface PromptBuildResult {
  /** Rendered system prompt (all sections merged). */
  system: string;
  /** Rendered user prompt (base template). */
  user: string;

  /**
   * Granular sections — for callers that need cache-block-level control
   * (e.g., Anthropic prompt caching splits system into static vs. dynamic blocks).
   */
  sections: {
    /** System template (rarely changes). */
    systemBase: string;
    /** Rules template. */
    rules: string;
    /** All injections merged. */
    injections: string;
    /** Tech profile section (if includeTechProfile). */
    profiles: string;
    /** Examples section (if includeExamples). */
    examples: string;
    /** Guardrail section (when applyPolicyGuardrails). Prepended to system. */
    guardrail: string;
    /** Policy section (when applyPolicyGuardrails). Appended to system. */
    policy: string;
    /** Templates that failed to render (for diagnostics). */
    failedTemplates: string[];
  };

  /** All injection template paths that were applied. */
  injections: string[];
  /** Build duration in ms. */
  buildTimeMs: number;

  /** Populated when pipeline.formatForLLM is true. */
  formatted?: FormattedPrompt;
}

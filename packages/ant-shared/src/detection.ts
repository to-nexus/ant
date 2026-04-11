/**
 * Detection Types
 * 
 * Two-layer hierarchy:
 *   DetectionSummary — FE-facing minimal type (Chat UI display)
 *   DetectionReport  — extends DetectionSummary with BE-specific fields
 * 
 * Both layers live in @ant/shared so rac.ts can reference DetectionReport.
 * FE should only import DetectionSummary; DetectionReport is conceptually BE-only.
 */

/** Universal mode — shared vocabulary across all jobs */
export type Mode = 'generate' | 'refactor' | 'explain';

/** @deprecated Use Mode instead */
export type JobMode = Mode;

/** Execution environment */
export type JobEnvironment = 'frontend' | 'backend' | 'fullstack' | 'unknown';

/** Intent group — universal job identity enum */
export type IntentGroup =
  | 'plan'
  | 'design-system'
  | 'design-ui'
  | 'design-spec'
  | 'code'
  | 'visual'
  | 'learn-codebase'
  | 'ask';

/** @deprecated Use IntentGroup instead */
export type DesignWorkType = 'ui-design' | 'system-design' | 'spec';

/** Domain (System Design only) */
export type DesignDomain = 'game' | 'service';

/** Project profile (Code Job only) */
export interface ProjectProfile {
  language: string;
  framework?: string;
}

/** @deprecated Use string literal for sourceJob instead */
export type JobSource = 'code' | 'design';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectionSummary — FE-facing minimal type
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DetectionSummary {
  detectedMode: Mode;
  detectedModeReasoning: string;
  intentId?: string;
  detectedIntentGroup?: IntentGroup;
  environment?: JobEnvironment;
  domain?: DesignDomain;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectionReport — full report with BE-specific fields
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DetectionReport extends DetectionSummary {
  /** @deprecated Use detectedMode */
  jobMode?: Mode;
  /** @deprecated Use detectedModeReasoning */
  jobModeReasoning?: string;
  environmentReasoning?: string;

  // Design Job
  detectedIntentGroupReasoning?: string;
  domainReasoning?: string;
  targetFiles?: string[];

  // Code Job
  profile?: ProjectProfile;

  // Meta (string, not restricted to 'code'|'design')
  sourceJob: string;
  detectedAt?: string;
}

/**
 * Detection Types
 * 
 * Environment/mode detection results shared between BE and FE.
 * Type definitions only - factory functions and formatters stay in each package.
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

/** Job source type */
export type JobSource = 'code' | 'design';

/** Unified detection result (Code Job & Design Job) */
export interface DetectionReport {
  // Common (Code & Design)
  detectedMode: Mode;
  detectedModeReasoning: string;
  /** @deprecated Use detectedMode */
  jobMode?: Mode;
  /** @deprecated Use detectedModeReasoning */
  jobModeReasoning?: string;
  environment?: JobEnvironment;
  environmentReasoning?: string;

  // Design Job only
  detectedIntentGroup?: IntentGroup;
  detectedIntentGroupReasoning?: string;
  domain?: DesignDomain;
  domainReasoning?: string;
  targetFiles?: string[];

  // Code Job only
  profile?: ProjectProfile;
  requireRag?: boolean;
  /** Primary document sources identified by detectEnvironment LLM analysis */
  primarySources?: string[];
  primarySourcesReasoning?: string;

  // Meta
  sourceJob: JobSource;
  detectedAt?: string;
}

/**
 * Detection Types
 * 
 * Environment/mode detection results shared between BE and FE.
 * Type definitions only - factory functions and formatters stay in each package.
 */

/** Job execution mode */
export type JobMode = 'generate' | 'refactor' | 'explain';

/** Execution environment */
export type JobEnvironment = 'frontend' | 'backend' | 'fullstack' | 'unknown';

/** Design work type (Design Job only) */
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
  jobMode: JobMode;
  jobModeReasoning: string;
  environment?: JobEnvironment;
  environmentReasoning?: string;

  // Design Job only
  workType?: DesignWorkType;
  workTypeReasoning?: string;
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

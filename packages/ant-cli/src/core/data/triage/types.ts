/**
 * Triage Data Types
 * 
 * Defines the structure of job definition YAML files.
 * All text is in English - LLM handles translation to user's language.
 */

// Prerequisite condition types
export type PrerequisiteType =
  | 'file_with_content'
  | 'file_exists'
  | 'directory_with_files'
  | 'has_directive'
  | 'has_git_repository'
  | 'indexed_codebase'
  | 'figma_config'
  | 'any_of';

export interface PrerequisiteCondition {
  id?: string;
  type: PrerequisiteType;
  path?: string;
  description: string;  // Direct text, no i18n key
  items?: PrerequisiteCondition[];
}

export interface Prerequisites {
  required: PrerequisiteCondition[];
  recommended: PrerequisiteCondition[];
}

// Detection conditions for mode selection
export interface DetectionCondition {
  any_of?: DetectionItem[];
  all_of?: DetectionItem[];
  none_of?: DetectionItem[];
}

export interface DetectionItem {
  path?: string;
  type?: string;
  any_of?: DetectionItem[];
  all_of?: DetectionItem[];
  none_of?: DetectionItem[];
}

export interface JobModeOutput {
  name: string;
  description: string;
}

export interface JobMode {
  id: string;
  description: string;  // Direct text
  detection: DetectionCondition;
  prerequisites: Prerequisites;
  scope: string[];  // Direct text array
  outputs?: JobModeOutput[];  // What this mode produces
}

export interface RedirectSignals {
  [key: string]: string;  // to_job: description
}

export interface JobDefinition {
  id: string;
  agent: string;
  description: string;  // Direct text
  modes: JobMode[];
  redirect_signals: RedirectSignals;
}

// Workspace state check result
export interface PrerequisiteCheckResult {
  id: string;
  description: string;
  satisfied: boolean;
  path?: string;
}

export interface PrerequisiteStatus {
  required: PrerequisiteCheckResult[];
  recommended: PrerequisiteCheckResult[];
  allRequiredMet: boolean;
  allRecommendedMet: boolean;
}

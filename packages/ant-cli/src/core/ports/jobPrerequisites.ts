/**
 * Job Prerequisites Port
 * 
 * Validates that all required materials are present before executing a job.
 * This prevents jobs from running with incomplete inputs and provides clear
 * feedback to users about what's missing.
 * 
 * Architecture:
 * - Port (this file): Interface definition
 * - Adapter: Implementation that checks filesystem
 * - Used by: HTTP routes before job execution
 */

import { JobType } from './session';  // ✅ Import from session to avoid duplication

// ✅ Re-export for convenience
export { JobType };

/**
 * Required material that must be present for a job to run
 */
export interface RequiredMaterial {
  /** Human-readable name (e.g., "Design Directive", "PRD Document") */
  name: string;
  
  /** File path relative to feature directory (e.g., "inputs/directives/design/directive.md") */
  path: string;
  
  /** Description of what this material should contain */
  description: string;
  
  /** Whether the file must have content (not just exist as empty file) */
  mustHaveContent: boolean;
}

/**
 * Result of prerequisites validation
 */
export interface PrerequisitesValidationResult {
  /** Whether all prerequisites are satisfied */
  isValid: boolean;
  
  /** List of missing materials (empty if isValid is true) */
  missingMaterials: RequiredMaterial[];
  
  /** Human-readable error message (undefined if isValid is true) */
  errorMessage?: string;
}

/**
 * Job Prerequisites Port
 * 
 * Validates that all required materials are present before job execution.
 * Follows Hexagonal Architecture - interface in core, implementation in periphery.
 */
export interface JobPrerequisitesPort {
  /**
   * Validate prerequisites for a specific job type
   * 
   * @param projectId - Project identifier
   * @param featureName - Feature name
   * @param jobType - Type of job to validate
   * @returns Validation result with details about missing materials
   */
  validate(
    projectId: string,
    featureName: string,
    jobType: JobType
  ): Promise<PrerequisitesValidationResult>;
  
  /**
   * Get the list of required materials for a job type
   * 
   * @param jobType - Type of job
   * @returns List of required materials
   */
  getRequiredMaterials(jobType: JobType): RequiredMaterial[];
}


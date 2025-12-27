/**
 * Type definitions for runtime validation
 */

import { DiagnosisResult, ProjectDetection } from "../diagnostics";

export interface RuntimeValidationResult {
  passed: boolean;
  errors: string[];  // Required, aggregated from all error types
  buildErrors?: string[];
  lintErrors?: string[];
  typeErrors?: string[];
  testErrors?: string[];
  diagnoses?: DiagnosisResult[];  // ✅ Structured diagnostic results
  projectDetection?: ProjectDetection;  // ✅ Detected project info
}


import { ChildProcess } from 'child_process';

// ============================================
// Common Callback Types
// ============================================

/** Callback for process stdout/stderr output */
export type LogCallback = (type: 'stdout' | 'stderr', message: string) => void;

/** Callback for process exit */
export type ExitCallback = (code: number | null, signal: NodeJS.Signals | null) => void;

// ============================================
// Package & Project Types
// ============================================

/**
 * Package information for preview server
 */
export interface PackageInfo {
  name: string;
  path: string;
  type: 'frontend' | 'backend' | 'other';
  packageJson: any;
  port?: number;
  process?: ChildProcess;
}

/**
 * Project structure detection result
 */
export interface ProjectStructure {
  type: 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo';
  packages: PackageInfo[];
  entry?: PackageInfo;  // Entry point for Open button (usually frontend)
}

/**
 * Preview server setup failure reasoning codes
 * Used to categorize different types of setup failures and provide appropriate fixes
 */
export type SetupFailureReasoning = 
  | 'basename-missing'      // Frontend (CSR): Missing basename configuration for proxy (React Router, Vue Router)
  | 'basepath-missing'      // Frontend (SSR): Missing basePath in Next.js config for proxy
  | 'port-conflict'         // Port already in use (future)
  | 'dependency-error'      // npm/pnpm install failed (future)
  | 'config-invalid'        // Invalid vite/webpack config (future)
  | 'framework-unsupported' // Unsupported framework (future)
  | 'unknown';              // Unclassified error

/**
 * Preview issue reasoning codes (extensible)
 * - Includes fatal setup failures AND non-fatal runtime warnings.
 */
export type PreviewIssueReasoning =
  | SetupFailureReasoning
  | 'api-base-missing'          // Fullstack: frontend API base not configurable for dynamic backend ports
  | 'cross-project-api-missing'; // Cross-project: frontend-only project without linked backend

export type PreviewIssueSeverity = 'fatal' | 'warning';

/**
 * Unified issue model for preview server "Fix" workflow.
 * The system can push multiple issues over time; UI can offer "Fix All".
 */
export interface PreviewIssue {
  reasoning: PreviewIssueReasoning;
  severity: PreviewIssueSeverity;
  reason: string;                 // Human-readable summary
  suggestedFix?: string;          // LLM-ready instruction (optional)
}

/**
 * Preview validation result
 */
export interface ValidationResult {
  valid: boolean;
  framework?: string;
  reasoning?: SetupFailureReasoning;
  reason?: string;
  missingFiles?: string[];
  suggestedFix?: string;
}

/**
 * Framework type
 */
export type FrameworkType = 'react' | 'vue' | 'svelte' | 'next' | 'nuxt' | 'unknown';

/**
 * Server key components
 */
export interface ServerKeyComponents {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
}

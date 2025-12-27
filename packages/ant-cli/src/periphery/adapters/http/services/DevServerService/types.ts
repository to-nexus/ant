import { ChildProcess } from 'child_process';

/**
 * Package information for dev server
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
 * Dev server setup failure reasoning codes
 * Used to categorize different types of setup failures and provide appropriate fixes
 */
export type SetupFailureReasoning = 
  | 'basename-missing'      // Frontend: Missing basename configuration for proxy
  | 'port-conflict'         // Port already in use (future)
  | 'dependency-error'      // npm/pnpm install failed (future)
  | 'config-invalid'        // Invalid vite/webpack config (future)
  | 'framework-unsupported' // Unsupported framework (future)
  | 'unknown';              // Unclassified error

/**
 * Dev server validation result
 * 
 * ✅ REFACTORED: Unified validation interface
 */
export interface ValidationResult {
  valid: boolean;
  framework?: string;
  reasoning?: SetupFailureReasoning;  // ✅ Categorized failure reason
  reason?: string;                     // ✅ Human-readable message
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


/**
 * Dev Server Types
 * 
 * ✅ REFACTORED: Unified types aligned with Backend API contract
 * Single source of truth for dev server state management
 */

export type DevServerState = 'idle' | 'installing' | 'starting' | 'running' | 'error';

/**
 * Dev Server setup failure reasoning codes
 * 
 * ✅ ALIGNED with Backend: packages/ant-cli/.../DevServerService/types.ts
 * Categorizes different types of setup failures for appropriate handling
 * 
 * @see DevServerService/types.ts SetupFailureReasoning
 */
export type SetupFailureReasoning = 
  | 'basename-missing'      // Frontend: Missing basename configuration for proxy
  | 'port-conflict'         // Port already in use
  | 'dependency-error'      // npm/pnpm install failed
  | 'config-invalid'        // Invalid vite/webpack config
  | 'framework-unsupported' // Unsupported framework
  | 'unknown';              // Unclassified error

/**
 * Dev Server Status
 * Represents current state and configuration
 */
export interface DevServerStatus {
  running: boolean;
  ready?: boolean;  // Health check result
  port?: number | null;
  url?: string | null;
  logs?: DevServerLog[];
  setupReasoning?: SetupFailureReasoning;  // ✅ Categorized failure code
  setupReason?: string;                     // ✅ Human-readable message
  issues?: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;  // ✅ List of issues detected
}

export interface DevServerLog {
  timestamp: string;
  type: 'stdout' | 'stderr';
  message: string;
}

export interface DevServerError {
  message: string;
  code?: string;
  details?: string;
}

/**
 * Dev server setup validation result
 * 
 * ✅ ALIGNED with Backend ValidationResult
 * @see DevServerService/types.ts ValidationResult
 */
export interface DevServerValidation {
  valid: boolean;
  framework?: string;
  reasoning?: SetupFailureReasoning;  // ✅ NEW: Added to match backend
  reason?: string;                     // ✅ DEPRECATED: Use reasoning instead
  missingFiles?: string[];
  suggestedFix?: string;
}

/**
 * Package progress for multi-package projects
 */
export interface PackageProgress {
  name: string;
  state: 'pending' | 'installing' | 'starting' | 'running' | 'error';
  error?: string;
}

/**
 * Overall progress for multi-package setup
 */
export interface DevServerProgress {
  packages: PackageProgress[];
  currentPhase: 'installing' | 'starting' | 'running';
  completedCount: number;
  totalCount: number;
}

/**
 * Dismissed message tracking
 * Persisted in localStorage (dismissed until user clicks Play button again)
 */
export interface DismissedMessage {
  serverKey: string;
  reasoning: SetupFailureReasoning;
  dismissedAt: number;
}

export interface UseDevServerManagerResult {
  // State
  state: DevServerState;
  status: DevServerStatus | undefined;
  ready: boolean;  // Health check result
  setupReasoning: SetupFailureReasoning | undefined;  // Categorized failure code
  setupReason: string | undefined;  // Human-readable message
  suggestedFix: string | undefined;  // Suggested fix prompt
  error: DevServerError | undefined;
  progress: DevServerProgress | undefined;  // Multi-package progress
  
  // Actions
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  
  // UI Control
  isLoading: boolean;
  
  // ✅ NEW: Dismiss tracking
  isDismissed: boolean;
  dismissMessage: () => void;
}

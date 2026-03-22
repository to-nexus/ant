/**
 * Preview Server Types
 * 
 * Unified types aligned with Backend API contract
 * Single source of truth for preview server state management
 */

export type PreviewState = 'idle' | 'installing' | 'starting' | 'stopping' | 'running' | 'error';

/**
 * Preview server setup failure reasoning codes
 * 
 * ALIGNED with Backend: packages/ant-cli/.../PreviewService/types.ts
 * Categorizes different types of setup failures for appropriate handling
 */
export type SetupFailureReasoning =
  | 'basename-missing'            // Frontend (CSR): Missing basename configuration for proxy (React Router, Vue Router)
  | 'basepath-missing'            // Frontend (SSR): Missing basePath in Next.js config for proxy
  | 'images-unoptimized-missing'  // Next.js: basePath set but images.unoptimized missing — images break in proxy
  | 'port-conflict'               // Port already in use
  | 'dependency-error'            // npm/pnpm install failed
  | 'config-invalid'              // Invalid vite/webpack config
  | 'framework-unsupported'       // Unsupported framework
  | 'unknown';                    // Unclassified error

/**
 * Preview Server Status
 * Represents current state and configuration
 */
export interface PreviewStatus {
  running: boolean;
  ready?: boolean;  // Health check result
  port?: number | null;
  url?: string | null;
  logs?: PreviewLog[];
  setupReasoning?: SetupFailureReasoning;
  setupReason?: string;
  suggestedFix?: string;
  issues?: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;
  packages?: Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>;
  phase?: 'idle' | 'installing' | 'starting' | 'running' | 'error' | 'stopped';  // Explicit phase from backend
  error?: string;  // Error message from backend (e.g., install failure, health check failure)
}

export interface PreviewLog {
  timestamp: string;
  type: 'stdout' | 'stderr';
  message: string;
}

export interface PreviewError {
  message: string;
  code?: string;
  details?: string;
}

/**
 * Preview server setup validation result
 */
export interface PreviewValidation {
  valid: boolean;
  framework?: string;
  reasoning?: SetupFailureReasoning;
  reason?: string;
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
export interface PreviewProgress {
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
  reasoning: SetupFailureReasoning | string;
  dismissedAt: number;
}

export interface UsePreviewManagerResult {
  // State
  state: PreviewState;
  status: PreviewStatus | undefined;
  ready: boolean;  // Health check result
  setupReasoning: SetupFailureReasoning | undefined;
  setupReason: string | undefined;
  suggestedFix: string | undefined;
  error: PreviewError | undefined;
  progress: PreviewProgress | undefined;
  
  // Actions
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  
  // UI Control
  isLoading: boolean;
  
  // Dismiss tracking
  isDismissed: boolean;
  dismissMessage: () => void;
}

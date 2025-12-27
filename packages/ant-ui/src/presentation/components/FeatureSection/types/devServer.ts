/**
 * Dev Server Types
 */

export type DevServerState = 'idle' | 'installing' | 'starting' | 'running' | 'error';

export interface DevServerStatus {
  running: boolean;
  ready?: boolean;  // ✅ NEW: Health check result
  port?: number;
  url?: string;
  logs?: DevServerLog[];
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

export interface UseDevServerManagerResult {
  // State
  state: DevServerState;
  status: DevServerStatus | undefined;
  ready: boolean;  // ✅ NEW: Health check result
  error: DevServerError | undefined;
  progress: DevServerProgress | undefined;  // ✅ Multi-package progress
  
  // Actions
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  
  // UI Control
  isLoading: boolean;
}

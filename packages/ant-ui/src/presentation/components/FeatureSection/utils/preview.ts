/**
 * Preview Server Utilities
 */

import { PREVIEW_LOG_PATTERNS } from '../constants/preview';
import type { 
  PreviewStatus, 
  PreviewState, 
  PreviewLog, 
  PackageProgress, 
  PreviewProgress 
} from '../types/preview';

/**
 * Analyze preview server status and logs to determine current state.
 * 
 * Priority:
 * 1. Backend-provided `phase` field (most reliable, server-authoritative)
 * 2. Setup validation failure (`setupReasoning`)
 * 3. Backend-provided `error` field
 * 4. Log pattern matching (fallback)
 * 5. `running` flag
 * 6. `isLoading` state
 */
export function analyzePreviewState(
  status: PreviewStatus | undefined,
  isLoading: boolean
): PreviewState {
  if (!status) {
    return isLoading ? 'starting' : 'idle';
  }
  
  // 1. Backend-provided phase (most authoritative)
  if (status.phase) {
    // Map backend phases to frontend states
    switch (status.phase) {
      case 'installing': return 'installing';
      case 'starting': return 'starting';
      case 'running': return 'running';
      case 'error': return 'error';
      case 'stopped': return 'idle';
      case 'idle': return isLoading ? 'starting' : 'idle';
    }
  }
  
  // 2. Setup validation failure
  if (status.setupReasoning) {
    return 'error';
  }
  
  // 3. Backend error field
  if (status.error) {
    return 'error';
  }
  
  const logs = status.logs || [];
  
  // 4. Log pattern matching (fallback)
  if (hasLogPattern(logs, PREVIEW_LOG_PATTERNS.INSTALLING)) {
    const hasSuccess = hasLogPattern(logs, PREVIEW_LOG_PATTERNS.INSTALL_SUCCESS);
    if (!hasSuccess) {
      return 'installing';
    }
  }
  
  if (hasErrorInLogs(logs)) {
    return 'error';
  }
  
  // 5. Running flag
  if (status.running) {
    return 'running';
  }
  
  // 6. Default
  return isLoading ? 'starting' : 'idle';
}

/**
 * Extract multi-package progress from logs
 */
export function extractProgress(logs: PreviewLog[]): PreviewProgress | undefined {
  const packages: PackageProgress[] = [];
  let currentPhase: 'installing' | 'starting' | 'running' = 'installing';
  
  // Parse logs for package-specific messages
  for (const log of logs) {
    // Installing: "📦 Installing dependencies for web-client..." or "📦 Installing dependencies for workspace root..."
    const installMatch = log.message.match(/📦 Installing.*for (.+)\.\.\./) || 
                        log.message.match(/Installing dependencies: (.+)\.\.\./);
    if (installMatch) {
      const pkgName = installMatch[1];
      // Skip "workspace root" - it's not a package name
      if (pkgName !== 'workspace root' && !packages.find(p => p.name === pkgName)) {
        packages.push({ name: pkgName, state: 'installing' });
      }
    }
    
    // Install success: "✅ Dependencies installed for web-client" or "✅ Dependencies installed for workspace root"
    const installSuccessMatch = log.message.match(/✅ Dependencies installed for (.+)/) ||
                               log.message.match(/✅ Dependencies installed: (.+)/);
    if (installSuccessMatch) {
      const pkgName = installSuccessMatch[1];
      const pkg = packages.find(p => p.name === pkgName);
      if (pkg && pkg.state === 'installing') {
        pkg.state = 'starting';
      }
      // For workspace projects, all packages move to starting after root install
      if (pkgName === 'workspace root' && packages.length > 0) {
        packages.forEach(p => {
          if (p.state === 'installing') p.state = 'starting';
        });
      }
    }
    
    // Starting: "🚀 Starting web-client (frontend) on port 30001..." or "🚀 Starting packages/backend (backend)..."
    const startingMatch = log.message.match(/🚀 Starting (.+?) \(/);
    if (startingMatch) {
      const pkgName = startingMatch[1];
      const pkg = packages.find(p => p.name === pkgName);
      if (pkg) {
        pkg.state = 'starting';
        currentPhase = 'starting';
      } else {
        packages.push({ name: pkgName, state: 'starting' });
        currentPhase = 'starting';
      }
    }
    
    // Running: "✅ All preview servers started successfully!"
    if (log.message.includes('All dev servers started') || 
        log.message.includes('All preview servers started') ||
        log.message.includes('all servers running')) {
      packages.forEach(pkg => {
        if (pkg.state !== 'error') {
          pkg.state = 'running';
        }
      });
      currentPhase = 'running';
    }
    
    // Error: "❌ Error: ..."
    const errorMatch = log.message.match(/❌.*?for (.+?)[:]/);
    if (errorMatch) {
      const pkgName = errorMatch[1];
      const pkg = packages.find(p => p.name === pkgName);
      if (pkg) {
        pkg.state = 'error';
        pkg.error = log.message;
      }
    }
  }
  
  // If no packages detected, return undefined (single package or no progress yet)
  if (packages.length === 0) {
    return undefined;
  }
  
  // "completed" means successfully started (running), not failed (error)
  const completedCount = packages.filter(p => p.state === 'running').length;
  
  return {
    packages,
    currentPhase,
    completedCount,
    totalCount: packages.length
  };
}

/**
 * Extract error message from logs
 */
export function extractErrorFromLogs(logs: PreviewLog[]): string | undefined {
  // Find install failure
  const installError = logs.find(log => 
    log.message.includes(PREVIEW_LOG_PATTERNS.INSTALL_FAILED)
  );
  if (installError) {
    return installError.message;
  }
  
  // Find port in use error
  const portError = logs.find(log =>
    log.type === 'stderr' && 
    log.message.includes(PREVIEW_LOG_PATTERNS.PORT_IN_USE)
  );
  if (portError) {
    return portError.message;
  }
  
  // Find generic error
  const errorLog = logs
    .filter(log => log.type === 'stderr')
    .find(log => 
      PREVIEW_LOG_PATTERNS.ERROR_MARKER.some(marker => 
        log.message.includes(marker)
      )
    );
  
  return errorLog?.message;
}

/**
 * Check if logs contain a specific pattern
 */
function hasLogPattern(logs: PreviewLog[], pattern: string): boolean {
  return logs.some(log => log.message.includes(pattern));
}

/**
 * Check if logs contain error markers
 */
function hasErrorInLogs(logs: PreviewLog[]): boolean {
  return logs.some(log => 
    log.type === 'stderr' && 
    PREVIEW_LOG_PATTERNS.ERROR_MARKER.some(marker => 
      log.message.includes(marker)
    )
  );
}

/**
 * Get progress message for current state
 */
export function getProgressMessage(progress: PreviewProgress | undefined): string {
  if (!progress) {
    return '';
  }
  
  const { packages, currentPhase, completedCount, totalCount } = progress;
  
  if (currentPhase === 'installing') {
    const installing = packages.filter(p => p.state === 'installing');
    if (installing.length > 0) {
      return `Installing dependencies: ${installing.map(p => p.name).join(', ')}`;
    }
  }
  
  if (currentPhase === 'starting') {
    const starting = packages.filter(p => p.state === 'starting');
    if (starting.length > 0) {
      return `Starting servers: ${starting.map(p => p.name).join(', ')}`;
    }
  }
  
  if (currentPhase === 'running') {
    return `All servers running (${completedCount}/${totalCount})`;
  }
  
  return `Progress: ${completedCount}/${totalCount}`;
}

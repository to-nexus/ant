/**
 * Dev Server Utilities
 */

import { DEV_SERVER_LOG_PATTERNS } from '../constants/devServer';
import type { 
  PreviewStatus, 
  PreviewState, 
  PreviewLog, 
  PackageProgress, 
  PreviewProgress 
} from '../types/devServer';

/**
 * Analyze dev server status and logs to determine current state
 */
export function analyzeDevServerState(
  status: PreviewStatus | undefined,
  isLoading: boolean
): PreviewState {
  if (!status) {
    return isLoading ? 'starting' : 'idle';
  }
  
  const logs = status.logs || [];
  
  // Check for setup validation failure FIRST
  if (status.setupReasoning) {  // If reasoning exists, validation failed
    return 'error';
  }
  
  // Check for installing state
  if (hasLogPattern(logs, DEV_SERVER_LOG_PATTERNS.INSTALLING)) {
    const hasSuccess = hasLogPattern(logs, DEV_SERVER_LOG_PATTERNS.INSTALL_SUCCESS);
    if (!hasSuccess) {
      return 'installing';
    }
  }
  
  // Check for error state in logs
  if (hasErrorInLogs(logs)) {
    return 'error';
  }
  
  // Check if running
  if (status.running) {
    return 'running';
  }
  
  // Default to starting if loading
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
    // Installing: "📦 Installing dependencies for web-client..."
    const installMatch = log.message.match(/📦 Installing.*for (.+)\.\.\./) || 
                        log.message.match(/Installing dependencies: (.+)\.\.\./);
    if (installMatch) {
      const pkgName = installMatch[1];
      if (!packages.find(p => p.name === pkgName)) {
        packages.push({ name: pkgName, state: 'installing' });
      }
    }
    
    // Install success: "✅ Dependencies installed for web-client"
    const installSuccessMatch = log.message.match(/✅ Dependencies installed for (.+)/) ||
                               log.message.match(/✅ Dependencies installed: (.+)/);
    if (installSuccessMatch) {
      const pkgName = installSuccessMatch[1];
      const pkg = packages.find(p => p.name === pkgName);
      if (pkg && pkg.state === 'installing') {
        pkg.state = 'starting';
      }
    }
    
    // Starting: "🚀 Starting web-client (frontend) on port 30001..."
    const startingMatch = log.message.match(/🚀 Starting (.+?) \(/);
    if (startingMatch) {
      const pkgName = startingMatch[1];
      const pkg = packages.find(p => p.name === pkgName);
      if (pkg) {
        pkg.state = 'starting';
        currentPhase = 'starting';
      } else {
        packages.push({ name: pkgName, state: 'starting' });
      }
    }
    
    // Running: "✅ All dev servers started successfully!"
    if (log.message.includes('All dev servers started') || 
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
  
  // ✅ "completed" means successfully started (running), not failed (error)
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
    log.message.includes(DEV_SERVER_LOG_PATTERNS.INSTALL_FAILED)
  );
  if (installError) {
    return installError.message;
  }
  
  // Find port in use error
  const portError = logs.find(log =>
    log.type === 'stderr' && 
    log.message.includes(DEV_SERVER_LOG_PATTERNS.PORT_IN_USE)
  );
  if (portError) {
    return portError.message;
  }
  
  // Find generic error
  const errorLog = logs
    .filter(log => log.type === 'stderr')
    .find(log => 
      DEV_SERVER_LOG_PATTERNS.ERROR_MARKER.some(marker => 
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
    DEV_SERVER_LOG_PATTERNS.ERROR_MARKER.some(marker => 
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

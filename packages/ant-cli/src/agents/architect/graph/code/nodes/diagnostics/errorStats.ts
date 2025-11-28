/**
 * Error Statistics Collection System
 * 
 * Tracks error patterns, frequencies, and resolution success rates
 * to improve diagnostics and lesson extraction over time.
 */

import { DiagnosisResult, ErrorLayer } from './types';

export interface ErrorOccurrence {
  timestamp: Date;
  diagnosisType: string;
  layer: ErrorLayer;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  context: {
    command?: string;
    workDir?: string;
    language?: string;
    buildTool?: string;
    packageManager?: string;
  };
  resolution?: {
    resolved: boolean;
    attemptCount: number;
    timeToResolve?: number; // milliseconds
    finalAction?: string;
  };
}

export interface ErrorStatistics {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsByLayer: Record<ErrorLayer, number>;
  errorsBySeverity: Record<'critical' | 'major' | 'minor', number>;
  mostCommonErrors: Array<{ type: string; count: number; avgResolutionAttempts: number }>;
  avgResolutionTime: number;
  resolutionSuccessRate: number;
}

/**
 * In-memory error statistics (could be persisted to file/DB later)
 */
class ErrorStatsCollector {
  private occurrences: ErrorOccurrence[] = [];
  private maxOccurrences = 1000; // Keep last 1000 errors

  /**
   * Record a new error occurrence
   */
  recordError(diagnosis: DiagnosisResult, context: ErrorOccurrence['context']): void {
    const occurrence: ErrorOccurrence = {
      timestamp: new Date(),
      diagnosisType: diagnosis.type,
      layer: diagnosis.layer,
      severity: diagnosis.severity,
      message: diagnosis.message,
      context,
    };

    this.occurrences.push(occurrence);

    // Keep only last N occurrences
    if (this.occurrences.length > this.maxOccurrences) {
      this.occurrences.shift();
    }
  }

  /**
   * Mark an error as resolved
   */
  markResolved(
    diagnosisType: string,
    attemptCount: number,
    timeToResolve: number,
    finalAction?: string
  ): void {
    // Find most recent unresolved occurrence of this type
    for (let i = this.occurrences.length - 1; i >= 0; i--) {
      const occ = this.occurrences[i];
      if (occ.diagnosisType === diagnosisType && !occ.resolution) {
        occ.resolution = {
          resolved: true,
          attemptCount,
          timeToResolve,
          finalAction,
        };
        break;
      }
    }
  }

  /**
   * Mark an error as unresolvable (gave up after max retries)
   */
  markUnresolved(diagnosisType: string, attemptCount: number): void {
    for (let i = this.occurrences.length - 1; i >= 0; i--) {
      const occ = this.occurrences[i];
      if (occ.diagnosisType === diagnosisType && !occ.resolution) {
        occ.resolution = {
          resolved: false,
          attemptCount,
        };
        break;
      }
    }
  }

  /**
   * Get comprehensive statistics
   */
  getStatistics(): ErrorStatistics {
    const stats: ErrorStatistics = {
      totalErrors: this.occurrences.length,
      errorsByType: {},
      errorsByLayer: {
        [ErrorLayer.ENVIRONMENT]: 0,
        [ErrorLayer.TOOLCHAIN]: 0,
        [ErrorLayer.DEPENDENCY]: 0,
        [ErrorLayer.CONFIGURATION]: 0,
        [ErrorLayer.CODE]: 0,
        [ErrorLayer.BUILD]: 0,
      },
      errorsBySeverity: {
        critical: 0,
        major: 0,
        minor: 0,
      },
      mostCommonErrors: [],
      avgResolutionTime: 0,
      resolutionSuccessRate: 0,
    };

    let totalResolutionTime = 0;
    let resolvedCount = 0;
    let totalResolutionAttempts = 0;

    const typeAttempts: Record<string, number[]> = {};

    for (const occ of this.occurrences) {
      // Count by type
      stats.errorsByType[occ.diagnosisType] = (stats.errorsByType[occ.diagnosisType] || 0) + 1;

      // Count by layer
      stats.errorsByLayer[occ.layer]++;

      // Count by severity
      stats.errorsBySeverity[occ.severity]++;

      // Track resolution metrics
      if (occ.resolution) {
        totalResolutionAttempts++;
        if (occ.resolution.resolved) {
          resolvedCount++;
          if (occ.resolution.timeToResolve) {
            totalResolutionTime += occ.resolution.timeToResolve;
          }
        }

        // Track attempts per type
        if (!typeAttempts[occ.diagnosisType]) {
          typeAttempts[occ.diagnosisType] = [];
        }
        typeAttempts[occ.diagnosisType].push(occ.resolution.attemptCount);
      }
    }

    // Calculate most common errors with avg resolution attempts
    stats.mostCommonErrors = Object.entries(stats.errorsByType)
      .map(([type, count]) => ({
        type,
        count,
        avgResolutionAttempts:
          typeAttempts[type]
            ? typeAttempts[type].reduce((a, b) => a + b, 0) / typeAttempts[type].length
            : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate averages
    stats.avgResolutionTime = resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0;
    stats.resolutionSuccessRate =
      totalResolutionAttempts > 0 ? resolvedCount / totalResolutionAttempts : 0;

    return stats;
  }

  /**
   * Get recent errors (for debugging)
   */
  getRecentErrors(limit: number = 20): ErrorOccurrence[] {
    return this.occurrences.slice(-limit);
  }

  /**
   * Clear all statistics (for testing)
   */
  clear(): void {
    this.occurrences = [];
  }

  /**
   * Export data (for persistence)
   */
  export(): ErrorOccurrence[] {
    return [...this.occurrences];
  }

  /**
   * Import data (from persistence)
   */
  import(data: ErrorOccurrence[]): void {
    this.occurrences = data.slice(-this.maxOccurrences);
  }
}

/**
 * Global singleton instance
 */
export const errorStatsCollector = new ErrorStatsCollector();

/**
 * Helper: Format statistics for display
 */
export function formatStatistics(stats: ErrorStatistics): string {
  const lines: string[] = [];

  lines.push('📊 ERROR STATISTICS');
  lines.push('═══════════════════════════════════════════════');
  lines.push(`Total Errors: ${stats.totalErrors}`);
  lines.push('');

  lines.push('By Layer:');
  Object.entries(stats.errorsByLayer)
    .filter(([_, count]) => count > 0)
    .sort(([_, a], [__, b]) => b - a)
    .forEach(([layer, count]) => {
      const percentage = ((count / stats.totalErrors) * 100).toFixed(1);
      lines.push(`  ${layer.padEnd(15)} ${count.toString().padStart(4)} (${percentage}%)`);
    });
  lines.push('');

  lines.push('By Severity:');
  Object.entries(stats.errorsBySeverity)
    .filter(([_, count]) => count > 0)
    .forEach(([severity, count]) => {
      const percentage = ((count / stats.totalErrors) * 100).toFixed(1);
      lines.push(`  ${severity.padEnd(15)} ${count.toString().padStart(4)} (${percentage}%)`);
    });
  lines.push('');

  lines.push('Most Common Errors:');
  stats.mostCommonErrors.slice(0, 5).forEach((error, i) => {
    lines.push(
      `  ${i + 1}. ${error.type} (${error.count}x, avg ${error.avgResolutionAttempts.toFixed(1)} attempts)`
    );
  });
  lines.push('');

  lines.push('Resolution Metrics:');
  lines.push(`  Success Rate: ${(stats.resolutionSuccessRate * 100).toFixed(1)}%`);
  if (stats.avgResolutionTime > 0) {
    const minutes = Math.floor(stats.avgResolutionTime / 60000);
    const seconds = Math.floor((stats.avgResolutionTime % 60000) / 1000);
    lines.push(`  Avg Time: ${minutes}m ${seconds}s`);
  }

  return lines.join('\n');
}


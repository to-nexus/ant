import { SessionRun } from "../../../types";

export type CodeMode = 'generate' | 'refactor' | 'explain';

/**
 * Session Context for LLM (Compressed)
 */
export interface SessionContextForLLM {
  recentRuns: Array<{
    runId: number;
    directive: string;
    mode: string;
    output: string;
  }>;
  summary?: string;
  totalRuns: number;
  currentRun: number;
  currentMode: CodeMode;
  windowSize: number;
  compressionRatio: number;
}

/**
 * Session Context Builder
 * 
 * Compresses session history for LLM using sliding window approach
 */
export class SessionContextBuilder {
  
  /**
   * Build compressed session context for LLM
   */
  buildContextForLLM(
    runs: SessionRun[],
    currentMode: CodeMode,
    currentDirective: string
  ): SessionContextForLLM {
    
    const currentRun = runs.length + 1;
    
    if (runs.length === 0) {
      return {
        recentRuns: [],
        totalRuns: 0,
        currentRun: 1,
        currentMode,
        windowSize: 0,
        compressionRatio: 0
      };
    }
    
    const windowSize = this.getWindowSize(currentMode, runs);
    
    const candidateRuns = runs.slice(-Math.min(windowSize, runs.length));
    const recentRuns = this.selectRelevantRuns(
      candidateRuns,
      currentMode,
      currentDirective
    );
    
    let summary: string | undefined;
    const earlierRunsCount = runs.length - windowSize;
    if (earlierRunsCount > 0) {
      const earlierRuns = runs.slice(0, -windowSize);
      summary = this.compressRuns(earlierRuns);
    }
    
    const originalSize = runs.length;
    const compressedSize = recentRuns.length + (summary ? 0.1 : 0);
    const compressionRatio = compressedSize / originalSize;
    
    return {
      recentRuns,
      summary,
      totalRuns: runs.length,
      currentRun,
      currentMode,
      windowSize,
      compressionRatio
    };
  }
  
  /**
   * Dynamic window size based on CURRENT mode
   */
  private getWindowSize(currentMode: CodeMode, runs: SessionRun[]): number {
    switch (currentMode) {
      case 'refactor':
        return Math.min(2, runs.length);
      case 'generate':
        return Math.min(1, runs.length);
      case 'explain':
        return Math.min(1, runs.length);
      default:
        return 1;
    }
  }
  
  private selectRelevantRuns(
    candidateRuns: SessionRun[],
    currentMode: CodeMode,
    currentDirective: string
  ): Array<{
    runId: number;
    directive: string;
    mode: string;
    output: string;
  }> {
    return candidateRuns
      .filter(run => {
        if (currentMode === 'refactor') {
          const runJob = run.job || 'code';
          return runJob === 'code';
        }
        if (currentMode === 'generate') {
          return run.job === 'code';
        }
        return true;
      })
      .map(run => ({
        runId: run.runId,
        directive: run.input?.summary || '',
        mode: (run as any).mode || 'generate',
        output: this.selectiveOutput(run, currentMode)
      }));
  }
  
  private selectiveOutput(run: SessionRun, currentMode: CodeMode): string {
    if (currentMode === 'refactor') {
      const files = run.output?.files || [];
      return run.output?.summary || files.slice(0, 3).join(', ') || '';
    }
    if (currentMode === 'generate') {
      const files = run.output?.files || [];
      return `Created: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`;
    }
    return '';
  }
  
  private compressRuns(runs: SessionRun[]): string {
    const groups = this.groupRunsByAction(runs);
    
    return groups.map(group => {
      const runRange = group.length > 1 
        ? `Run ${group[0].runId}-${group[group.length - 1].runId}`
        : `Run ${group[0].runId}`;
      
      const summary = group[0].input?.summary || 'Code work';
      return `${runRange}: ${summary}`;
    }).join('; ');
  }
  
  private groupRunsByAction(runs: SessionRun[]): SessionRun[][] {
    const groups: SessionRun[][] = [];
    let currentGroup: SessionRun[] = [];
    
    for (const run of runs) {
      if (currentGroup.length === 0) {
        currentGroup.push(run);
      } else {
        const lastRun = currentGroup[currentGroup.length - 1];
        if (lastRun.job === run.job) {
          currentGroup.push(run);
        } else {
          groups.push(currentGroup);
          currentGroup = [run];
        }
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }
}

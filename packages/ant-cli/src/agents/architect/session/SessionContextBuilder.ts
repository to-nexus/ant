import { SessionTurn } from "../types";

export type CodeMode = 'generate' | 'refactor' | 'explain';

/**
 * Session Context for LLM (Compressed)
 */
export interface SessionContextForLLM {
  recentTurns: Array<{
    turnId: number;
    directive: string;
    mode: string;
    output: string;
  }>;
  summary?: string;
  totalTurns: number;
  currentTurn: number;
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
    turns: SessionTurn[],
    currentMode: CodeMode,
    currentDirective: string
  ): SessionContextForLLM {
    
    const currentTurn = turns.length + 1;
    
    // No history
    if (turns.length === 0) {
      return {
        recentTurns: [],
        totalTurns: 0,
        currentTurn: 1,
        currentMode,
        windowSize: 0,
        compressionRatio: 0
      };
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 1: Determine window size (mode-aware)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const windowSize = this.getWindowSize(currentMode, turns);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 2: Select relevant recent turns (DETAILED)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const candidateTurns = turns.slice(-Math.min(windowSize, turns.length));
    const recentTurns = this.selectRelevantTurns(
      candidateTurns,
      currentMode,
      currentDirective
    );
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 3: Summarize earlier turns (COMPRESSED)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let summary: string | undefined;
    const earlierTurnsCount = turns.length - windowSize;
    if (earlierTurnsCount > 0) {
      const earlierTurns = turns.slice(0, -windowSize);
      summary = this.compressTurns(earlierTurns);
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 4: Calculate compression ratio
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const originalSize = turns.length;
    const compressedSize = recentTurns.length + (summary ? 0.1 : 0);
    const compressionRatio = compressedSize / originalSize;
    
    return {
      recentTurns,
      summary,
      totalTurns: turns.length,
      currentTurn,
      currentMode,
      windowSize,
      compressionRatio
    };
  }
  
  /**
   * Dynamic window size based on CURRENT mode
   */
  private getWindowSize(currentMode: CodeMode, turns: SessionTurn[]): number {
    switch (currentMode) {
      case 'refactor':
        // Refactor: need previous code context
        return Math.min(2, turns.length);
      
      case 'generate':
        // Generate: minimal context
        return Math.min(1, turns.length);
      
      case 'explain':
        // Explain: minimal context
        return Math.min(1, turns.length);
      
      default:
        return 1;
    }
  }
  
  /**
   * Select relevant turns from candidates
   */
  private selectRelevantTurns(
    candidateTurns: SessionTurn[],
    currentMode: CodeMode,
    currentDirective: string
  ): Array<{
    turnId: number;
    directive: string;
    mode: string;
    output: string;
  }> {
    
    return candidateTurns
      .filter(turn => {
        // Refactor mode: previous generate/refactor turns are relevant
        if (currentMode === 'refactor') {
          const turnTask = turn.task || 'code';
          return turnTask === 'code';
        }
        
        // Generate mode: previous generate turns (patterns)
        if (currentMode === 'generate') {
          return turn.task === 'code';
        }
        
        // Explain mode: all modes
        return true;
      })
      .map(turn => ({
        turnId: turn.turnId,
        directive: turn.input?.summary || '',
        mode: (turn as any).mode || 'generate',
        output: this.selectiveOutput(turn, currentMode)
      }));
  }
  
  /**
   * Selective output based on mode
   */
  private selectiveOutput(turn: SessionTurn, currentMode: CodeMode): string {
    // Refactor mode: need previous output
    if (currentMode === 'refactor') {
      const files = turn.output?.files || [];
      return turn.output?.summary || files.slice(0, 3).join(', ') || '';
    }
    
    // Generate mode: just file list
    if (currentMode === 'generate') {
      const files = turn.output?.files || [];
      return `Created: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`;
    }
    
    // Explain mode: not needed
    return '';
  }
  
  /**
   * Compress earlier turns into summary
   */
  private compressTurns(turns: SessionTurn[]): string {
    // Group by similar actions
    const groups = this.groupTurnsByAction(turns);
    
    return groups.map(group => {
      const turnRange = group.length > 1 
        ? `Turn ${group[0].turnId}-${group[group.length - 1].turnId}`
        : `Turn ${group[0].turnId}`;
      
      const summary = group[0].input?.summary || 'Code work';
      return `${turnRange}: ${summary}`;
    }).join('; ');
  }
  
  /**
   * Group consecutive turns by similar actions
   */
  private groupTurnsByAction(turns: SessionTurn[]): SessionTurn[][] {
    const groups: SessionTurn[][] = [];
    let currentGroup: SessionTurn[] = [];
    
    for (const turn of turns) {
      if (currentGroup.length === 0) {
        currentGroup.push(turn);
      } else {
        const lastTurn = currentGroup[currentGroup.length - 1];
        
        // Same task type = same group
        if (lastTurn.task === turn.task) {
          currentGroup.push(turn);
        } else {
          groups.push(currentGroup);
          currentGroup = [turn];
        }
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }
}


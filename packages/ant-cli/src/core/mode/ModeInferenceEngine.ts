/**
 * Mode Inference Engine
 * 
 * 2-Stage Hybrid Approach:
 * - Stage 1: Agent-based (Fast, 80% cases)
 * - Stage 2: LLM-based (Slow, 20% ambiguous cases)
 * 
 * Modes:
 * - generate: Create new features/files
 * - refactor: Improve existing code
 * - explain: Understand/document code
 */

export type CodeMode = 'generate' | 'refactor' | 'explain' | 'ambiguous';

export interface ModeInferenceContext {
  directive: string;
  hasOriginalFiles: boolean;
  hasCurrentCode: boolean;
  filesChanged: number;
  totalFiles: number;
  gitDiff?: string;
  
  // ✅ Session Context (for iteration/fix scenarios)
  sessionContext?: {
    previousDirective?: string;     // 이전 턴의 요청
    previousMode?: CodeMode;        // 이전 턴의 모드
    previousOutput?: string;        // 이전 턴의 결과 (코드)
    turnsSinceStart: number;        // 세션 시작 후 턴 수
  };
}

export interface ModeInferenceResult {
  mode: CodeMode;
  confidence: number;  // 0.0 - 1.0
  reasoning: string;
  stage: 'agent' | 'llm';
}

/**
 * Mode Inference Engine
 */
export class ModeInferenceEngine {
  
  /**
   * Infer code mode (2-stage hybrid)
   */
  async infer(
    context: ModeInferenceContext,
    llmClient?: any  // Optional: for Stage 2
  ): Promise<ModeInferenceResult> {
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 1: Agent-based inference (Fast)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const agentResult = this.inferByAgent(context);
    
    if (agentResult.confidence >= 0.8) {
      console.log(`🎯 [Mode] Agent inference (confident): ${agentResult.mode} (${agentResult.confidence.toFixed(2)})`);
      return agentResult;
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 2: LLM-based inference (Slow, only if ambiguous)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (llmClient && agentResult.mode === 'ambiguous') {
      console.log(`🤔 [Mode] Agent uncertain (${agentResult.confidence.toFixed(2)}), asking LLM...`);
      const llmResult = await this.inferByLLM(context, llmClient);
      console.log(`🧠 [Mode] LLM inference: ${llmResult.mode} (${llmResult.confidence.toFixed(2)})`);
      return llmResult;
    }
    
    // Fallback to agent result (even if low confidence)
    console.log(`⚠️  [Mode] Agent inference (uncertain): ${agentResult.mode} (${agentResult.confidence.toFixed(2)})`);
    return agentResult;
  }
  
  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Stage 1: Agent-based inference (Rule-based)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  private inferByAgent(context: ModeInferenceContext): ModeInferenceResult {
    const directive = context.directive.toLowerCase();
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Rule 0: Session Continuation (HIGHEST PRIORITY)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (context.sessionContext?.previousMode && 
        context.sessionContext.turnsSinceStart > 0) {
      
      const fixKeywords = [
        'fix', 'change', 'update', 'modify', 'correct', 'adjust',
        'wrong', 'error', 'bug', 'issue', 'problem',
        'instead', 'actually', 'should be', 'not right'
      ];
      
      const hasFix = fixKeywords.some(k => directive.includes(k));
      
      // "Fix the code I just generated" = Refactor (session-aware)
      if (hasFix && context.sessionContext.previousMode !== 'explain') {
        return {
          mode: 'refactor',
          confidence: 0.95,
          reasoning: `Session continuation: fixing previous ${context.sessionContext.previousMode} output`,
          stage: 'agent'
        };
      }
      
      // User is continuing conversation - likely same mode
      // BUT: Check for explicit mode change keywords
      const generateKeywords = ['add new', 'create new', 'new feature'];
      const hasNewGenerate = generateKeywords.some(k => directive.includes(k));
      
      if (hasNewGenerate) {
        return {
          mode: 'generate',
          confidence: 0.85,
          reasoning: 'Session continuation but explicit new feature request',
          stage: 'agent'
        };
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Rule 1: Explain Mode (Highest priority - no code changes)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const explainKeywords = [
      'explain', 'what', 'why', 'how', 'analyze', 'understand',
      'describe', 'document', 'add comments', 'add documentation'
    ];
    
    if (explainKeywords.some(k => directive.includes(k))) {
      // Exception: "explain how to implement X" = generate
      if (directive.includes('how to implement') || 
          directive.includes('how to add') ||
          directive.includes('how to create')) {
        return {
          mode: 'generate',
          confidence: 0.7,
          reasoning: 'Directive asks "how to implement" - Generate mode',
          stage: 'agent'
        };
      }
      
      return {
        mode: 'explain',
        confidence: 0.9,
        reasoning: 'Directive contains explain/analyze keywords',
        stage: 'agent'
      };
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Rule 2: Generate Mode (No existing code)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!context.hasOriginalFiles && !context.hasCurrentCode) {
      const generateKeywords = ['create', 'add', 'new', 'implement', 'build'];
      const hasGenerateKeyword = generateKeywords.some(k => directive.includes(k));
      
      return {
        mode: 'generate',
        confidence: hasGenerateKeyword ? 0.95 : 0.85,
        reasoning: 'No existing code - Generate mode',
        stage: 'agent'
      };
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Rule 3: Refactor Mode (Clear keywords)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const refactorKeywords = [
      'refactor', 'optimize', 'improve', 'clean up', 'reorganize',
      'extract', 'split', 'merge', 'simplify', 'reduce complexity',
      'remove duplication', 'performance'
    ];
    
    if (refactorKeywords.some(k => directive.includes(k))) {
      return {
        mode: 'refactor',
        confidence: 0.9,
        reasoning: 'Directive contains refactor keywords',
        stage: 'agent'
      };
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Rule 4: Generate vs Refactor (Ambiguous - use heuristics)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (context.hasOriginalFiles || context.hasCurrentCode) {
      const generateKeywords = ['add', 'create', 'new', 'implement'];
      const modifyKeywords = ['fix', 'update', 'change', 'modify'];
      
      const hasGenerate = generateKeywords.some(k => directive.includes(k));
      const hasModify = modifyKeywords.some(k => directive.includes(k));
      
      // "Add new feature to existing file" = Generate
      if (hasGenerate && (directive.includes('new') || directive.includes('feature'))) {
        return {
          mode: 'generate',
          confidence: 0.75,
          reasoning: 'Adding new independent feature to existing codebase',
          stage: 'agent'
        };
      }
      
      // "Fix bug" or "Update logic" = Refactor
      if (hasModify || directive.includes('fix') || directive.includes('bug')) {
        return {
          mode: 'refactor',
          confidence: 0.75,
          reasoning: 'Modifying existing code logic',
          stage: 'agent'
        };
      }
      
      // Git diff analysis (if available)
      if (context.gitDiff) {
        const changeRatio = context.filesChanged / Math.max(context.totalFiles, 1);
        
        // Large changes (> 30% files) = Refactor
        if (changeRatio > 0.3) {
          return {
            mode: 'refactor',
            confidence: 0.7,
            reasoning: `Large change scope (${(changeRatio * 100).toFixed(0)}% of files)`,
            stage: 'agent'
          };
        }
        
        // Small changes (< 10% files) = Generate (likely adding new files)
        if (changeRatio < 0.1) {
          return {
            mode: 'generate',
            confidence: 0.7,
            reasoning: `Small change scope (${(changeRatio * 100).toFixed(0)}% of files)`,
            stage: 'agent'
          };
        }
      }
      
      // Ambiguous case - need LLM
      return {
        mode: 'ambiguous',
        confidence: 0.5,
        reasoning: 'Cannot determine mode with confidence - needs LLM analysis',
        stage: 'agent'
      };
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Default: Generate (fallback)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    return {
      mode: 'generate',
      confidence: 0.6,
      reasoning: 'Default to generate mode',
      stage: 'agent'
    };
  }
  
  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Stage 2: LLM-based inference (Semantic analysis)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  private async inferByLLM(
    context: ModeInferenceContext,
    llmClient: any
  ): Promise<ModeInferenceResult> {
    
    const prompt = `Analyze the following coding task and determine the mode:

**Directive**: ${context.directive}

**Context**:
- Has existing code: ${context.hasOriginalFiles || context.hasCurrentCode}
- Files changed: ${context.filesChanged}/${context.totalFiles}

**Modes**:
1. **generate**: Creating NEW features/files (existing code unchanged, or adding independent new functionality)
2. **refactor**: IMPROVING existing code (same functionality, better structure/performance)
3. **explain**: UNDERSTANDING code (no code changes, just explanation/documentation)

**Instructions**:
- Choose ONE mode that best fits
- Provide reasoning

**Response format** (JSON):
{
  "mode": "generate" | "refactor" | "explain",
  "reasoning": "Brief explanation"
}`;

    try {
      const result = await llmClient.invokeStructured(
        [
          { role: 'system', content: 'You are a code mode inference expert. Analyze the task and respond with ONLY valid JSON.' },
          { role: 'user', content: prompt }
        ],
        {
          type: 'object',
          properties: {
            mode: { 
              type: 'string',
              enum: ['generate', 'refactor', 'explain'],
              description: 'The inferred code mode'
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation for the mode choice'
            }
          },
          required: ['mode', 'reasoning']
        },
        'mode_inference'
      );
      
      return {
        mode: result.mode,
        confidence: 0.85,  // LLM is generally confident
        reasoning: result.reasoning,
        stage: 'llm'
      };
      
    } catch (error) {
      console.error('[Mode] LLM inference failed:', error);
      
      // Fallback to generate
      return {
        mode: 'generate',
        confidence: 0.6,
        reasoning: 'LLM inference failed - fallback to generate',
        stage: 'llm'
      };
    }
  }
}


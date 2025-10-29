import { getDirective, getSource, findLatestDesign } from "../../../utils";
import { DesignGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";

/**
 * Design Resolve Node
 * 
 * Strategy: Load based on design mode
 * - greenfield: PRD only (no codebase)
 * - evolution: PRD + current codebase (Phase 1: CodebaseRetriever)
 * - refactor: Current codebase + previous design (Phase 1: CodebaseRetriever)
 * 
 * Always load directive if available
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations
 */
export async function resolve(state: DesignGraphState): Promise<DesignGraphState> {
  const { context, designMode } = state;
  const retriever = new CodebaseRetriever();
  
  // Get GitPort for file operations
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for file operations");
  }

  // 1. Load PRD (optional)
  let prd: string | undefined;
  try {
    const source = await getSource(context, gitPort);
    prd = source?.prd || undefined;
  } catch (error) {
    // PRD not found - might be refactor mode without PRD
    prd = undefined;
  }

  // 2. Load directive (optional)
  const directive = await getDirective(context, 'design', gitPort) || undefined;

  // 3. Load previous design (optional)
  const design = await findLatestDesign(context, gitPort) || undefined;

  // 4. Load codebase (conditional on mode - Phase 1: CodebaseRetriever)
  let code: string | undefined;
  let codeHead: string | undefined;
  let profile = undefined;
  
  const needsCodebase = designMode === 'evolution' || designMode === 'refactor';
  
  if (needsCodebase) {
    console.log(`🔍 Retrieving codebase for ${designMode} mode...`);
    
    const codeContext = await retriever.retrieve(
      directive || design || prd || "",
      context.workingDir,
      {
        git: state.deps?.git,
        vectorDB: state.deps?.memory
      },
      {
        maxTokens: 80000,  // ~60KB (smaller for design)
        maxFiles: 25,
        exclude: ['test', 'tests', '__tests__', '*.test.*', '*.spec.*']
      }
    );
    
    console.log(`✅ Strategy: ${codeContext.strategy}, Files: ${codeContext.stats.filesLoaded}, Tokens: ~${codeContext.stats.estimatedTokens}`);
    
    code = codeContext.code;
    codeHead = codeContext.codeHead;
    
    // Analyze codebase
    const analyzer = state.deps?.analyzer;
    if (code && analyzer) {
      try {
        profile = await analyzer.analyze(code, context.workingDir);
        console.log(`📊 Detected: ${profile.language}${profile.framework ? ` + ${profile.framework}` : ''}`);
      } catch (error) {
        console.warn('⚠️  Failed to analyze codebase:', error);
      }
    }
  }

  // Validation based on mode
  if (designMode === 'greenfield' && !prd) {
    throw new Error("Greenfield mode requires PRD document");
  }
  
  if (designMode === 'refactor' && !code) {
    throw new Error("Refactor mode requires existing codebase");
  }

  return {
    ...state,
    prd,
    directive,
    design,
    code,
    codeHead,
    profile,
  };
}

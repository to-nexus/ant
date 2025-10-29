import { getDirective, findLatestDesign } from "../../../utils";
import { ArchitectGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";

/**
 * Code Resolve Node
 * 
 * Phase 1: CodebaseRetriever 사용
 * - Vector DB 기반 관련 코드 검색
 * - Git diff 통합
 * - 토큰 효율적
 * 
 * Strategy:
 * 1. Git diff 있으면 → Git 기반
 * 2. Vector DB 있으면 → Vector 검색
 * 3. Fallback → Keyword 검색
 * 
 * Validation: Must have either design doc OR directive
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations
 */
export async function resolve(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const { context } = state;
  const retriever = new CodebaseRetriever();
  
  // Get GitPort for file operations
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for file operations");
  }

  // 1. Load design document (optional)
  const design = await findLatestDesign(context, gitPort) || undefined;

  // 2. Load directive (optional)
  const directive = await getDirective(context, 'code', gitPort) || undefined;
  
  // Validate: Must have either design doc OR directive
  if (!design && !directive) {
    throw new Error(
      "No design document or directive found.\n" +
      "For new features: Run arch-design first.\n" +
      "For modifications: Provide directive in workspace/{project}/{feature}/inputs/directives/code/directive.md"
    );
  }

  // 3. Retrieve relevant codebase (Phase 1: Smart Retrieval)
  console.log(`🔍 Retrieving relevant codebase...`);
  
  const codeContext = await retriever.retrieve(
    directive || design || "",
    context.workingDir,
    {
      git: state.deps?.git,
      vectorDB: state.deps?.memory
    },
    {
      maxTokens: 100000,  // ~75KB
      maxFiles: 30,
      exclude: ['test', 'tests', '__tests__', '*.test.*', '*.spec.*']
    }
  );

  console.log(`✅ Strategy: ${codeContext.strategy}, Files: ${codeContext.stats.filesLoaded}, Tokens: ~${codeContext.stats.estimatedTokens}`);

  // 4. Analyze codebase profile
  let profile = undefined;
  const analyzer = state.deps?.analyzer;
  
  if (codeContext.code && analyzer) {
    try {
      profile = await analyzer.analyze(codeContext.code, context.workingDir);
      console.log(`📊 Detected: ${profile.language}${profile.framework ? ` + ${profile.framework}` : ''}`);
    } catch (error) {
      console.warn('⚠️  Failed to analyze codebase:', error);
    }
  }

  return {
    ...state,
    directive,
    design,
    code: codeContext.code,
    codeHead: codeContext.codeHead,
    profile,
  };
}

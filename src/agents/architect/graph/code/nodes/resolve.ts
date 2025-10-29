import { getDirective, findLatestDesign } from "../../../utils";
import { ArchitectGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";
import * as path from "path";

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

  // 0. Validate workspace exists
  const workspacePath = path.join("workspace", context.project);
  const workspaceExists = await gitPort.fileExists(workspacePath);
  
  if (!workspaceExists) {
    throw new Error(
      `Workspace not found: ${workspacePath}\n\n` +
      `Please create workspace first:\n` +
      `  npm run init:workspace ${context.project}\n\n` +
      `Then prepare your inputs in:\n` +
      `  workspace/${context.project}/${context.featureFolder}/inputs/`
    );
  }

  // Validate feature exists
  const featurePath = path.join("workspace", context.project, context.featureFolder);
  const featureExists = await gitPort.fileExists(featurePath);
  
  if (!featureExists) {
    throw new Error(
      `Feature directory not found: ${featurePath}\n\n` +
      `Please create feature first:\n` +
      `  npm run init:feature ${context.project} ${context.featureFolder}\n\n` +
      `Then prepare your inputs in:\n` +
      `  workspace/${context.project}/${context.featureFolder}/inputs/`
    );
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

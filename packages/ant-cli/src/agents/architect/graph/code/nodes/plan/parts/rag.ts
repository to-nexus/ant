/**
 * plan/parts/rag.ts — RAG orchestration for STEP 0.8~STEP 2.5.
 *
 * Responsibilities:
 *   - STEP 0.8 — directory tree (early, for keyword LLM).
 *   - STEP 1   — task-specific keyword generation.
 *   - STEP 2   — combine code context (Vector DB + Git + Local + references).
 *   - STEP 2.5 — ensure `codeContext` always exists (empty fallback).
 *
 * Returns `{ codeContext, referenceCodeContexts, lessons, taskKeywords,
 * directoryTree }` — a LOCAL bundle for the plan LLM. Callers consume it
 * inline for prompt rendering; no state channel receives any of these
 * fields. RAG is scoped to one task-entry snapshot; execute reads files
 * on demand through tool calls.
 */

import type { LLMClient } from '../../../../../../../core/ports';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { combineCodeContext, TaskKeywords } from '../combineCodeContext';
import { generateTaskKeywords, displayKeywords, logKeywords } from '../keywordGeneration';
import { loadReferenceContexts } from '../referenceLoader';
import { extractFilesFromViolations } from '../../../utils/violationFormatter';

export interface PlanRagResult {
  codeContext: any;
  referenceCodeContexts: any[];
  lessons: any[];
  taskKeywords: TaskKeywords;
  directoryTree: string | undefined;
}

const EMPTY_CONTEXT = {
  source: 'plan' as const,
  filePaths: [] as string[],
  files: [] as any[],
  stats: {
    filesLoaded: 0,
    stackTraceCount: 0,
    semanticCount: 0,
    deduplicatedCount: 0,
    estimatedTokens: 0,
  },
};

async function buildDirectoryTree(state: ArchitectGraphState): Promise<string | undefined> {
  const planFileSystem = state.deps?.fileSystem;
  if (!planFileSystem) return undefined;
  try {
    const { generateDirectoryTree } = await import('../combineCodeContext');
    const tree = await generateDirectoryTree(planFileSystem, 4);
    if (tree) console.log(`📂 [Plan] Directory tree generated early for keyword LLM`);
    return tree;
  } catch {
    return undefined;
  }
}

async function resolveKeywords(
  state: ArchitectGraphState,
  nextTask: CodeTask,
  llm: LLMClient | undefined,
  directoryTree: string | undefined,
  isRetry: boolean,
  skipKeywordAndRAG: boolean,
): Promise<TaskKeywords> {
  if (isRetry || skipKeywordAndRAG) {
    const errorFilesFromViolations = isRetry ? extractFilesFromViolations(state.violations) : [];
    if (errorFilesFromViolations.length > 0) {
      console.log(`🔄 [Plan] Retry: extracted ${errorFilesFromViolations.length} error file(s) from violations`);
      errorFilesFromViolations.forEach(f => console.log(`   - ${f}`));
    } else {
      console.log(`🔄 [Plan] Retry: no error files in violations, skipping keyword generation`);
    }
    return {
      errorFiles: errorFilesFromViolations,
      keywords: [],
      requiredFiles: [],
      references: new Map<string, string[]>(),
    };
  }

  if (llm) {
    console.log(`🔑 [Plan] Generating search keywords...`);
    const generatedKeywords = await generateTaskKeywords(llm, nextTask, state, directoryTree);

    const errorFilesFromViolations = extractFilesFromViolations(state.violations);
    if (errorFilesFromViolations.length > 0) {
      console.log(`🔍 [Plan] Merging ${errorFilesFromViolations.length} file(s) from violations:`);
      errorFilesFromViolations.forEach(f => console.log(`   - ${f}`));
    }

    const merged: TaskKeywords = {
      errorFiles: [...errorFilesFromViolations, ...generatedKeywords.errorFiles],
      keywords: generatedKeywords.keywords,
      requiredFiles: generatedKeywords.requiredFiles,
      references: generatedKeywords.references,
    };

    await displayKeywords(merged);
    logKeywords(merged);
    return merged;
  }

  return {
    errorFiles: extractFilesFromViolations(state.violations),
    keywords: [],
    requiredFiles: [],
    references: new Map<string, string[]>(),
  };
}

/**
 * Run the RAG pipeline for a plan-node entry. The orchestrator passes the
 * bundle straight into the plan-LLM phase; empty results are safe (the
 * plan LLM will simply see an empty context block).
 */
export async function runPlanRAG(
  state: ArchitectGraphState,
  entry: {
    nextTask: CodeTask;
    isRetry: boolean;
    skipKeywordAndRAG: boolean;
  },
): Promise<PlanRagResult> {
  const llm = state.deps?.llm as LLMClient | undefined;
  const directoryTree = await buildDirectoryTree(state);
  const taskKeywords = await resolveKeywords(
    state,
    entry.nextTask,
    llm,
    directoryTree,
    entry.isRetry,
    entry.skipKeywordAndRAG,
  );

  let codeContext: any = undefined;
  let referenceCodeContexts: any[] = [];
  let lessons: any[] = [];

  const retriever = state.deps?.retriever;
  const vectorDB = state.deps?.vectorDB;
  const git = state.deps?.git;

  if (retriever && vectorDB && git && !entry.skipKeywordAndRAG) {
    const combinedResult = await combineCodeContext(
      taskKeywords,
      state,
      retriever,
      vectorDB,
      git,
      directoryTree,
    );
    if (combinedResult) {
      codeContext = combinedResult.context;
      lessons = combinedResult.lessons || [];
    }

    if (codeContext && state.referenceRequests && state.referenceRequests.length > 0) {
      const { extractFilesFromCode } = await import('../utils');
      referenceCodeContexts = await loadReferenceContexts(
        state,
        taskKeywords,
        retriever,
        vectorDB,
        git,
        extractFilesFromCode,
      );
    }
  }

  if (!codeContext) {
    codeContext = { ...EMPTY_CONTEXT };
    console.log(`   ℹ️  No files loaded - using empty codeContext`);
  }

  return {
    codeContext,
    referenceCodeContexts,
    lessons,
    taskKeywords,
    directoryTree,
  };
}

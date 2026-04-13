/**
 * Prompt Building for Execute Node
 * 
 * ✅ Supports Anthropic Prompt Caching for cost reduction:
 * - System prompts, rules, profiles (cached)
 * - Project context, design docs (cached)
 * - Current task, user directive (not cached - changes frequently)
 */

import { createHash } from "crypto";
import { ArchitectGraphState } from "../../state";
import { TokenBudgetManager } from "../../../../../../core/utils/tokenBudget";
import { formatViolations } from "../shared/violationFormatter";
import { CacheableContent, MessageContentBlock } from "../../../../../../core/ports/llm";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { collectResolvedPartials } from "../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";
import { cleanFileContentFromResponse } from "../../utils/responseCleaners";
import { ProjectCodeContext } from "../plan/combineCodeContext";
import { resolveArtifacts, ArtifactPoolView } from "../../../../../../core/prompt/builder/ArtifactPipeline";
import { effectiveTechTier, getRACDocuments, type ResolvedArtifact } from "@ant/shared";
import { PromptBuilder } from "../../../../../../core/prompt/builder/PromptBuilder";
import { deriveArtifactPolicies } from "../../../../../../core/prompt/builder/ArtifactRoleResolver";
import type { PromptBuildConfig } from "../../../../../../core/prompt/builder/PromptBuildConfig";
import { buildCacheableBlocks } from "../../../../../../core/prompt/builder/CacheBlockMapper";
import { composeMessages } from "../../../../../../core/utils/messageComposer";
import { formatGitDiffForPrompt } from "../../../../../../core/codebase/GitDiffSummary";

let _lastCacheBlockHashes: { block1?: string; block2?: string; taskId?: string } = {};

/**
 * Build messages for LLM using PromptEngine with Prompt Caching
 * 
 * ✅ Caching Strategy:
 * 1. System prompt + rules + profiles (cached - rarely changes)
 * 2. Project code context + design doc (cached - changes per task)
 * 3. Current task + directive (not cached - changes every turn)
 */
export async function buildMessages(state: ArchitectGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  
  // planText check (empty is normal for verification and explain tasks)
  if (state.planText) {
    console.log(`🔍 [Execute] planText: ${state.planText.length} chars`);
  } else {
    const taskType = state.currentTask?.type || 'unknown';
    const priority = state.currentTask?.priority;
    const isExpected = priority === 1000 || taskType === 'verification' || taskType === 'error' || taskType === 'test-code' || taskType === 'doc' || taskType === 'explain' || taskType === 'ui' || taskType === 'design-system';
    if (!isExpected) {
      console.warn(`⚠️  [Execute] planText is empty (task: ${taskType}, priority: ${priority})`);
    }
  }
  
  if (!state.currentTask) {
    throw new Error('[Execute] currentTask is required but not available in state');
  }
  
  // Pass RAG-loaded file content directly to the prompt.
  // Staleness is handled by edit_file's search/replace validation against disk.
  // System prompt content is cached (cache_control: ephemeral), making this
  // more token-efficient than stripping content and forcing read_file tool calls.
  // When total content exceeds CODE_CONTEXT_THRESHOLD, compact to skeleton mode.
  const executeProjectCodeContext = state.projectCodeContext
    ? compactProjectCodeContext(
        state.projectCodeContext as ProjectCodeContext,
        state.techTier?.language,
      )
    : undefined;

  const taskTechTiers = state.currentTask.techTiers ?? (state.techTier ? [state.techTier] : []);
  const contextWithTechTier = {
    ...state.context,
    techTier: effectiveTechTier(taskTechTiers),
    techTiers: taskTechTiers,
  };
  
  const isVerificationTask = state.currentTask.type === 'verification';
  const isErrorTask = state.currentTask.type === 'error';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Artifact selection via ArtifactPipeline
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const poolView = new ArtifactPoolView(state.artifacts || []);
  const pool = poolView.all;

  const hasExplicitDocs = state.resolvedAction?.source === 'explicit'
    && ((state.resolvedAction?.artifacts?.length ?? state.resolvedAction?.documents?.length ?? 0) > 0);

  let resolvedActionWithDocs = state.resolvedAction;
  if (!hasExplicitDocs) {
    const inferred = resolveArtifacts(pool,
      { taskType: state.currentTask.type, include: state.currentTask.include },
      { threshold: 30_000 });

    if (inferred.length > 0) {
      resolvedActionWithDocs = {
        ...(state.resolvedAction || { source: 'infer' as const, mode: 'generate' as const, tech: {}, hasExplicitFields: false }),
        artifacts: inferred,
        documents: inferred,
      };
      const totalChars = inferred.reduce((s, a) => s + (a.content?.length || 0), 0);
      console.log(`📄 [Execute] Pipeline: ${pool.length} pool → ${inferred.length} selected (${totalChars.toLocaleString()} chars, include=${JSON.stringify(state.currentTask.include ?? 'default')})`);
    }
  }

  const { ARTIFACT_PREFIX: AP } = await import('@ant/shared');
  const hasUiArtifacts = getRACDocuments(resolvedActionWithDocs).some(
    a => a.path.startsWith(AP.UI),
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build prompt via PromptBuilder (4-tier injection resolution)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const taskType = state.currentTask.type;
  const isTestCode = taskType === 'test-code';
  const isDoc = taskType === 'doc';
  const skipHeavyContext = isVerificationTask || isTestCode || isDoc || isErrorTask;

  const intent = state.resolvedAction?.intent;
  const effectiveTier = effectiveTechTier(taskTechTiers);

  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Execute] PromptBuilder is required but not available in state.deps');

  // Determine template paths (mirrors PromptResolver logic)
  let templateBase: string;
  let templateRules: string;
  const executeTasksPrefix = 'code/phases/execute/tasks';
  if (isVerificationTask) {
    templateBase = `${executeTasksPrefix}/verification/base`;
    templateRules = `${executeTasksPrefix}/verification/rules`;
  } else if (isErrorTask) {
    templateBase = `${executeTasksPrefix}/error/base`;
    templateRules = `${executeTasksPrefix}/error/rules`;
  } else if (isTestCode) {
    templateBase = `${executeTasksPrefix}/test-code/base`;
    templateRules = `${executeTasksPrefix}/test-code/rules`;
  } else if (isDoc) {
    templateBase = `${executeTasksPrefix}/docgen/base`;
    templateRules = `${executeTasksPrefix}/docgen/rules`;
  } else {
    templateBase = 'code/phases/execute/base';
    templateRules = 'code/phases/execute/rules';
  }

  // Pre-format injection data
  const formattedGitDiff = executeProjectCodeContext?.gitDiff
    ? formatGitDiffForPrompt(executeProjectCodeContext.gitDiff)
    : '';
  const formattedLessons = formatLessonsForPrompt(state.lessons);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build runtime context → vars.runtimeContext (rendered into Block 3 via base template)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const runtimeContextParts: string[] = [];

  if (state.violations && state.violations.length > 0) {
    const violationsText = state.violationMessage || formatViolations(state.violations);
    runtimeContextParts.push(
      `──────────────────────────────────────────────────────────────\n` +
      `⚠️  PREVIOUS ATTEMPT FAILED - FIX REQUIRED\n` +
      `──────────────────────────────────────────────────────────────\n\n` +
      `${violationsText}\n\n` +
      `Focus on fixing the root cause, not workarounds.\n\n` +
      `──────────────────────────────────────────────────────────────`,
    );
  }

  const runtimeContext = buildRuntimeContext(state);
  if (runtimeContext) runtimeContextParts.push(runtimeContext);

  const config: PromptBuildConfig = {
    templates: {
      base: templateBase,
      rules: templateRules,
      system: 'code/base/system',
    },
    intent,
    artifactPolicies: intent
      ? deriveArtifactPolicies(intent, getRACDocuments(resolvedActionWithDocs))
      : [],
    techContext: {
      techTier: effectiveTier,
      techTiers: taskTechTiers,
      taskType,
      mode: state.resolvedAction?.mode,
      resolvedAction: resolvedActionWithDocs,
    },
    pipeline: {
      sanitizeInput: true,
      includeTechProfile: true,
      includeExamples: !skipHeavyContext && taskType !== 'setup',
      applyPolicyGuardrails: true,
      formatForLLM: true,
    },
    artifacts: getRACDocuments(resolvedActionWithDocs),
    vars: {
      currentTask: state.currentTask ? {
        name: state.currentTask.name,
        type: state.currentTask.type,
        priority: state.currentTask.priority,
        description: state.currentTask.description,
      } : null,
      directive: isVerificationTask ? '' : (state.directive || ''),
      modificationMode: executeProjectCodeContext?.files && executeProjectCodeContext.files.length > 0
        ? 'MODIFICATION MODE: Modify existing code'
        : 'CREATION MODE: Build from scratch',
      referenceRequests: state.referenceRequests || [],
      hasUiInDocuments: getRACDocuments(resolvedActionWithDocs).some(
        d => d.path?.startsWith(AP.UI) || d.path?.includes('ui-'),
      ),
      isSpecDriven: !!state.selectedSpec,
      figmaAvailable: (state.figmaAvailable && !poolView.hasUi()) || false,
      figmaStartNodeId: state.figmaStartNodeId || undefined,
      runtimeContext: runtimeContextParts.join('\n\n'),

      // Injection-specific vars (pre-formatted)
      gitDiff: formattedGitDiff,
      files: executeProjectCodeContext?.files || [],
      filePaths: executeProjectCodeContext?.filePaths || [],
      stats: executeProjectCodeContext?.stats,
      projectCodeContext: executeProjectCodeContext,
      hasProjectCode: !!(executeProjectCodeContext?.files && executeProjectCodeContext.files.length > 0),
      contexts: state.referenceCodeContexts || [],
      referenceCodeContexts: state.referenceCodeContexts || [],
      lessons: formattedLessons,
      content: formattedLessons, // for memory.md
      sessionContext: state.sessionContext ? formatSessionContextForPrompt(state.sessionContext) : '',
      retryContext: null,
      resolvedAction: resolvedActionWithDocs || null,
      userLanguage: state.context?.userLanguage || 'en',
      filteredCatalog: undefined,
      hasRuntimeError: state.directive ? containsRuntimeErrorPattern(state.directive) : false,
      hasMissingDependency: false,
    },
  };

  const promptResult = await promptBuilder.build(config);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Additional context parts for Block 2
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const foundationContract = isVerificationTask ? null : await buildFoundationContract(state);
  const schemaAnchor = isVerificationTask ? null : await buildSchemaAnchor(state);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UI Images (NOT CACHED - multimodal blocks)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const uiImageBlocks: CacheableContent[] = [];
  try {
    const llmProvider = state.deps?.llm?.provider;
    const canSendImages = llmProvider === 'anthropic';

    if (hasUiArtifacts && canSendImages && state.deps?.fileSystem) {
      const uiReferenceImages = await ArtifactService.loadUiReferenceImages(state.context, state.deps.fileSystem);
      
      if (uiReferenceImages) {
        const fs = await import('fs');
        const path = await import('path');

        const rootPath = state.deps.fileSystem.getRootPath();

        const maxImages = parseInt(process.env.ANT_UI_IMAGE_MAX || '4', 10);
        const maxBytesPerImage = parseInt(process.env.ANT_UI_IMAGE_MAX_BYTES || `${2 * 1024 * 1024}`, 10);
        const maxTotalBytes = parseInt(process.env.ANT_UI_IMAGE_TOTAL_MAX_BYTES || `${8 * 1024 * 1024}`, 10);

        const candidates: string[] = uiReferenceImages
          .filter(Boolean)
          .map(p => (typeof p === 'string' ? p.replace(/\\/g, '/') : p))
          .filter(p => !p.includes('/.gitkeep') && !p.endsWith('/.gitkeep'));

        let totalBytes = 0;

        if (candidates.length > 0) {
          const previewList = candidates.slice(0, maxImages).map(p => `- ${p}`).join('\n');
          uiImageBlocks.push({
            type: 'text',
            text:
              `# UI Reference Images\n` +
              `The following image blocks are screenshots/component states from \`inputs/references\`.\n` +
              `Use them to match layout/spacing/visual states.\n` +
              `IMPORTANT: Treat these as reference only. Do NOT assume these files are available in the app runtime (e.g. not copied into \`public/\` automatically).\n` +
              `If the implementation needs runtime images/icons, either (a) generate placeholders in the codebase or (b) require explicit instructions in \`outputs/design/ui/ui-assets.json\` (including destination paths).\n\n` +
              `${previewList}\n`
          });
        }

        for (const rel of candidates) {
          if (uiImageBlocks.filter(b => (b as any).type === 'image').length >= maxImages) break;

          const abs = path.resolve(rootPath, rel);
          if (!abs.startsWith(rootPath)) continue;
          if (!fs.existsSync(abs)) continue;

          const stat = fs.statSync(abs);
          if (stat.size > maxBytesPerImage) {
            console.log(`⚠️  [UI Images] Skip (too large): ${rel} (${stat.size} bytes)`);
            continue;
          }
          if (totalBytes + stat.size > maxTotalBytes) {
            console.log(`⚠️  [UI Images] Skip (total budget exceeded): ${rel}`);
            continue;
          }

          const ext = path.extname(abs).toLowerCase();
          const mediaType =
            ext === '.png' ? 'image/png' :
            (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' :
            ext === '.webp' ? 'image/webp' :
            ext === '.gif' ? 'image/gif' :
            null;

          if (!mediaType) continue;

          const data = fs.readFileSync(abs).toString('base64');
          totalBytes += stat.size;

          uiImageBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as any,
              data
            }
          });
        }

        if (uiImageBlocks.some(b => (b as any).type === 'image')) {
          console.log(`🖼️  [UI Images] Injected ${uiImageBlocks.filter(b => (b as any).type === 'image').length} image(s) (total=${totalBytes} bytes)`);
        }
      }
    }
  } catch (e) {
    console.warn(`⚠️  [UI Images] Failed to build image blocks (non-fatal):`, e);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Assemble blocks via CacheBlockMapper
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const preflightManager = new TokenBudgetManager();
  const blocks = buildCacheableBlocks(promptResult, {
    contextParts: [foundationContract, schemaAnchor].filter(Boolean) as string[],
    mediaBlocks: uiImageBlocks.length > 0 ? uiImageBlocks : undefined,
    tokenPreflight: {
      maxBlock2Tokens: preflightManager.getAreaBudgets().projectContext,
      estimateTokens: (t) => preflightManager.estimateTokens(t),
    },
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Cache stability check
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const currentTaskId = state.currentTask?.id || 'unknown';
    if (_lastCacheBlockHashes.taskId !== currentTaskId) {
      _lastCacheBlockHashes = { taskId: currentTaskId };
    }

    const block1Text = blocks[0]?.type === 'text' ? blocks[0].text : '';
    const block2Text = blocks[1]?.type === 'text' ? blocks[1].text : '';
    const b1Hash = createHash('md5').update(block1Text).digest('hex').slice(0, 12);
    const b2Hash = createHash('md5').update(block2Text).digest('hex').slice(0, 12);
    const b1Len = block1Text.length;
    const b2Len = block2Text.length;
    const histLen = state.conversationHistory?.length || 0;

    if (_lastCacheBlockHashes.block1 && _lastCacheBlockHashes.block1 !== b1Hash) {
      console.warn(`⚠️  [CacheStability] Block1 CHANGED between calls! prev=${_lastCacheBlockHashes.block1} curr=${b1Hash} len=${b1Len} (task=${currentTaskId}, hist=${histLen})`);
      if (state.context?.featurePath && state._httpJobId) {
        import('../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
          getExecutionLogger({ featurePath: state.context!.featurePath!, jobId: state._httpJobId!, jobType: 'code' })
            .logCacheInstability(currentTaskId, { block: 'block1', prevHash: _lastCacheBlockHashes.block1!, currHash: b1Hash, contentLength: b1Len, historyLength: histLen })
            .catch(() => {});
        }).catch(() => {});
      }
    }
    if (_lastCacheBlockHashes.block2 && _lastCacheBlockHashes.block2 !== b2Hash) {
      console.warn(`⚠️  [CacheStability] Block2 CHANGED between calls! prev=${_lastCacheBlockHashes.block2} curr=${b2Hash} len=${b2Len} (task=${currentTaskId}, hist=${histLen})`);
      if (state.context?.featurePath && state._httpJobId) {
        import('../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
          getExecutionLogger({ featurePath: state.context!.featurePath!, jobId: state._httpJobId!, jobType: 'code' })
            .logCacheInstability(currentTaskId, { block: 'block2', prevHash: _lastCacheBlockHashes.block2!, currHash: b2Hash, contentLength: b2Len, historyLength: histLen })
            .catch(() => {});
        }).catch(() => {});
      }
    }

    if (histLen === 0) {
      console.log(`🔑 [CacheStability] New task → Block1=${b1Hash}(${b1Len}) Block2=${b2Hash}(${b2Len})`);
    }
    _lastCacheBlockHashes = { block1: b1Hash, block2: b2Hash, taskId: currentTaskId };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Compose messages via MessageComposer
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { messages } = composeMessages({
    initialBlocks: blocks,
    priorTurns: state.conversationHistory,
    cleanAssistantContent: cleanFileContentFromResponse,
    budgetRecovery: {
      aggressiveParams: { microcompactHotTail: 1, autoCompactThreshold: 20000, autoCompactHotTail: 1 },
      stubBlockIndex: 1,
      stubText: '[Project context omitted to fit token budget — use read_file and search_code tools to access codebase]',
    },
  });

  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      const totalPromptLength = messages.reduce((sum: number, m: any) => {
        if (Array.isArray(m.content)) {
          return sum + m.content.reduce((s: number, c: any) => s + (c.type === 'text' ? c.text.length : 0), 0);
        }
        return sum + (typeof m.content === 'string' ? m.content.length : 0);
      }, 0);
      
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'execute-fullMessage',
        totalPromptLength,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          callIndex: state._executeCallIndex,
          templatePath: state.currentTask?.type === 'verification' ? 'code/phases/execute/tasks/verification/base'
            : state.currentTask?.type === 'error' ? 'code/phases/execute/tasks/error/base'
            : 'code/phases/execute/base',
          usedTemplates: [
            templateBase,
            templateRules,
            ...promptResult.injections,
          ].filter(Boolean),
          resolvedPartials: collectResolvedPartials([
            templateBase,
            templateRules,
          ].filter(Boolean)),
          injectedVariables: {
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            artifactPool: pool.length,
            artifactsSelected: getRACDocuments(resolvedActionWithDocs).length,
            include: state.currentTask?.include || undefined,
            packages: state.currentTask?.packages || undefined,
            planText: state.planText ? `[${state.planText.length} chars]` : undefined,
            detectedMode: state.resolvedAction?.mode,
            taskType: state.currentTask?.type,
            projectCodeContextFiles: executeProjectCodeContext?.files?.length || 0,
            projectCodeContextFilePaths: executeProjectCodeContext?.filePaths?.length || 0,
            referenceCodeContexts: state.referenceCodeContexts?.length || 0,
            uiImageBlocksCount: uiImageBlocks.filter(b => (b as any).type === 'image').length,
            hasViolations: !!(state.violations?.length),
            violationsCount: state.violations?.length || 0,
            messageCount: messages.length,
            conversationHistoryLength: state.conversationHistory?.length || 0,
            runtimeAssetsCount: state.runtimeAssetsIndex?.count || 0,
            profileLanguage: state.techTier?.language || null,
            profileFramework: state.techTier?.framework || null,
            profilesLoaded: !!promptResult.sections.profiles,
            failedTemplates: promptResult.sections.failedTemplates.length > 0 ? promptResult.sections.failedTemplates : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Execute] Failed to log prompt:`, logError);
    }
  }

  return messages;
}

/**
 * Build runtime context (task, plan, enforcement, file tree)
 * 
 * CRITICAL: This is appended to EVERY user message, even during tool call loops!
 * This ensures task constraints (especially setup task restrictions) are always visible.
 */
export function buildRuntimeContext(state: ArchitectGraphState): string {
  const lines: string[] = [];
  
  
  if (state.currentTask) {
    lines.push(`# Current Task`);
    lines.push(`**${state.currentTask.name}**`);
    lines.push(``);
    
    const isDiagnosticTask = state.currentTask.type === 'verification' || state.currentTask.type === 'error';

    // Safety guard: detect batched planText that leaked through processDiagnosticBatchSplit failure.
    // If the plan contains a `batches` array, it was meant to be split into sub-tasks, not executed directly.
    // Log INVARIANT VIOLATION but do NOT modify the planText — silent fallbacks mask bugs.
    if (state.planText && isDiagnosticTask) {
      try {
        const stripped = state.planText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
        const parsed = JSON.parse(stripped);
        if (parsed.batches && Array.isArray(parsed.batches) && parsed.batches.length > 1) {
          console.error(`❌ [Execute] INVARIANT VIOLATION: Batched planText leaked to execute (${parsed.batches.length} batches). processDiagnosticBatchSplit should have split this. planRouter should have routed to checkTaskStatus. This is a system bug.`);
        }
      } catch { /* not valid JSON — proceed normally */ }
    }

    if (state.planText) {
      lines.push(`**Goal**: ${state.currentTask.description}`);
      lines.push(``);
      
      const planLabel = isDiagnosticTask
        ? `📋 REMEDIATION PLAN (Structured JSON - FOLLOW EXACTLY)`
        : `📋 IMPLEMENTATION PLAN (Structured JSON - FOLLOW EXACTLY)`;
      const planDescription = isDiagnosticTask
        ? `The following JSON contains the diagnostic analysis and fix instructions.\n- \`diagnostics\`: Build/test error analysis\n- \`modify\`: Files to modify with specific fixes\n- \`create\`: Files to create (if any)\n- \`delete\`: Files to delete (if any)`
        : `The following JSON contains the exact implementation instructions.\n- \`prescribedPackages\`: External dependencies with discovered API signatures — MUST import and call these APIs in the files listed in \`usedBy\`\n- \`create\`: Files to create with integration points\n- \`modify\`: Files to modify with specific changes\n- \`assets\`: Asset copy operations (source → destination)`;
      
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(planLabel);
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(``);
      lines.push(planDescription);
      lines.push(``);
      lines.push('```json');
      lines.push(state.planText);
      lines.push('```');
      lines.push(``);
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(``);
    } else if (state.currentTask.type === 'verification') {
      // Verification task with empty planText = build/test passed, no fixes needed
      lines.push(state.currentTask.description);
      lines.push(``);
      lines.push(`**Build/test passed successfully. No code changes needed. Output \`<done>true</done>\` immediately.**`);
      lines.push(``);
    } else if (state.currentTask.type === 'error' && !state.planText) {
      // Error task with empty planText = investigation found no issues
      lines.push(state.currentTask.description);
      lines.push(``);
      lines.push(`**Error investigation found no code changes needed. Output \`<done>true</done>\` immediately.**`);
      lines.push(``);
    } else {
      // No plan available (explain tasks OR state propagation failure)
      lines.push(state.currentTask.description);
      lines.push(``);
    }
  }

  // ✅ Runtime assets reminder (text-only, small)
  if (state.runtimeAssetsIndex?.count && state.runtimeAssetsIndex.count > 0) {
    const idx = state.runtimeAssetsIndex;
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📦 Available Assets (inputs/assets)`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`Check if this task needs any assets from the list below.`);
    lines.push(`If needed: SVG (.svg) → copy to codebase/src/assets/ and import as React component (SVGR).`);
    lines.push(`Raster (png, jpg, webp) → copy to codebase/public/ and use framework image component.`);
    lines.push(``);
    if (state.context?.featurePath) {
      lines.push(`Source: ${state.context.featurePath.replace(/\\/g, '/')}/inputs/assets/`);
    }
    lines.push(`SVG destination: codebase/src/assets/ (SVGR import — webpack processes source tree only)`);
    lines.push(`Raster destination: codebase/public/ (URL reference via framework image component)`);
    lines.push(``);
    lines.push(`Available files (${idx.count} total):`);
    idx.files.slice(0, 20).forEach((f) => lines.push(`  - ${f}`));
    if (idx.count > 20) lines.push(`  ... and ${idx.count - 20} more`);
    lines.push(``);
  }
  
  // Note: Violations are injected at the top of prompt, not here
  
  // ✅ Session File Manifest: Show files created by OTHER parallel workers
  // This gives the LLM awareness of cross-worker files without requiring read_file.
  // Own files are already visible via generateFileTree() (projectCodeContext.filePaths accumulation).
  const otherWorkerFiles = state._otherWorkerFiles;
  if (otherWorkerFiles && otherWorkerFiles.length > 0) {
    const MAX_MANIFEST_ENTRIES = 40;
    const filesToShow = otherWorkerFiles.slice(0, MAX_MANIFEST_ENTRIES);
    
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📋 Files Created by Parallel Tasks`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
    lines.push(`The following files were created by other tasks running in parallel with yours.`);
    lines.push(`Do NOT create duplicates. If you need to import from or extend these files, use \`read_file\` to check their content first.`);
    lines.push(``);
    
    // Group by task name for readability
    const byTask = new Map<string, string[]>();
    for (const f of filesToShow) {
      const taskKey = f.taskName || 'unknown';
      if (!byTask.has(taskKey)) byTask.set(taskKey, []);
      byTask.get(taskKey)!.push(f.path);
    }
    
    for (const [taskName, paths] of byTask) {
      lines.push(`**${taskName}**:`);
      for (const p of paths) {
        lines.push(`  - ${p}`);
      }
    }
    
    if (otherWorkerFiles.length > MAX_MANIFEST_ENTRIES) {
      lines.push(``);
      lines.push(`... and ${otherWorkerFiles.length - MAX_MANIFEST_ENTRIES} more files`);
    }
    lines.push(``);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
  }

  const dirTree = state.projectCodeContext?.directoryTree;
  if (dirTree && (state.currentTask?.type === 'verification' || state.currentTask?.type === 'doc')) {
    lines.push('════════════════════════════════════════════════════════════════════════════════');
    lines.push('🗂️ Codebase Directory Structure (pre-loaded — do NOT list_files)');
    lines.push('════════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(dirTree);
    lines.push('');
  }

  const fileTree = generateFileTree(state);
  if (fileTree) {
    lines.push(fileTree);
    lines.push(``);
  }
  
  return lines.join('\n');
}

/**
 * Generate file tree for context.
 *
 * Splits files into two groups based on actual content availability:
 * - "loaded" files (content present) → do NOT re-read
 * - "path only" files (no content)  → read_file when needed for modification
 *
 * This must mirror the labels in retrieved-code.md to avoid prompt contradictions.
 */
export function generateFileTree(state: ArchitectGraphState): string | null {
  const filePaths = state.projectCodeContext?.filePaths || [];

  if (filePaths.length === 0) {
    console.log(`📊 [PromptBuilder] generateFileTree: null (filePaths empty)`);
    return null;
  }
  console.log(`📊 [PromptBuilder] generateFileTree: ${filePaths.length} filePaths`);

  const loadedFiles = state.projectCodeContext?.files || [];
  const contentLoadedSet = new Set(
    loadedFiles
      .filter(f => f.content && f.content.length > 0)
      .map(f => f.path)
  );

  const loaded: string[] = [];
  const pathOnly: string[] = [];
  for (const fp of filePaths) {
    if (contentLoadedSet.has(fp)) {
      loaded.push(fp);
    } else {
      pathOnly.push(fp);
    }
  }

  const lines: string[] = [];

  if (loaded.length > 0) {
    lines.push('════════════════════════════════════════════════════════════════════════════════');
    lines.push('📋 Files Loaded with Content (do NOT re-read)');
    lines.push('════════════════════════════════════════════════════════════════════════════════');
    lines.push('These files are already loaded above with full content. Do NOT call read_file on them.');
    lines.push('');
    appendTree(lines, loaded);
  }

  if (pathOnly.length > 0) {
    lines.push('════════════════════════════════════════════════════════════════════════════════');
    lines.push('📂 Existing Files (DO NOT recreate — use read_file + <edit> to modify)');
    lines.push('════════════════════════════════════════════════════════════════════════════════');
    lines.push('These files already exist on disk. Do NOT output <file> tags for these paths.');
    lines.push('To change them, use read_file first, then <edit>.');
    lines.push('');
    appendTree(lines, pathOnly);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function appendTree(lines: string[], paths: string[]): void {
  const dirs: Record<string, string[]> = {};
  for (const file of paths) {
    const parts = file.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const filename = parts[parts.length - 1];
    if (!dirs[dir]) dirs[dir] = [];
    dirs[dir].push(filename);
  }
  for (const [dir, filenames] of Object.entries(dirs).sort()) {
    lines.push(`📁 ${dir}/`);
    for (const filename of filenames.sort()) {
      lines.push(`   📄 ${filename}`);
    }
    lines.push('');
  }
}

/**
 * Build Foundation Contract: exported symbol summary from completed foundation task files.
 * Injected into feature tasks so they discover shared utilities and avoid duplicate definitions.
 * Active only in parallel mode (SharedFileBuffer provides cross-worker file info).
 */
async function buildFoundationContract(state: ArchitectGraphState): Promise<string | null> {
  const otherWorkerFiles = state._otherWorkerFiles;
  if (!otherWorkerFiles || otherWorkerFiles.length === 0) return null;

  const completedTasks = state.completedTasksDetails || [];
  const foundationTasks = completedTasks.filter(t => t.priority >= 200 && t.priority <= 299);
  if (foundationTasks.length === 0) return null;

  const foundationTaskNames = new Set(foundationTasks.map(t => t.name));
  const foundationFiles = otherWorkerFiles.filter(
    f => f.taskName && foundationTaskNames.has(f.taskName)
  );
  if (foundationFiles.length === 0) return null;

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return null;

  const language = state.techTier?.language;

  const sections: string[] = [];
  sections.push('# Foundation Contract (read-only, do NOT modify these files)\n');
  sections.push('The following symbols were defined by the shared foundation task.');
  sections.push('Import and use them — do NOT redefine or create alternatives.\n');

  let symbolCount = 0;

  for (const file of foundationFiles) {
    try {
      const content = await fileSystem.readFile(file.path);
      if (!content) continue;

      const symbols = extractExportedSymbols(content, language);
      if (symbols.length === 0) continue;

      sections.push(`### ${file.path}`);
      for (const sym of symbols) {
        sections.push(`  - ${sym}`);
      }
      sections.push('');
      symbolCount += symbols.length;
    } catch {
      // Non-fatal: skip files that can't be read
    }
  }

  if (symbolCount === 0) return null;

  const result = sections.join('\n');
  console.log(`📋 [Execute] Foundation contract: ${foundationFiles.length} file(s), ${symbolCount} symbol(s), ${result.length} chars`);
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Project Code Context Compaction
// Mirrors Design job's buildCompactedSourceDocs pattern:
// when total content exceeds threshold, switch to skeleton mode
// (signatures + line counts) and let LLM use read_file on demand.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CODE_CONTEXT_THRESHOLD = 200_000; // chars (~70K tokens at 2.8 ratio)

/**
 * Compact projectCodeContext when total content exceeds threshold.
 * Priority-based: error-source files keep full content, others get skeleton.
 * Two-pass budget redistribution inspired by sourceSelector.ts.
 */
function compactProjectCodeContext(
  context: ProjectCodeContext,
  language?: string,
): ProjectCodeContext {
  if (!context.files || context.files.length === 0) return context;

  const totalChars = context.files.reduce((sum, f) => sum + (f.content?.length || 0), 0);
  if (totalChars <= CODE_CONTEXT_THRESHOLD) return context;

  console.log(`📦 [CodeContext] Compacting: ${totalChars.toLocaleString()} chars > ${CODE_CONTEXT_THRESHOLD.toLocaleString()} threshold (${context.files.length} files)`);

  const errorSourcePaths = new Set<string>();
  if (context.stats.errorFilesCount > 0) {
    for (const f of context.files.slice(0, context.stats.errorFilesCount)) {
      errorSourcePaths.add(f.path);
    }
  }

  let usedChars = 0;
  const compactedFiles: typeof context.files = [];

  // Pass 1: error-source files keep full content (highest priority)
  for (const file of context.files) {
    if (errorSourcePaths.has(file.path)) {
      compactedFiles.push(file);
      usedChars += file.content?.length || 0;
    }
  }

  // Pass 2: remaining budget distributed to non-error files
  const remainingBudget = CODE_CONTEXT_THRESHOLD - usedChars;
  const nonErrorFiles = context.files.filter(f => !errorSourcePaths.has(f.path));

  if (remainingBudget > 0 && nonErrorFiles.length > 0) {
    const perFileBudget = Math.floor(remainingBudget / nonErrorFiles.length);

    for (const file of nonErrorFiles) {
      const contentLen = file.content?.length || 0;
      if (contentLen <= perFileBudget) {
        compactedFiles.push(file);
        usedChars += contentLen;
      } else {
        const skeleton = buildFileSkeleton(file.path, file.content || '', language);
        compactedFiles.push({ ...file, content: skeleton });
        usedChars += skeleton.length;
      }
    }
  } else {
    for (const file of nonErrorFiles) {
      const skeleton = buildFileSkeleton(file.path, file.content || '', language);
      compactedFiles.push({ ...file, content: skeleton });
      usedChars += skeleton.length;
    }
  }

  const skeletonCount = compactedFiles.filter(f =>
    f.content?.startsWith('[skeleton]')
  ).length;
  console.log(`   ✅ Compacted: ${usedChars.toLocaleString()} chars (${skeletonCount} skeleton, ${compactedFiles.length - skeletonCount} full)`);

  return {
    ...context,
    files: compactedFiles,
    stats: {
      ...context.stats,
      estimatedTokens: Math.ceil(usedChars / 2.8),
    },
  };
}

/**
 * Build a skeleton representation of a file: line count + exported symbols.
 * LLM can use read_file to access full content when needed.
 */
function buildFileSkeleton(filePath: string, content: string, language?: string): string {
  const lineCount = content.split('\n').length;
  const symbols = extractExportedSymbols(content, language);
  const symbolsStr = symbols.length > 0 && symbols[0] !== '(symbol extraction not available — use read_file to inspect)'
    ? `\nExports: ${symbols.slice(0, 15).join(', ')}${symbols.length > 15 ? ` (+${symbols.length - 15} more)` : ''}`
    : '';

  return `[skeleton — use read_file for full content]\nLines: ${lineCount}${symbolsStr}`;
}

/**
 * Extract exported symbol signatures from source code.
 * Captures only top-level exported declarations (types, functions, constants).
 * For TS/JS: preserves function signatures (parameters + return type) to prevent
 * import hallucination — LLM sees exact names and signatures without read_file.
 */
function extractExportedSymbols(content: string, language?: string): string[] {
  const lines = content.split('\n');
  const symbols: string[] = [];

  if (language === 'go') {
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^type\s+[A-Z]/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*\{.*$/, ''));
      } else if (/^func\s+(\([^)]+\)\s+)?[A-Z]/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*\{.*$/, ''));
      } else if (/^(var|const)\s+[A-Z]/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*=.*$/, ''));
      }
    }
  } else if (language === 'typescript' || language === 'javascript') {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('export ')) continue;

      // export function name(params): ReturnType { ... }
      const fnMatch = trimmed.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))\s*(?::\s*([^{]+))?\s*\{?/);
      if (fnMatch) {
        const retType = fnMatch[3]?.trim() || '';
        symbols.push(`export function ${fnMatch[1]}${fnMatch[2]}${retType ? ': ' + retType : ''}`);
        continue;
      }

      // export class/interface/type/enum/abstract
      if (/^export\s+(class|interface|type|enum|abstract)\s/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*[{=].*$/, ''));
        continue;
      }

      // export const name = (params): ReturnType => ...  (arrow function)
      const arrowMatch = trimmed.match(/^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?(\([^)]*\))\s*(?::\s*([^=>{]+))?\s*=>/);
      if (arrowMatch) {
        const retType = arrowMatch[3]?.trim() || '';
        symbols.push(`export const ${arrowMatch[1]} = ${arrowMatch[2]}${retType ? ': ' + retType : ''} => ...`);
        continue;
      }

      // export const/let/var name (non-function)
      if (/^export\s+(const|let|var)\s/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*=.*$/, ''));
        continue;
      }
    }
  } else {
    return ['(symbol extraction not available — use read_file to inspect)'];
  }

  return symbols;
}

/**
 * Build Schema Anchor: concise table/type summary extracted from migration SQL files.
 * Prevents feature tasks from referencing non-existent columns or tables.
 * Works in both parallel mode (otherWorkerFiles) and sequential mode (projectCodeContext).
 */
async function buildSchemaAnchor(state: ArchitectGraphState): Promise<string | null> {
  const otherWorkerFiles = state._otherWorkerFiles;
  const codeContextFiles = state.projectCodeContext?.files || [];

  const migrationPaths = new Set<string>();
  const contentCache = new Map<string, string>();

  if (otherWorkerFiles) {
    for (const f of otherWorkerFiles) {
      if (isMigrationFile(f.path)) migrationPaths.add(f.path);
    }
  }
  for (const f of codeContextFiles) {
    if (f.path && isMigrationFile(f.path)) {
      migrationPaths.add(f.path);
      if (f.content) contentCache.set(f.path, f.content);
    }
  }

  if (migrationPaths.size === 0) return null;

  const fileSystem = state.deps?.fileSystem;
  const schemas: string[] = [];

  const sortedPaths = Array.from(migrationPaths).sort();
  for (const filePath of sortedPaths) {
    let content = contentCache.get(filePath);
    if (!content && fileSystem) {
      try { content = await fileSystem.readFile(filePath) || undefined; } catch { /* skip */ }
    }
    if (!content) continue;

    const tables = extractTableSchemas(content);
    schemas.push(...tables);
  }

  if (schemas.length === 0) return null;

  const sections = [
    '# Database Schema (from migrations, read-only reference)\n',
    'Use this schema when writing queries. Do NOT reference columns not listed here.\n',
    ...schemas,
  ];

  const result = sections.join('\n');
  console.log(`📋 [Execute] Schema anchor: ${migrationPaths.size} migration(s), ${schemas.length} table/type(s), ${result.length} chars`);
  return result;
}

function isMigrationFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith('.sql')) return false;
  return lower.includes('migration') || lower.includes('schema') || lower.includes('migrate');
}

function extractTableSchemas(sql: string): string[] {
  const results: string[] = [];

  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = tableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const columns: string[] = [];

    for (const rawLine of body.split('\n')) {
      const trimmed = rawLine.trim().replace(/,\s*$/, '');
      if (!trimmed) continue;
      if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s*\(|CHECK\s*\(|CONSTRAINT\s)/i.test(trimmed)) continue;
      columns.push(`  ${trimmed}`);
    }

    if (columns.length > 0) {
      results.push(`**${tableName}**:\n${columns.join('\n')}\n`);
    }
  }

  const enumRegex = /CREATE\s+TYPE\s+["'`]?(\w+)["'`]?\s+AS\s+ENUM\s*\(([^)]+)\)/gi;
  while ((match = enumRegex.exec(sql)) !== null) {
    results.push(`**${match[1]}** (ENUM): ${match[2].trim()}\n`);
  }

  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers for PromptBuilder vars (pre-formatting injection data)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatLessonsForPrompt(
  lessons?: Array<{ content: string; score: number; relatedFiles: string[]; tags: string[]; timestamp: string; directive?: string }>,
): string {
  if (!lessons?.length) return '';
  return lessons
    .map((l, i) => `### Lesson ${i + 1} (score: ${l.score})\n${l.content}`)
    .join('\n\n');
}

function formatSessionContextForPrompt(sessionContext?: {
  recentRuns: Array<{ runId: number; directive: string; mode: string; output: string }>;
  summary?: string;
  totalRuns: number;
  currentRun: number;
  currentMode: string;
  windowSize: number;
  compressionRatio: number;
}): string {
  if (!sessionContext || sessionContext.totalRuns === 0) return '';

  const parts: string[] = [];
  parts.push(`**Session Run ${sessionContext.currentRun}/${sessionContext.totalRuns}** (mode: ${sessionContext.currentMode})`);
  if (sessionContext.summary) {
    parts.push(`\n**Session Summary:**\n${sessionContext.summary}`);
  }
  if (sessionContext.recentRuns.length > 0) {
    parts.push('\n**Recent Runs:**');
    for (const run of sessionContext.recentRuns) {
      const truncated = run.output.length > 500 ? `${run.output.substring(0, 500)}...` : run.output;
      parts.push(`- Run ${run.runId} (${run.mode}): ${run.directive}\n  Output: ${truncated}`);
    }
  }
  return parts.join('\n');
}

function containsRuntimeErrorPattern(directive: string): boolean {
  const errorPatterns = [
    /Error:/i, /TypeError/i, /ReferenceError/i, /SyntaxError/i,
    /RangeError/i, /ELIFECYCLE/i, /npm ERR!/i,
    /\s+at\s+\S+\s+\(/i, /node_modules/i,
    /failed to/i, /cannot find/i, /undefined is not/i,
    /unexpected token/i, /module not found/i, /command failed/i,
    /compilation error/i, /\$ npm run/i, /\$ node /i,
    /Process exited with code/i, /test.*failed/i,
    /assertion.*failed/i, /expected.*but got/i,
  ];
  return errorPatterns.some(pattern => pattern.test(directive));
}

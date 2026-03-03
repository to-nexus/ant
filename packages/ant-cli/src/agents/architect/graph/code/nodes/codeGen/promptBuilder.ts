/**
 * Prompt Building for CodeGen Node
 * 
 * ✅ Supports Anthropic Prompt Caching for cost reduction:
 * - System prompts, rules, profiles (cached)
 * - Project context, design docs (cached)
 * - Current task, user directive (not cached - changes frequently)
 */

import { createHash } from "crypto";
import { ArchitectGraphState } from "../../state";
import { TokenBudgetManager } from "../../../../../../core/utils/tokenBudget";
import { compactAndPruneHistory } from "../../../../../../core/utils/historyManager";
import { formatViolations } from "../shared/violationFormatter";
import { CacheableContent } from "../../../../../../core/ports/llm";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { collectResolvedPartials } from "../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";
import { buildDesignDocForTask } from "../detectEnvironment/designSelector";
import { cleanFileContentFromResponse } from "../../utils/responseCleaners";

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
  content: CacheableContent[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: CacheableContent[] }> = [];
  
  // planText check (empty is normal for verification and explain tasks)
  if (state.planText) {
    console.log(`🔍 [CodeGen] planText: ${state.planText.length} chars`);
  } else {
    const taskType = state.currentTask?.type || 'unknown';
    const priority = state.currentTask?.priority;
    const isExpected = priority === 1000 || taskType === 'verification' || taskType === 'testgen' || taskType === 'doc' || taskType === 'explain';
    if (!isExpected) {
      console.warn(`⚠️  [CodeGen] planText is empty (task: ${taskType}, priority: ${priority})`);
    }
  }
  
  const promptEngine = state.deps?.promptEngine;
  
  if (!promptEngine) {
    throw new Error('[CodeGen] PromptEngine is required but not available in state.deps');
  }
  
  if (!state.currentTask) {
    throw new Error('[CodeGen] currentTask is required but not available in state');
  }
  
  // Pass RAG-loaded file content directly to the prompt.
  // Staleness is handled by edit_file's search/replace validation against disk.
  // System prompt content is cached (cache_control: ephemeral), making this
  // more token-efficient than stripping content and forcing read_file tool calls.
  const codeGenProjectCodeContext = state.projectCodeContext ?? undefined;

  // ✅ UI doc injection: Always inject if available, unless explicitly disabled
  // Decompose sets task.ui flag - only skip if explicitly false
  // Verification tasks skip UI docs entirely (irrelevant to build/runtime checks)
  const uiDocForTask = (() => {
    if (!state.parsedUiDocs) return undefined;
    if (!state.currentTask) return undefined;
    if (state.currentTask.type === 'verification' || state.currentTask.type === 'testgen' || state.currentTask.type === 'doc') return undefined;
    
    // Only skip if explicitly disabled by decompose
    if (state.currentTask.ui === false) return undefined;
    
    // ✅ Always inject if parsedUiDocs exists (use task.uiSections for filtering)
    const uiDoc = ArtifactService.getUiDocForTask(state.parsedUiDocs, state.currentTask.uiSections);
    
    if (uiDoc) {
      const sectionInfo = state.currentTask.uiSections?.length 
        ? `sections: ${state.currentTask.uiSections.join(', ')}` 
        : 'all sections';
      console.log(`   🎨 [CodeGen] UI doc injection: ${uiDoc.length} chars (${sectionInfo})`);
    }
    
    return uiDoc;
  })();
  
  // Pass profile to context for TypeScript/React templates on new projects
  // ✅ Also pass detectionReport.profile as fallback for ModeController language detection
  const contextWithProfile = {
    ...state.context,
    codebaseProfile: state.profile,
    detectedEnvironment: state.detectionReport?.environment,
    detectionReportProfile: state.detectionReport?.profile,
  };
  
  // ✅ Verification tasks skip designDoc entirely (irrelevant to build/runtime verification)
  const isVerificationTask = state.currentTask.type === 'verification';
  
  // ✅ Select design doc based on task.packages (split injection)
  // All tasks MUST have packages set by decompose (fe, be, fe-*, be-*, shared).
  // If missing, fall back to state.design but warn — this indicates a decompose bug.
  let designDocForTask: string | undefined;
  
  if (isVerificationTask) {
    designDocForTask = undefined;
    console.log(`📄 [CodeGen] Verification task — skipping designDoc injection`);
  } else if (state.currentTask?.packages && state.currentTask.packages.length > 0 && state.designDocs) {
    // Package-based split injection (fe, fe-*, be, be-*, shared)
    designDocForTask = buildDesignDocForTask(state.currentTask.packages, state.designDocs);
    console.log(`📄 [CodeGen] Split injection: packages=${state.currentTask.packages.join(', ')} → ${designDocForTask.length} chars`);
  } else {
    // Fallback: all tasks should have packages set by decompose.
    // If this fires, it indicates a decompose bug (missing packages) or resolve bug (missing designDocs).
    console.warn('⚠️ [CodeGen] Fallback to state.design: task.packages or state.designDocs missing (decompose bug)');
    console.warn(`   task.id=${state.currentTask?.id}, task.packages=${JSON.stringify(state.currentTask?.packages)}, hasDesignDocs=${!!state.designDocs}`);
    designDocForTask = state.design;
  }
  
  const promptResult = await promptEngine.buildExecutePrompt(
    'code',
    contextWithProfile,
    {
      directive: isVerificationTask ? undefined : state.directive,
      designDoc: designDocForTask,
      prdSpec: isVerificationTask ? undefined : state.prd,
      uiDoc: isVerificationTask ? undefined : uiDocForTask,
      projectCodeContext: codeGenProjectCodeContext,
      referenceCodeContexts: state.referenceCodeContexts,
      lessons: Array.isArray(state.lessons) ? state.lessons : undefined,
      sessionContext: state.sessionContext,
      referenceRequests: state.referenceRequests,
      currentTask: {
        name: state.currentTask.name,
        type: state.currentTask.type,
        priority: state.currentTask.priority,
        description: state.currentTask.description,
      },
    } as any,
    state.detectionReport?.jobMode,
    state.currentTask.type
  );
  
  // ✅ Extract composed sections for granular caching
  const composed = promptResult.composed;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Block 1: System Prompt + Rules + Profiles (CACHED - static)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const systemPromptParts = [
    composed.system,
    composed.profiles,
    composed.rules,
    composed.examples
  ].filter(Boolean);
  
  const systemPromptBlock: CacheableContent = {
    type: 'text',
    text: systemPromptParts.join('\n\n'),
    cache_control: { type: 'ephemeral' }
  };
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Block 2: Project Context (CACHED - changes per task)
  // Verification tasks skip prdSpec and designDoc (irrelevant to build checks)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const foundationContract = isVerificationTask ? null : await buildFoundationContract(state);
  const schemaAnchor = isVerificationTask ? null : await buildSchemaAnchor(state);

  const projectContextParts = [
    composed.injections,
    foundationContract,
    schemaAnchor,
  ].filter(Boolean);
  
  const projectContextBlock: CacheableContent = {
    type: 'text',
    text: projectContextParts.join('\n\n'),
    cache_control: { type: 'ephemeral' }
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Cache stability check: detect non-deterministic block content
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const currentTaskId = state.currentTask?.id || 'unknown';
    if (_lastCacheBlockHashes.taskId !== currentTaskId) {
      _lastCacheBlockHashes = { taskId: currentTaskId };
    }

    const b1Hash = createHash('md5').update(systemPromptBlock.text).digest('hex').slice(0, 12);
    const b2Hash = createHash('md5').update(projectContextBlock.text).digest('hex').slice(0, 12);
    const b1Len = systemPromptBlock.text.length;
    const b2Len = projectContextBlock.text.length;
    const histLen = state.conversationHistory?.length || 0;

    if (_lastCacheBlockHashes.block1 && _lastCacheBlockHashes.block1 !== b1Hash) {
      console.warn(`⚠️  [CacheStability] Block1 CHANGED between calls! prev=${_lastCacheBlockHashes.block1} curr=${b1Hash} len=${b1Len} (task=${currentTaskId}, hist=${histLen})`);
    }
    if (_lastCacheBlockHashes.block2 && _lastCacheBlockHashes.block2 !== b2Hash) {
      console.warn(`⚠️  [CacheStability] Block2 CHANGED between calls! prev=${_lastCacheBlockHashes.block2} curr=${b2Hash} len=${b2Len} (task=${currentTaskId}, hist=${histLen})`);
    }

    if (histLen === 0) {
      console.log(`🔑 [CacheStability] New task → Block1=${b1Hash}(${b1Len}) Block2=${b2Hash}(${b2Len})`);
    }
    _lastCacheBlockHashes = { block1: b1Hash, block2: b2Hash, taskId: currentTaskId };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Block 2.5: UI Images (NOT CACHED - multimodal blocks)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const uiImageBlocks: CacheableContent[] = [];
  try {
    const llmProvider = (state.deps?.llm as any)?.provider;
    const canSendImages = llmProvider === 'anthropic';

    // ✅ Load reference images on-demand if this is a UI task
    if (uiDocForTask && canSendImages && state.deps?.fileSystem) {
      const uiReferenceImages = await ArtifactService.loadUiReferenceImages(state.context, state.deps.fileSystem);
      
      if (uiReferenceImages) {
        const fs = await import('fs');
        const path = await import('path');

        const rootPath = state.deps.fileSystem.getRootPath();

        const maxImages = parseInt(process.env.ANT_UI_IMAGE_MAX || '4', 10);
        const maxBytesPerImage = parseInt(process.env.ANT_UI_IMAGE_MAX_BYTES || `${2 * 1024 * 1024}`, 10); // 2MB
        const maxTotalBytes = parseInt(process.env.ANT_UI_IMAGE_TOTAL_MAX_BYTES || `${8 * 1024 * 1024}`, 10); // 8MB

        const candidates: string[] = uiReferenceImages
          .filter(Boolean)
          .map(p => (typeof p === 'string' ? p.replace(/\\/g, '/') : p))
          .filter(p => !p.includes('/.gitkeep') && !p.endsWith('/.gitkeep'));

        let totalBytes = 0;

        // Add a small text header before images (helps LLM interpret upcoming blocks)
        if (candidates.length > 0) {
          const previewList = candidates.slice(0, maxImages).map(p => `- ${p}`).join('\n');
          uiImageBlocks.push({
            type: 'text',
            text:
              `# UI Images (Figma-derived)\n` +
              `The following image blocks are screenshots/component states from \`inputs/references\`.\n` +
              `Use them to match layout/spacing/visual states.\n` +
              `IMPORTANT: Treat these as reference only. Do NOT assume these files are available in the app runtime (e.g. not copied into \`public/\` automatically).\n` +
              `If the implementation needs runtime images/icons, either (a) generate placeholders in the codebase or (b) require explicit instructions in \`outputs/design/ui-assets.json\` (including destination paths).\n\n` +
              `${previewList}\n`
          });
        }

        for (const rel of candidates) {
          if (uiImageBlocks.filter(b => (b as any).type === 'image').length >= maxImages) break;

          // Resolve to absolute path safely within workspace root
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
  // Block 3: Task Context (NOT CACHED - changes frequently)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const taskContextParts = [];
  
  // Add violations if present (retry scenario)
  if (state.violations && state.violations.length > 0) {
    const violationsText = state.violationMessage || formatViolations(state.violations);
    const enforcementHeader = 
      `──────────────────────────────────────────────────────────────\n` +
      `⚠️  PREVIOUS ATTEMPT FAILED - FIX REQUIRED\n` +
      `──────────────────────────────────────────────────────────────\n\n` +
      `${violationsText}\n\n` +
      `Focus on fixing the root cause, not workarounds.\n\n` +
      `──────────────────────────────────────────────────────────────\n\n`;
    taskContextParts.push(enforcementHeader);
  }
  
  // Add runtime context (task description, plan, file tree)
  const runtimeContext = buildRuntimeContext(state);
  if (runtimeContext) {
    taskContextParts.push(runtimeContext);
  }
  
  const taskContextBlock: CacheableContent = {
    type: 'text',
    text: taskContextParts.join('\n\n')
    // No cache_control - changes every turn
  };
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Assemble First Message with Caching
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const contentBlocks: CacheableContent[] = [
    systemPromptBlock,
    projectContextBlock,
    ...uiImageBlocks,
    taskContextBlock
  ];
  
  messages.push({
    role: 'user',
    content: contentBlocks
  });
  
  // ✅ Add conversation history (if exists)
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    const tokenManager = new TokenBudgetManager();
    
    // Filter out initial user prompts (replaced by fresh prompt)
    let skipInitialUserMessages = true;
    const filteredHistory: typeof state.conversationHistory = [];
    
    for (const msg of state.conversationHistory) {
      if (msg.role === 'assistant') {
        skipInitialUserMessages = false;
      }
      
      if (skipInitialUserMessages && msg.role === 'user') {
        continue;
      }
      
      // Remove code XML tags from assistant messages for token efficiency
      if (msg.role === 'assistant' && typeof msg.content === 'string') {
        filteredHistory.push({
          ...msg,
          content: cleanFileContentFromResponse(msg.content)
        });
      } else {
        filteredHistory.push(msg);
      }
    }
    
    // Universal 3-step compaction: microcompact → auto-compact → prune
    const { result: prunedHistory, wasCompacted } = compactAndPruneHistory(filteredHistory, tokenManager);
    
    // Convert history to CacheableContent format
    // If auto-compaction occurred, mark the summary block for prompt caching
    // (it stays identical across turns until next compaction trigger)
    let isFirstMsg = true;
    for (const msg of prunedHistory) {
      if (typeof msg.content === 'string') {
        const shouldCache = wasCompacted && isFirstMsg && msg.role === 'assistant'
          && msg.content.startsWith('[Auto-compacted:');
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: [{
            type: 'text',
            text: msg.content,
            ...(shouldCache ? { cache_control: { type: 'ephemeral' as const } } : {}),
          }]
        });
      } else {
        // Already in array format (tool results)
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        });
      }
      isFirstMsg = false;
    }
    
    // Check final token budget
    const estimation = tokenManager.checkBudget(messages as any);
    
    if (estimation.isOverBudget) {
      throw new Error(
        `[CodeGen] Token budget exceeded after pruning! ` +
        `${estimation.totalTokens.toLocaleString()} tokens > ` +
        `${tokenManager['config'].maxTokens.toLocaleString()} limit.`
      );
    }
  } else {
    // No history - just check base prompt tokens
    const tokenManager = new TokenBudgetManager();
    tokenManager.checkBudget(messages as any);
  }
  
  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      // Calculate total prompt length
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
        'codeGen-fullMessage',
        totalPromptLength,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          callIndex: state._codeGenCallIndex,
          templatePath: isVerificationTask ? 'code/phases/verify/base' : 'code/phases/execute/base',
          usedTemplates: [
            promptResult.modeConfig.templates.base,
            promptResult.modeConfig.templates.rules,
            ...(promptResult.modeConfig.templates.injections || []),
          ].filter(Boolean),
          resolvedPartials: collectResolvedPartials([
            promptResult.modeConfig.templates.base,
            promptResult.modeConfig.templates.rules,
          ].filter(Boolean)),
          injectedVariables: {
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            designDoc: designDocForTask ? `[${designDocForTask.length} chars]` : undefined,
            packages: state.currentTask?.packages || undefined,
            prdSpec: state.prd ? `[${state.prd.length} chars]` : undefined,
            uiDoc: uiDocForTask ? `[${uiDocForTask.length} chars]` : undefined,
            planText: state.planText ? `[${state.planText.length} chars]` : undefined,
            jobMode: state.detectionReport?.jobMode,
            taskType: state.currentTask?.type,
            detectedEnvironment: state.detectionReport?.environment,
            projectCodeContextFiles: codeGenProjectCodeContext?.files?.length || 0,
            referenceCodeContexts: state.referenceCodeContexts?.length || 0,
            uiImageBlocksCount: uiImageBlocks.filter(b => (b as any).type === 'image').length,
            hasViolations: !!(state.violations?.length),
            violationsCount: state.violations?.length || 0,
            messageCount: messages.length,
            conversationHistoryLength: state.conversationHistory?.length || 0,
            runtimeAssetsCount: state.runtimeAssetsIndex?.count || 0,
            profileLanguage: state.profile?.language || null,
            profileFramework: state.profile?.framework || null,
            profilesLoaded: !!composed.profiles,
            failedTemplates: composed.failedTemplates.length > 0 ? composed.failedTemplates : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [CodeGen] Failed to log prompt:`, logError);
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
    
    // ✅ CRITICAL: Inject planText (structured JSON from Plan node)
    // planText is already structured - no parsing needed
    if (state.planText) {
      lines.push(`**Goal**: ${state.currentTask.description}`);
      lines.push(``);
      
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(`📋 IMPLEMENTATION PLAN (Structured JSON - FOLLOW EXACTLY)`);
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(``);
      lines.push(`The following JSON contains the exact implementation instructions.`);
      lines.push(`- \`create\`: Files to create with integration points`);
      lines.push(`- \`modify\`: Files to modify with specific changes`);
      lines.push(`- \`assets\`: Asset copy operations (source → destination)`);
      lines.push(``);
      lines.push('```json');
      lines.push(state.planText);
      lines.push('```');
      lines.push(``);
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(``);
    } else {
      // No plan available (explain/final-verification tasks OR state propagation failure)
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
    lines.push(`If needed: copy the asset to codebase/public/, then reference it in code.`);
    lines.push(``);
    if (state.context?.featurePath) {
      lines.push(`Source: ${state.context.featurePath.replace(/\\/g, '/')}/inputs/assets/`);
    }
    lines.push(`Destination: codebase/public/ogf/ (or app-specific static root)`);
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
  const otherWorkerFiles: Array<{ path: string; taskName?: string }> | undefined = (state as any)._otherWorkerFiles;
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
    return null;
  }

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
    lines.push('📂 Files Available (path only — read_file when needed)');
    lines.push('════════════════════════════════════════════════════════════════════════════════');
    lines.push('These files exist in the codebase but are NOT loaded above.');
    lines.push('Use read_file ONLY when you need to modify them.');
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
  const otherWorkerFiles: Array<{ path: string; taskName?: string }> | undefined =
    (state as any)._otherWorkerFiles;
  if (!otherWorkerFiles || otherWorkerFiles.length === 0) return null;

  const completedTasks = state.completedTasksDetails || [];
  const foundationTasks = completedTasks.filter(t => t.priority >= 150 && t.priority <= 199);
  if (foundationTasks.length === 0) return null;

  const foundationTaskNames = new Set(foundationTasks.map(t => t.name));
  const foundationFiles = otherWorkerFiles.filter(
    f => f.taskName && foundationTaskNames.has(f.taskName)
  );
  if (foundationFiles.length === 0) return null;

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return null;

  const language = state.profile?.language || state.detectionReport?.profile?.language;

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
  console.log(`📋 [CodeGen] Foundation contract: ${foundationFiles.length} file(s), ${symbolCount} symbol(s), ${result.length} chars`);
  return result;
}

/**
 * Extract exported symbol signatures from source code.
 * Captures only top-level exported declarations (types, functions, constants).
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
      if (/^export\s+(function|class|interface|type|const|let|var|enum|abstract)\s/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*[{=].*$/, ''));
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
  const otherWorkerFiles: Array<{ path: string; taskName?: string }> | undefined =
    (state as any)._otherWorkerFiles;
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
  console.log(`📋 [CodeGen] Schema anchor: ${migrationPaths.size} migration(s), ${schemas.length} table/type(s), ${result.length} chars`);
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

/**
 * Prompt Building for CodeGen Node
 * 
 * ✅ Supports Anthropic Prompt Caching for cost reduction:
 * - System prompts, rules, profiles (cached)
 * - Project context, design docs (cached)
 * - Current task, user directive (not cached - changes frequently)
 */

import { ArchitectGraphState } from "../../state";
import { TokenBudgetManager } from "../../../../../../core/utils/tokenBudget";
import { HistoryManager } from "../../../../../../core/utils/historyManager";
import { formatViolations } from "../shared/violationFormatter";
import { CacheableContent } from "../../../../../../core/ports/llm";
import { logPrompt } from "../../../../../../core/utils/promptLogger";

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
  
  // ✅ DEBUG: Verify planText was properly propagated from Plan node
  console.log(`🔍 [CodeGen] Checking planText:`);
  console.log(`   state.planText: ${state.planText ? state.planText.length + ' chars' : 'MISSING'}`);
  
  if (state.planText) {
    console.log(`   ✅ planText received successfully`);
    console.log(`   Preview: "${state.planText.substring(0, 100).replace(/\n/g, ' ')}..."`);
  } else {
    console.error(`   ❌ CRITICAL: planText is missing!`);
    console.error(`   This indicates LangGraph state propagation failure.`);
    console.error(`   Will use task.description only (degraded mode).`);
  }
  
  const promptEngine = state.deps?.promptEngine;
  
  if (!promptEngine) {
    throw new Error('[CodeGen] PromptEngine is required but not available in state.deps');
  }
  
  if (!state.currentTask) {
    throw new Error('[CodeGen] currentTask is required but not available in state');
  }
  
  const codeGenProjectCodeContext = state.projectCodeContext ? {
    ...state.projectCodeContext,
    files: state.projectCodeContext.files?.map((f: any) => ({
      path: f.path,
      content: null
    })) || []
  } : undefined;

  // ✅ UI doc injection: Always inject if available, unless explicitly disabled
  // Decompose sets task.ui flag - only skip if explicitly false
  const uiDocForTask = (() => {
    if (!state.parsedUiDocs) return undefined;
    if (!state.currentTask) return undefined;
    
    // Only skip if explicitly disabled by decompose
    if (state.currentTask.ui === false) return undefined;
    
    // ✅ Always inject if parsedUiDocs exists (use task.uiSections for filtering)
    const { ArtifactService } = require('../../../../../../infrastructure/workspace/ArtifactService');
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
  const contextWithProfile = {
    ...state.context,
    codebaseProfile: state.profile,
    detectedEnvironment: state.detectedEnvironment,
  };
  
  const promptResult = await promptEngine.buildExecutePrompt(
    'code',
    contextWithProfile,
    {
      directive: state.directive,
      designDoc: state.design,
      prdSpec: state.prd,
      uiDoc: uiDocForTask,  // ✅ Split-injected UI doc (only requested sections)
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
    state.codeMode,
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
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const projectContextParts = [
    composed.injections,
    state.prd ? `# Requirements\n\n${state.prd}` : null,
    state.design ? `# Design Document\n\n${state.design}` : null,
  ].filter(Boolean);
  
  const projectContextBlock: CacheableContent = {
    type: 'text',
    text: projectContextParts.join('\n\n'),
    cache_control: { type: 'ephemeral' }
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Block 2.5: UI Images (NOT CACHED - multimodal blocks)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const uiImageBlocks: CacheableContent[] = [];
  try {
    const llmProvider = (state.deps?.llm as any)?.provider;
    const canSendImages = llmProvider === 'anthropic';

    // ✅ Load reference images on-demand if this is a UI task
    if (uiDocForTask && canSendImages && state.deps?.fileSystem) {
      const { ArtifactService } = require('../../../../../../infrastructure/workspace/ArtifactService');
      const uiReferenceImages = await ArtifactService.loadUiReferenceImages(state.context, state.deps.fileSystem);
      
      if (uiReferenceImages) {
        const fs = await import('fs');
        const path = await import('path');

        const workspaceRoot = state.deps.fileSystem.getWorkspaceRoot();

        const maxImages = parseInt(process.env.ANT_UI_IMAGE_MAX || '4', 10);
        const maxBytesPerImage = parseInt(process.env.ANT_UI_IMAGE_MAX_BYTES || `${2 * 1024 * 1024}`, 10); // 2MB
        const maxTotalBytes = parseInt(process.env.ANT_UI_IMAGE_TOTAL_MAX_BYTES || `${8 * 1024 * 1024}`, 10); // 8MB

        const candidates: string[] = [
          ...(uiReferenceImages.screens || []),
          ...(uiReferenceImages.components || []),
        ]
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
          const abs = path.resolve(workspaceRoot, rel);
          if (!abs.startsWith(workspaceRoot)) continue;
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
    const historyManager = new HistoryManager(tokenManager);
    
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
        let cleanedContent = msg.content;
        cleanedContent = cleanedContent.replace(/<edit[^>]*>[\s\S]*?<\/edit>/g, '[code edit removed]');
        cleanedContent = cleanedContent.replace(/<file[^>]*>[\s\S]*?<\/file>/g, '[file creation removed]');
        cleanedContent = cleanedContent.replace(/<append[^>]*>[\s\S]*?<\/append>/g, '[code append removed]');
        
        filteredHistory.push({
          ...msg,
          content: cleanedContent
        });
      } else {
        filteredHistory.push(msg);
      }
    }
    
    // Prune filtered history to fit token budget
    const { prunedHistory } = historyManager.pruneHistory(filteredHistory);
    
    // Convert history to CacheableContent format (no caching for history)
    for (const msg of prunedHistory) {
      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: [{
            type: 'text',
            text: msg.content
          }]
        });
      } else {
        // Already in array format (tool results)
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        });
      }
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
  
  // ✅ Log prompt for debugging
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      // Extract text content from all blocks for logging
      const allTextContent = messages.flatMap(m => 
        Array.isArray(m.content) 
          ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text)
          : [m.content]
      ).join('\n\n---\n\n');
      
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'codeGen-fullMessage',
        allTextContent,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          templatePath: 'buildMessages (full)',
          injectedVariables: {
            // Content lengths
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            designDoc: state.design ? `[${state.design.length} chars]` : undefined,
            prdSpec: state.prd ? `[${state.prd.length} chars]` : undefined,
            uiDoc: uiDocForTask ? `[${uiDocForTask.length} chars]` : undefined,
            planText: state.planText ? `[${state.planText.length} chars]` : undefined,
            // Config
            codeMode: state.codeMode,
            taskType: state.currentTask?.type,
            detectedEnvironment: state.detectedEnvironment,
            // Context counts
            projectCodeContextFiles: codeGenProjectCodeContext?.files?.length || 0,
            referenceCodeContexts: state.referenceCodeContexts?.length || 0,
            // UI images
            uiImageBlocksCount: uiImageBlocks.filter(b => (b as any).type === 'image').length,
            // Violations (retry scenario)
            hasViolations: !!(state.violations?.length),
            violationsCount: state.violations?.length || 0,
            // History
            messageCount: messages.length,
            conversationHistoryLength: state.conversationHistory?.length || 0,
            // Runtime assets
            runtimeAssetsCount: state.runtimeAssetsIndex?.count || 0,
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
 * Extract FILES CONTRACT section from planText
 * Returns structured file operations from the plan
 */
export function extractFilesContract(planText: string): {
  createFiles: Array<{ path: string; purpose: string; integratesIn?: string; replaces?: string }>;
  modifyFiles: Array<{ path: string; action: string; changes: string[] }>;
  assetOps: string[];
} | null {
  // Look for FILES CONTRACT section
  const contractMatch = planText.match(/## FILES CONTRACT[\s\S]*?(?=\n## [^F]|\n═{3,}$|$)/i);
  if (!contractMatch) return null;
  
  const contractText = contractMatch[0];
  
  const result: ReturnType<typeof extractFilesContract> = {
    createFiles: [],
    modifyFiles: [],
    assetOps: []
  };
  
  // Parse CREATE FILES section
  const createSection = contractText.match(/### CREATE FILES:[\s\S]*?(?=### MODIFY|### ASSET|$)/i);
  if (createSection) {
    // Extract paths from various formats
    const pathMatches = createSection[0].matchAll(/path:\s*([^\n│]+)/gi);
    for (const match of pathMatches) {
      const path = match[1].trim();
      if (path) {
        result.createFiles.push({ path, purpose: '' });
      }
    }
  }
  
  // Parse MODIFY FILES section
  const modifySection = contractText.match(/### MODIFY FILES:[\s\S]*?(?=### ASSET|### CREATE|$)/i);
  if (modifySection) {
    const pathMatches = modifySection[0].matchAll(/path:\s*([^\n│]+)/gi);
    for (const match of pathMatches) {
      const path = match[1].trim();
      if (path) {
        result.modifyFiles.push({ path, action: '', changes: [] });
      }
    }
  }
  
  // Parse ASSET OPERATIONS section
  const assetSection = contractText.match(/### ASSET OPERATIONS[\s\S]*?(?=### |$)/i);
  if (assetSection) {
    const cpMatches = assetSection[0].matchAll(/cp\s+[^\n]+/gi);
    for (const match of cpMatches) {
      result.assetOps.push(match[0].trim());
    }
  }
  
  return result;
}

/**
 * Build runtime context (task, plan, enforcement, file tree)
 * 
 * CRITICAL: This is appended to EVERY user message, even during tool call loops!
 * This ensures task constraints (especially setup task restrictions) are always visible.
 */
export function buildRuntimeContext(state: ArchitectGraphState): string {
  const lines: string[] = [];
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🚨 PATH RULES REMINDER - Injected EVERY task to prevent LLM drift
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  lines.push(`════════════════════════════════════════════════════════════════════════════════`);
  lines.push(`🚨 PATH RULES (CRITICAL - READ EVERY TASK)`);
  lines.push(`════════════════════════════════════════════════════════════════════════════════`);
  lines.push(``);
  lines.push(`All paths are relative to PROJECT ROOT. Use these prefixes:`);
  lines.push(``);
  lines.push(`✅ CORRECT paths:`);
  lines.push(`   - codebase/app/page.tsx`);
  lines.push(`   - codebase/components/Header.tsx`);
  lines.push(`   - codebase/public/logo.svg`);
  lines.push(`   - features/<feature>/inputs/assets/... (for asset SOURCE only)`);
  lines.push(``);
  lines.push(`❌ WRONG paths (DO NOT USE):`);
  lines.push(`   - app/page.tsx (missing codebase/ prefix)`);
  lines.push(`   - src/app/page.tsx (wrong structure)`);
  lines.push(`   - features/<feature>/codebase/... (codebase is NOT inside features!)`);
  lines.push(``);
  lines.push(`The codebase/ directory is at PROJECT ROOT, NOT inside features/.`);
  lines.push(`════════════════════════════════════════════════════════════════════════════════`);
  lines.push(``);
  
  if (state.currentTask) {
    lines.push(`# Current Task`);
    lines.push(`**${state.currentTask.name}**`);
    lines.push(``);
    
    // ✅ CRITICAL: Inject planText (concrete implementation plan from Plan node)
    // This is the PRIMARY guidance for execution - description is just the goal
    if (state.planText) {
      lines.push(`**Goal**: ${state.currentTask.description}`);
      lines.push(``);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 🚨 FILES CONTRACT - Extracted and EMPHASIZED at top
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const filesContract = extractFilesContract(state.planText);
      if (filesContract && (filesContract.createFiles.length > 0 || filesContract.modifyFiles.length > 0)) {
        lines.push(`════════════════════════════════════════════════════════════════════════════════`);
        lines.push(`🔒 FILES CONTRACT (Structural Decisions - MUST Follow)`);
        lines.push(`════════════════════════════════════════════════════════════════════════════════`);
        lines.push(``);
        lines.push(`**Create/modify these files with EXACT paths/names as specified.**`);
        lines.push(`Implementation details (naming, types, logic) are your judgment.`);
        lines.push(``);
        
        if (filesContract.createFiles.length > 0) {
          lines.push(`### FILES TO CREATE (paths fixed):`);
          for (const file of filesContract.createFiles) {
            lines.push(`   ✅ ${file.path}`);
          }
          lines.push(``);
        }
        
        if (filesContract.modifyFiles.length > 0) {
          lines.push(`### FILES TO MODIFY:`);
          for (const file of filesContract.modifyFiles) {
            lines.push(`   ✏️  ${file.path}`);
          }
          lines.push(``);
        }
        
        if (filesContract.assetOps.length > 0) {
          lines.push(`### ASSET OPERATIONS:`);
          for (const op of filesContract.assetOps) {
            lines.push(`   📦 ${op}`);
          }
          lines.push(``);
        }
        
        lines.push(`⚠️  MUST follow: file paths/names, integration points, replacement targets`);
        lines.push(`🔧 Your judgment: implementation logic, variable names, types, patterns`);
        lines.push(`📚 Reference: existing code patterns, design docs, project conventions`);
        lines.push(``);
        lines.push(`════════════════════════════════════════════════════════════════════════════════`);
        lines.push(``);
      }
      
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
      lines.push(`📋 FULL IMPLEMENTATION PLAN`);
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
      lines.push(``);
      lines.push(state.planText);
      lines.push(``);
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
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
  
  const fileTree = generateFileTree(state);
  if (fileTree) {
    lines.push(fileTree);
    lines.push(``);
  }
  
  return lines.join('\n');
}

/**
 * Generate file tree for context
 * 
 * Shows files loaded from RAG search for this task.
 * Self-healing will handle file operation errors automatically.
 */
export function generateFileTree(state: ArchitectGraphState): string | null {
  const files = state.projectCodeContext?.filePaths || [];
  
  if (files.length === 0) {
    return null;
  }
  
  const lines = [
    '════════════════════════════════════════════════════════════════════════════════',
    '📋 Files in Context',
    '════════════════════════════════════════════════════════════════════════════════',
    '',
  ];
  
  const dirs: Record<string, string[]> = {};
  for (const file of files) {
    const parts = file.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const filename = parts[parts.length - 1];
    
    if (!dirs[dir]) {
      dirs[dir] = [];
    }
    dirs[dir].push(filename);
  }
  
  // Format tree
  for (const [dir, filenames] of Object.entries(dirs).sort()) {
    lines.push(`📁 ${dir}/`);
    for (const filename of filenames.sort()) {
      lines.push(`   📄 ${filename}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

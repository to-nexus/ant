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

  // ✅ Decide whether to inject UI context for THIS task only (token optimization)
  // Primary source of truth: decompose LLM sets currentTask.ui
  // Fallback: lightweight heuristics for backward compatibility.
  const shouldInjectUiDoc = (() => {
    if (!state.uiDoc) return false;
    if (!state.currentTask) return false;
    // Explanations generally don't need heavy UI specs
    if (state.currentTask.type === 'explain') return false;
    // Setup tasks must be config-only; skip UI spec injection to avoid scaffolding product UI
    if (state.currentTask.type === 'setup') return false;
    // ✅ 1) Primary: task metadata from decompose
    if (state.currentTask.ui === true) return true;
    if (state.currentTask.ui === false) return false;
    // ✅ 2) Fallback: Strong signals in task title/description
    const text = `${state.currentTask.name}\n${state.currentTask.description}`.toLowerCase();
    const keywordHit = /(ui|ux|figma|design|layout|style|styling|css|tailwind|theme|token|component|screen|page|frontend|react|tsx|모달|버튼|인풋|화면|레이아웃|디자인)/.test(text);
    // Environment signal (best-effort, not mandatory)
    const envHit = state.detectedEnvironment === 'frontend' || state.detectedEnvironment === 'fullstack';
    // Code context signal (RAG retrieved TSX)
    const tsxHit = Boolean(state.projectCodeContext?.filePaths?.some(p => p.toLowerCase().endsWith('.tsx')));
    return keywordHit || (envHit && tsxHit);
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
      uiDoc: shouldInjectUiDoc ? state.uiDoc : undefined,
      uiAssets: shouldInjectUiDoc ? state.uiAssets : undefined,
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

    if (shouldInjectUiDoc && canSendImages && state.uiAssets && state.deps?.fileSystem) {
      const fs = await import('fs');
      const path = await import('path');

      const workspaceRoot = state.deps.fileSystem.getWorkspaceRoot();

      const maxImages = parseInt(process.env.ANT_UI_IMAGE_MAX || '4', 10);
      const maxBytesPerImage = parseInt(process.env.ANT_UI_IMAGE_MAX_BYTES || `${2 * 1024 * 1024}`, 10); // 2MB
      const maxTotalBytes = parseInt(process.env.ANT_UI_IMAGE_TOTAL_MAX_BYTES || `${8 * 1024 * 1024}`, 10); // 8MB

      const candidates: string[] = [
        ...(state.uiAssets.screens || []),
        ...(state.uiAssets.components || []),
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
            `If the implementation needs runtime images/icons, either (a) generate placeholders in the codebase or (b) require explicit instructions in \`inputs/sources/ui-assets.md\` (including destination paths).\n\n` +
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
    
    // ✅ CRITICAL: Inject planText (concrete implementation plan from Plan node)
    // This is the PRIMARY guidance for execution - description is just the goal
    if (state.planText) {
      lines.push(`**Goal**: ${state.currentTask.description}`);
      lines.push(``);
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
      lines.push(`🚨 IMPLEMENTATION PLAN (FOLLOW THIS)`);
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
      lines.push(``);
      lines.push(`**The plan below was generated by analyzing your actual codebase.**`);
      lines.push(`**It contains specific file paths, API endpoints, and implementation steps.**`);
      lines.push(`**FOLLOW THIS PLAN - it is more accurate than the abstract goal above.**`);
      lines.push(``);
      lines.push(state.planText);
      lines.push(``);
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
      lines.push(``);
    } else {
      // No plan available (explain/final-verification tasks)
      lines.push(state.currentTask.description);
      lines.push(``);
    }
  }

  // ✅ Runtime assets reminder (text-only, small)
  if ((state as any).runtimeAssetsIndex?.count > 0) {
    const idx = (state as any).runtimeAssetsIndex as { count: number; files: string[] };
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📦 Runtime Assets (inputs/assets)`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`- Auto-copy: NO`);
    lines.push(`- You must choose the correct static root for the target app (monorepo-aware) and copy assets.`);
    lines.push(`- Preserve relative paths under inputs/assets, then reference them in code.`);
    if (state.context?.featurePath) {
      lines.push(`- Source dir (feature): ${state.context.featurePath.replace(/\\/g, '/')}/inputs/assets`);
    }
    if ((state.context as any)?.workingDir) {
      lines.push(`- Codebase root: ${(state.context as any).workingDir}`); // repo root (string)
    }
    lines.push(`- Copy mechanism: use tooling (e.g., run_command cp/rsync) as a dedicated task BEFORE using assets in code.`);
    lines.push(`- Files (first 20):`);
    idx.files.slice(0, 20).forEach((f) => lines.push(`  - ${f}`));
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

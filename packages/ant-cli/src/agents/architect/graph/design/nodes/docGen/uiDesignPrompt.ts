/**
 * UI Design Prompt Builder
 * 
 * Handles message building for ui-design work type:
 * - buildUiDesignMessages: Main message builder
 * - buildUiDesignFreshPrompt: Fresh prompt for tool loop continuation
 * - buildUiDesignSystemPrompt: System prompt loader (from template)
 * 
 * NOTE: Task instructions and tool guides are in templates:
 * - base-ui-design-by-ref.md (reference mode: Handlebars conditionals for task-specific content)
 * - rules-ui-design-by-ref.md (reference mode: tool usage rules)
 * - base-ui-design-by-figma.md (figma mode: MCP-based extraction)
 * - rules-ui-design-by-figma.md (figma mode: MCP tool usage rules)
 */

import { DesignGraphState } from '../../state';
import { logPrompt } from '../../../../../../core/utils/promptLogger';
import { CacheableContent, MessageContentBlock } from '../../../../../../core/ports/llm';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { compactAndPruneHistory } from '../../../../../../core/utils/historyManager';
import { buildSourceDocsForTask } from './sourceSelector';
import { DesignTask } from '../../../../types/task';
import type { FigmaNodeSummary } from '@ant/shared';

/**
 * Build multimodal messages for UI Design generation
 * 
 * TOOLING-BASED APPROACH:
 * - Images are NOT preloaded (avoids token explosion)
 * - LLM uses tools to selectively load images when needed:
 *   - list_reference_images: Discover available screenshots
 *   - read_reference_image: Load specific image for analysis
 *   - list_assets: List asset files for mapping
 */
export async function buildUiDesignMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  const task = state.currentTask;
  
  // ✅ Check if this is a continuation after tool calling
  const conversationHistory = state.conversationHistory || [];
  const isAfterToolCall = conversationHistory.length > 0;
  
  if (isAfterToolCall) {
    console.log(`🎨 [DocGen] UI Design continuing with existing conversation (${conversationHistory.length} messages)`);
    
    // ✅ Code job pattern: Build fresh prompt + append history (skip initial user messages)
    const messages: Array<{ role: 'user' | 'assistant'; content: MessageContentBlock[] }> = [];
    
    // 1. Build fresh user prompt (always needed as first message)
    const freshPrompt = await buildUiDesignFreshPrompt(state);
    messages.push({
      role: 'user',
      content: freshPrompt
    });
    
    // 2. Filter out initial user messages (replaced by fresh prompt)
    let skipInitialUserMessages = true;
    const filteredHistory: typeof conversationHistory = [];
    for (const msg of conversationHistory) {
      if (msg.role === 'assistant') {
        skipInitialUserMessages = false;
      }
      if (skipInitialUserMessages && msg.role === 'user') {
        continue;
      }
      filteredHistory.push(msg);
    }
    
    // 3. Universal 3-step compaction: microcompact → auto-compact → prune
    const tokenManager = new TokenBudgetManager();
    const { result: prunedHistory, wasCompacted } = compactAndPruneHistory(filteredHistory, tokenManager);
    
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
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content as MessageContentBlock[]
        });
      }
      isFirstMsg = false;
    }
    
    // Anthropic API requires conversation to end with a user message.
    // If history ends with assistant (e.g., retry after no <done>), append continuation.
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Continue.' }]
      });
    }

    // 4. Budget check
    const estimation = tokenManager.checkBudget(messages as any);
    if (estimation.isOverBudget) {
      throw new Error(
        `[DocGen/UI] Token budget exceeded after compaction: ${estimation.totalTokens.toLocaleString()} tokens`
      );
    }
    
    return messages;
  }
  
  console.log(`🎨 [DocGen] Building UI Design prompt for task: ${task?.id} (tool-based multimodal)`);
  
  const content: CacheableContent[] = [];
  
  // ✅ 1. System Prompt (includes rules and task-specific instructions via templates)
  const systemPrompt = await buildUiDesignSystemPrompt(state);
  content.push({
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' }
  });
  
  // ✅ 2. Available Resources Summary (dynamic data - must be in code)
  const resourcesSummary = buildResourcesSummary(state);
  content.push({
    type: 'text',
    text: resourcesSummary
  });
  
  // ✅ 3. PRD Context (if available) — per-task selective injection
  const effectiveSourceDocs = state.sourceDocuments ? { ...state.sourceDocuments } : {};
  if (state.uiDesignSource === 'figma' && state.figmaConfig) {
    effectiveSourceDocs['figma.json'] = JSON.stringify(state.figmaConfig, null, 2);
  }
  const taskSourceFiles = (task as DesignTask)?.sourceFiles
    ? [...(task as DesignTask).sourceFiles!]
    : undefined;
  if (state.uiDesignSource === 'figma' && taskSourceFiles && !taskSourceFiles.includes('figma.json')) {
    taskSourceFiles.push('figma.json');
  }
  const sourceDocsForTask = buildSourceDocsForTask(
    taskSourceFiles,
    Object.keys(effectiveSourceDocs).length > 0 ? effectiveSourceDocs : undefined
  );
  if (taskSourceFiles?.length && !sourceDocsForTask) {
    console.warn(`⚠️ [DocGen] sourceFiles assigned [${taskSourceFiles.join(', ')}] but matched 0 documents in sourceDocuments`);
  }

  if (sourceDocsForTask) {
    content.push({
      type: 'text',
      text: `\n\n# PRD (Requirements)\n\n${sourceDocsForTask}`
    });
  }
  
  // ✅ 4. Inject previously generated UI docs (each task has fresh conversationHistory)
  // NOTE: conversationHistory resets between tasks, so prior docs must be loaded from disk
  const previousDocs = await loadPreviousUiDocs(state, task?.id || '');
  if (previousDocs) {
    content.push({
      type: 'text',
      text: previousDocs
    });
  }
  
  // ✅ Log prompt structure (not content)
  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      // Calculate total text length
      const totalLength = content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .reduce((sum, c) => sum + c.text.length, 0);
      
      const logSuffix = state.uiDesignSource === 'figma' ? 'by-figma' : 'by-ref';
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'docGen-uiDesign-fullMessage',
        totalLength,
        {
          taskId: task?.id,
          taskName: task?.name,
          templatePath: `design/phases/execute/base-ui-design-${logSuffix}`,
          usedTemplates: [
            `design/phases/execute/rules-ui-design-${logSuffix}`,
            `design/phases/execute/injections/ui-tokens-guide-${logSuffix}`,
            `design/phases/execute/injections/ui-assets-guide-${logSuffix}`,
            `design/phases/execute/injections/ui-spec-guide-${logSuffix}`,
          ],
          injectedVariables: {
            systemPrompt: systemPrompt ? `[${systemPrompt.length} chars]` : undefined,
            resourcesSummary: resourcesSummary ? `[${resourcesSummary.length} chars]` : undefined,
            sourceDocs: sourceDocsForTask ? `[${sourceDocsForTask.length} chars]` : undefined,
            previousDocs: previousDocs ? `[${previousDocs.length} chars]` : undefined,
            uiReferences: state.uiReferences ? {
              count: state.uiReferences.length,
            } : undefined,
            uiAssetsList: state.uiAssetsList ? 'SET' : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log full message:`, logError);
    }
  }
  
  return [{
    role: 'user',
    content
  }];
}

/**
 * Build fresh user prompt for tool loop continuation
 * This is needed when continuing after tool calls to maintain proper message structure
 */
export async function buildUiDesignFreshPrompt(state: DesignGraphState): Promise<CacheableContent[]> {
  const content: CacheableContent[] = [];
  const task = state.currentTask;
  
  // ✅ 1. System Prompt (includes rules and task-specific instructions)
  const systemPrompt = await buildUiDesignSystemPrompt(state);
  content.push({
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' }
  });
  
  // ✅ 2. Available Resources Summary (dynamic data)
  const resourcesSummary = buildResourcesSummary(state);
  content.push({
    type: 'text',
    text: resourcesSummary
  });
  
  // ✅ 3. PRD Context (if available) — per-task selective injection
  const freshSourceDocs = buildSourceDocsForTask(
    (task as DesignTask)?.sourceFiles,
    state.sourceDocuments
  );

  if (freshSourceDocs) {
    content.push({
      type: 'text',
      text: `\n\n# PRD (Requirements)\n\n${freshSourceDocs}`
    });
  }
  
  // ✅ 4. Inject previously generated UI docs
  const previousDocs = await loadPreviousUiDocs(state, task?.id || '');
  if (previousDocs) {
    content.push({
      type: 'text',
      text: previousDocs
    });
  }
  
  // ✅ 5. Add next step instruction after tool call (CRITICAL FIX)
  // This ensures LLM continues with analysis phase instead of stopping after discovery
  //
  // IMPORTANT: buildUiDesignFreshPrompt is ONLY called when isAfterToolCall=true (Turn 2+)
  // At this point, LLM has already called list_reference_images and has the results.
  // We MUST always remind the LLM to continue - DO NOT rely on state.uiReferences
  // because it may be undefined even when tool results exist!
  const isUiTokensTask = task?.id?.startsWith('ui-tokens');
  const isUiSpecTask = task?.id?.startsWith('ui-spec');
  
  // ALWAYS add instruction for ui-tokens and ui-spec tasks in Turn 2+
  // Don't check hasDiscoveredImages - this function is only called after tool calls!
  if (isUiTokensTask || isUiSpecTask) {
    const targetDoc = isUiTokensTask ? 'ui-tokens.json' : 'ui-spec.json';
    console.log(`🔔 [FreshPrompt] Adding "Next Steps" instruction for ${task?.id} → ${targetDoc}`);
    const { FilePromptAdapter } = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
    const adapter = new FilePromptAdapter();
    const continuationTemplate = state.uiDesignSource === 'figma'
      ? 'design/phases/execute/injections/ui-continuation-by-figma'
      : 'design/phases/execute/injections/ui-continuation';
    const continuationText = await adapter.render(continuationTemplate, { targetDoc });
    content.push({
      type: 'text',
      text: `\n\n${continuationText}`
    });
  }
  
  // ✅ Log prompt structure (not content) - tool loop continuation
  const jobIdFresh = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      const totalLength = content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .reduce((sum, c) => sum + c.text.length, 0);
      
      const freshLogSuffix = state.uiDesignSource === 'figma' ? 'by-figma' : 'by-ref';
      await logPrompt(
        state.context.featurePath,
        jobIdFresh,
        'design',
        'docGen-uiDesign-freshPrompt',
        totalLength,
        {
          taskId: task?.id,
          taskName: task?.name,
          templatePath: `design/phases/execute/base-ui-design-${freshLogSuffix}`,
          usedTemplates: [
            `design/phases/execute/rules-ui-design-${freshLogSuffix}`,
            `design/phases/execute/injections/ui-tokens-guide-${freshLogSuffix}`,
            `design/phases/execute/injections/ui-assets-guide-${freshLogSuffix}`,
            `design/phases/execute/injections/ui-spec-guide-${freshLogSuffix}`,
          ],
          injectedVariables: {
            systemPrompt: systemPrompt ? `[${systemPrompt.length} chars]` : undefined,
            resourcesSummary: resourcesSummary ? `[${resourcesSummary.length} chars]` : undefined,
            sourceDocs: freshSourceDocs ? `[${freshSourceDocs.length} chars]` : undefined,
            previousDocs: previousDocs ? `[${previousDocs.length} chars]` : undefined,
            isUiTokensTask,
            isUiSpecTask,
            isFreshPrompt: true,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log fresh prompt:`, logError);
    }
  }
  
  return content;
}

const NODESUMMARY_TOKEN_THRESHOLD = 2500;

function buildNodeSummaryDisplay(nodeSummary: FigmaNodeSummary[]): string {
  const fullDisplay = nodeSummary.map(n => {
    const indent = '  '.repeat(n.depth);
    const dimStr = n.dimensions ? ` ${n.dimensions.width}x${n.dimensions.height}` : '';
    const compStr = n.isComponent ? ' [component]' : '';
    return `${indent}${n.type} "${n.name}" nodeId=${n.nodeId} (${n.childCount} children)${dimStr}${compStr}`;
  }).join('\n');

  if (Math.ceil(fullDisplay.length / 3.5) <= NODESUMMARY_TOKEN_THRESHOLD) {
    return fullDisplay;
  }

  const structural = nodeSummary.filter(
    n => n.depth <= 1 || n.type === 'COMPONENT_SET' || n.type === 'SECTION'
  );

  return structural.map(n => {
    const indent = '  '.repeat(n.depth);
    const descendants = countDescendants(n, nodeSummary);
    const descStr = descendants > 0 ? ` (${descendants} descendants)` : '';
    const dimStr = n.dimensions ? ` ${n.dimensions.width}x${n.dimensions.height}` : '';
    return `${indent}${n.type} "${n.name}" nodeId=${n.nodeId}${descStr}${dimStr}`;
  }).join('\n')
    + `\nTotal: ${nodeSummary.length} nodes. Use figma_get_design_context with a nodeId to inspect details.`;
}

function countDescendants(parent: FigmaNodeSummary, all: FigmaNodeSummary[]): number {
  const idx = all.findIndex(n => n.nodeId === parent.nodeId);
  if (idx === -1) return 0;
  let count = 0;
  for (let i = idx + 1; i < all.length; i++) {
    if (all[i].depth <= parent.depth) break;
    count++;
  }
  return count;
}

/**
 * Build resources summary for UI Design tasks
 * 
 * NOTE: This is dynamic data that must be generated at runtime
 * - Counts of available screenshots and assets
 * - Examples of file names
 */
function buildResourcesSummary(state: DesignGraphState): string {
  const isFigmaMode = state.uiDesignSource === 'figma';
  let resourcesSummary = '\n\n# Available Resources\n\n';

  if (isFigmaMode) {
    resourcesSummary += '## Figma Design Data\n';
    resourcesSummary += 'Use Figma MCP tools to extract design data directly from Figma files:\n';
    resourcesSummary += '- `figma_get_metadata` — node tree structure and hierarchy\n';
    resourcesSummary += '- `figma_get_design_context` — detailed styles, colors, typography, spacing\n';
    resourcesSummary += '- `figma_get_screenshot` — visual rendering of a node\n';
    resourcesSummary += '- `figma_get_variable_defs` — design tokens/variables defined in the file\n\n';

    if (state.figmaConfig?.file) {
      resourcesSummary += `- **Figma file**: 1 file configured\n`;
    }
    if (state.figmaExplorationResult) {
      const er = state.figmaExplorationResult;
      resourcesSummary += `- **Explored**: ${er.totalFrameCount} frames, ${er.variationMatrix.length} variation groups, ${er.componentStateMatrix.length} component sets\n`;

      if (er.nodeSummary?.length) {
        resourcesSummary += '\n### Figma Data Access\n\n';
        resourcesSummary += '**CONSTRAINT**: Use the most specific (deepest) nodeId available for design context queries.\n';
        resourcesSummary += 'nodeIds come from nodeSummary or from [Child Nodes] outlines in truncated responses.\n\n';
        resourcesSummary += '**CONSTRAINT**: Do NOT query nodes at the root or page level for detailed design data.\n\n';
        resourcesSummary += '### nodeSummary (available nodeIds)\n\n';
        resourcesSummary += '```\n';
        resourcesSummary += buildNodeSummaryDisplay(er.nodeSummary);
        resourcesSummary += '\n```\n';
      }
    }
  } else {
    resourcesSummary += '## Reference Images\n';
    resourcesSummary += 'Use `list_reference_images` tool to discover available images, then use `read_reference_image` to load and analyze specific images.\n\n';

    if (state.uiReferences?.length) {
      resourcesSummary += `- **References**: ${state.uiReferences.length} images available\n`;
      resourcesSummary += `  (Examples: ${state.uiReferences.slice(0, 5).join(', ')}${state.uiReferences.length > 5 ? '...' : ''})\n`;
    }
  }
  
  resourcesSummary += '\n## Asset Files\n';
  resourcesSummary += 'Use `list_assets` tool to discover available asset files for mapping.\n\n';
  
  if (state.uiAssetsList) {
    const assetCounts = Object.entries(state.uiAssetsList)
      .filter(([, files]) => files.length > 0)
      .map(([group, files]) => `${group}: ${files.length}`);
    
    if (assetCounts.length > 0) {
      resourcesSummary += `Available: ${assetCounts.join(', ')}\n`;
    }
  }
  
  return resourcesSummary;
}

/**
 * Load previously generated UI documents for dependent tasks
 * 
 * Why needed: conversationHistory resets between tasks (each task = fresh session)
 * So prior task outputs must be loaded from disk.
 * 
 * Dependency:
 * - ui-tokens: no dependencies
 * - ui-assets: no dependencies (independent from tokens)
 * - ui-spec: needs ui-tokens.json + ui-assets.json
 */
async function loadPreviousUiDocs(
  state: DesignGraphState,
  taskId: string
): Promise<string> {
  const isUiSpecTask = taskId.startsWith('ui-spec');
  
  // Only ui-spec tasks need previous docs (tokens + assets as REFERENCE)
  if (!isUiSpecTask) {
    return '';
  }
  
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem || !state.context.featurePath) {
    return '';
  }
  
  const path = await import('path');
  const rootPath = fileSystem.getRootPath?.() || '';
  const featureDirRel = rootPath
    ? path.relative(rootPath, state.context.featurePath)
    : state.context.featurePath.replace(/^\//, '');
  
  const designOutputDir = path.join(featureDirRel, 'outputs/design');
  let injectedDocs = '';
  
  // Load COMPLETE ui-tokens.json for ui-spec-*
  try {
    const tokensPath = path.join(designOutputDir, 'ui-tokens.json');
    const tokensContent = await fileSystem.readFile(tokensPath);
    if (tokensContent && !tokensContent.includes('ant:template')) {
      injectedDocs += `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
      injectedDocs += `# REFERENCE: ui-tokens.json (ALL chapters completed)\n`;
      injectedDocs += `> Use these token keys. Do NOT use raw values that are defined here.\n`;
      injectedDocs += `════════════════════════════════════════════════════════════════════════════════\n\n`;
      injectedDocs += '```json\n' + tokensContent + '\n```';
      console.log(`📄 [DocGen] Injected ui-tokens.json (${tokensContent.length} chars) for ${taskId}`);
    }
  } catch {
    // File doesn't exist yet, skip
  }
  
  // Load COMPLETE ui-assets.json for ui-spec-*
  try {
    const assetsPath = path.join(designOutputDir, 'ui-assets.json');
    const assetsContent = await fileSystem.readFile(assetsPath);
    if (assetsContent && !assetsContent.includes('ant:template')) {
      injectedDocs += `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
      injectedDocs += `# REFERENCE: ui-assets.json (ALL chapters completed)\n`;
      injectedDocs += `> Reference these asset identifiers when documenting components.\n`;
      injectedDocs += `════════════════════════════════════════════════════════════════════════════════\n\n`;
      injectedDocs += '```json\n' + assetsContent + '\n```';
      console.log(`📄 [DocGen] Injected ui-assets.json (${assetsContent.length} chars) for ${taskId}`);
    }
  } catch {
    // File doesn't exist yet, skip
  }
  
  return injectedDocs;
}

/**
 * Build system prompt for UI Design generation
 * 
 * Loads design/phases/execute/base-ui-design-{by-ref|by-figma}.md based on state.uiDesignSource
 * - Includes corresponding rules and injection guides via partials
 * - Injects previousChaptersSummary to prevent duplicate content
 * - Injects siblingTasks for MECE awareness in parallel chapters
 */
export async function buildUiDesignSystemPrompt(state: DesignGraphState): Promise<string> {
  const promptPort = state.deps?.promptEngine;
  
  if (!promptPort) {
    throw new Error('[DocGen] PromptEngine is required but not available in state.deps');
  }
  
  let previousChaptersSummary = '';
  let existingFileContent = '';
  
  const taskId = state.currentTask?.id || '';
  const taskDescription = state.currentTask?.description || '';
  const targetFile = state.currentTask?.targetFile;
  
  // Determine target file from task ID if not explicitly set
  const actualTargetFile = targetFile || 
    (taskId.startsWith('ui-tokens') ? 'ui-tokens.json' :
     taskId.startsWith('ui-assets') ? 'ui-assets.json' :
     taskId.startsWith('ui-spec') ? 'ui-spec.json' : 'ui-spec.json');
  
  // Pre-computed at decompose time (taskQueue is not accessible in worker subgraph)
  const isLastTaskForDocument = !!(state.currentTask as DesignTask)?.isLastTaskForDocument;
  const forceAppend = !!(state.currentTask as DesignTask)?.forceAppend;
  if (isLastTaskForDocument) {
    console.log(`📄 [DocGen UI] This is the LAST task for ${actualTargetFile} - will NOT output metadata`);
  }
  if (forceAppend) {
    console.log(`📄 [DocGen UI] forceAppend=true for ${taskId} — parallel chapter, will use <append>`);
  }
  
  // ✅ Check if file exists and extract last section number + existing sections
  if (state.deps?.fileSystem && state.context.featurePath) {
    try {
      const path = await import('path');
      const rootPath = state.deps.fileSystem.getRootPath?.() || '';
      const featureDirRel = rootPath
        ? path.relative(rootPath, state.context.featurePath)
        : state.context.featurePath.replace(/^\//, '');
      
      const filePath = path.join(featureDirRel, 'outputs/design', actualTargetFile);
      const fileExists = await state.deps.fileSystem.fileExists(filePath);
      
      if (fileExists) {
        existingFileContent = await state.deps.fileSystem.readFile(filePath) || '';
        if (existingFileContent) {
          const isJsonFile = actualTargetFile.endsWith('.json');
          
          if (isJsonFile) {
            try {
              const parsed = JSON.parse(existingFileContent);
              const dataKeys = Object.keys(parsed).filter(k => k !== '_meta');
              if (dataKeys.length > 0) {
                previousChaptersSummary = dataKeys.map((k, i) => `- Category ${i + 1}: ${k}`).join('\n');
              }
              if (parsed.sections && typeof parsed.sections === 'object' && !Array.isArray(parsed.sections)) {
                const sectionKeys = Object.keys(parsed.sections);
                if (sectionKeys.length > 0) {
                  previousChaptersSummary = sectionKeys.map((k, i) => `- Section ${i + 1}: ${k}`).join('\n');
                }
              }
            } catch (parseError) {
              console.warn(`📄 [DocGen UI] Failed to parse ${actualTargetFile} as JSON:`, parseError);
            }
          }
          
          if (previousChaptersSummary) {
            console.log(`📄 [DocGen UI] Extracted summary from existing ${actualTargetFile}`);
          }
        }
      } else {
        console.log(`📄 [DocGen UI] ${actualTargetFile} does not exist yet (first chapter)`);
      }
    } catch (error) {
      console.error(`[DocGen UI] Error reading ${actualTargetFile}:`, error);
    }
  }
  
  // ✅ NEW: Extract PATH_PATTERN for ui-assets continuation chapters
  let pathPattern = '';
  if (taskId.startsWith('ui-assets') && existingFileContent) {
    pathPattern = extractPathPattern(existingFileContent);
    if (pathPattern) {
      console.log(`📄 [DocGen UI] Extracted PATH_PATTERN from existing ui-assets.json: ${pathPattern}`);
    }
  }
  
  // Build sibling tasks summary for MECE awareness in parallel chapters
  const allTasks: Array<{ id: string; name: string; description?: string; targetFile?: string }> = (state as any)._allTasksSummary || [];
  const siblingTasks = allTasks
    .filter(t => t.targetFile === actualTargetFile && t.id !== taskId)
    .map(t => `- ${t.id}: ${t.name} — ${t.description?.substring(0, 200) || ''}`)
    .join('\n');

  const injectedVariables = {
    taskId: state.currentTask?.id,
    taskName: state.currentTask?.name,
    taskDescription,
    targetFile: actualTargetFile,
    previousChaptersSummary,
    isLastTaskForDocument,
    forceAppend,
    pathPattern,
    siblingTasks: siblingTasks || '',
    jobMode: state.detectionReport?.jobMode,
    userLanguage: state.context.userLanguage || 'en',
  };

  const isFigmaMode = state.uiDesignSource === 'figma';
  const templateSuffix = isFigmaMode ? 'by-figma' : 'by-ref';
  const templatePath = `design/phases/execute/base-ui-design-${templateSuffix}`;

  const template = await (promptPort as any).deps?.promptPort?.render(templatePath, injectedVariables);
  
  if (!template) {
    throw new Error(`[DocGen] Failed to load ${templatePath}.md template`);
  }
  
  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'docGen-uiDesign-systemPrompt',
        template.length,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          templatePath,
          usedTemplates: [
            `design/phases/execute/rules-ui-design-${templateSuffix}`,
            `design/phases/execute/injections/ui-tokens-guide-${templateSuffix}`,
            `design/phases/execute/injections/ui-assets-guide-${templateSuffix}`,
            `design/phases/execute/injections/ui-spec-guide-${templateSuffix}`,
          ],
          injectedVariables: {
            taskDescription: injectedVariables.taskDescription ? `[${injectedVariables.taskDescription.length} chars]` : undefined,
            targetFile: injectedVariables.targetFile,
            jobMode: injectedVariables.jobMode,
            isLastTaskForDocument: injectedVariables.isLastTaskForDocument,
            forceAppend: injectedVariables.forceAppend,
            pathPattern: injectedVariables.pathPattern,
            previousChaptersSummary: injectedVariables.previousChaptersSummary ? `[${injectedVariables.previousChaptersSummary.length} chars]` : undefined,
            siblingTasks: injectedVariables.siblingTasks ? `[${injectedVariables.siblingTasks.length} chars]` : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log prompt:`, logError);
    }
  }
  
  return template;
}

/**
 * Extract PATH_PATTERN metadata from existing ui-assets.json content
 * 
 * For JSON files: reads from _meta.pathPattern object
 * For MD files (legacy): parses HTML comment
 * 
 * This ensures ch2+ follows the same destination path patterns as ch1.
 */
function extractPathPattern(content: string): string {
  if (!content) return '';
  
  // Try to parse as JSON first (new format)
  try {
    const parsed = JSON.parse(content);
    if (parsed._meta?.pathPattern) {
      // Convert object to string format: "logos=public/logos/, icons=public/icons/"
      const patterns: string[] = [];
      for (const [key, value] of Object.entries(parsed._meta.pathPattern)) {
        patterns.push(`${key}=${value}`);
      }
      return patterns.join(', ');
    }
    
    // Fallback: infer from actual asset destinations in JSON
    const destinationPaths = new Set<string>();
    for (const category of Object.values(parsed)) {
      if (typeof category === 'object' && category !== null && !('lastSection' in category)) {
        for (const asset of Object.values(category as Record<string, any>)) {
          if (asset?.dest) {
            const dirMatch = (asset.dest as string).match(/(public\/[\w-]+\/)/);
            if (dirMatch) {
              destinationPaths.add(dirMatch[1]);
            }
          }
        }
      }
    }
    
    if (destinationPaths.size > 0) {
      const patterns: string[] = [];
      for (const p of destinationPaths) {
        const dirName = p.replace(/^public\//, '').replace(/\/$/, '');
        patterns.push(`${dirName}=${p}`);
      }
      return patterns.join(', ');
    }
  } catch {
    // Not JSON, try legacy MD format
  }
  
  // Legacy: Look for PATH_PATTERN metadata comment in MD
  const pathPatternMatch = content.match(/<!-- PATH_PATTERN: (.+?) -->/);
  if (pathPatternMatch) {
    return pathPatternMatch[1];
  }
  
  // Legacy fallback: Extract patterns from tables
  const destinationPaths = new Set<string>();
  const tableRowMatch = content.matchAll(/\|\s*[\w-]+\s*\|\s*[^|]+\s*\|\s*(public\/[\w/]+)/g);
  
  for (const match of tableRowMatch) {
    const destPath = match[1];
    const dirMatch = destPath.match(/(public\/[\w-]+\/)/);
    if (dirMatch) {
      destinationPaths.add(dirMatch[1]);
    }
  }
  
  if (destinationPaths.size > 0) {
    const patterns: string[] = [];
    for (const p of destinationPaths) {
      const dirName = p.replace(/^public\//, '').replace(/\/$/, '');
      patterns.push(`${dirName}=${p}`);
    }
    return patterns.join(', ');
  }
  
  return '';
}

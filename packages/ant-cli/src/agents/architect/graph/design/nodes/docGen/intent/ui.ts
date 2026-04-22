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

import { DesignGraphState } from '../../../state';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { logPrompt } from '../../../../../../../core/utils/promptLogger';
import { CacheableContent, MessageContentBlock } from '../../../../../../../core/ports/llm';
import { DesignTask } from '../../../../../types/task';
import type { FigmaNodeSummary } from '@ant/shared';
import { designDirOf, ARTIFACT_PREFIX, isFigmaPipeline, isFigmaDataPopulated } from '@ant/shared';
import { composeMessages } from '../../../../../../../core/utils/messageComposer';
import { selectArtifacts, selectArtifactsWithPolicy } from '../../../../../../../core/prompt/builder/ArtifactPipeline';

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
  const nodeDocGen = getConv(state.conversations, CONV_KEYS.NODE_DOCGEN);
  const isAfterToolCall = nodeDocGen.length > 0;
  
  if (isAfterToolCall) {
    console.log(`🎨 [DocGen] UI Design continuing with existing conversation (${nodeDocGen.length} messages)`);
    
    // Build fresh user prompt as initial blocks
    const freshPrompt = await buildUiDesignFreshPrompt(state);

    // Compose messages via MessageComposer (handles history skip, compaction, budget)
    const { messages } = composeMessages({
      initialBlocks: freshPrompt,
      priorTurns: nodeDocGen as any,
    });
    
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
  
  // ✅ 3. PRD Context (if available) — from artifact pool
  const figmaMode = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
  const taskSourceFiles = (task as DesignTask)?.sourceFiles
    ? [...(task as DesignTask).sourceFiles!]
    : undefined;
  if (figmaMode && taskSourceFiles && !taskSourceFiles.includes('figma.json')) {
    taskSourceFiles.push('figma.json');
  }

  const taskInclude = (task as DesignTask | undefined)?.include;
  const designTask = task as DesignTask | undefined;
  let selectedDocs = designTask?.artifactPolicy
    ? selectArtifactsWithPolicy(state.artifacts || [], designTask.artifactPolicy)
    : selectArtifacts(state.artifacts || [], { include: [ARTIFACT_PREFIX.SOURCES] });
  if (taskSourceFiles?.length) {
    selectedDocs = selectedDocs.filter(a =>
      taskSourceFiles.some(f => a.path.endsWith('/' + f) || a.path === 'inputs/sources/' + f),
    );
  }

  // Figma config injection (may not be in pool)
  if (figmaMode && state.figmaConfig && !selectedDocs.some(a => a.path.endsWith('figma.json'))) {
    selectedDocs.push({ path: 'inputs/sources/figma.json', content: JSON.stringify(state.figmaConfig, null, 2), role: 'context' });
  }

  const refs = selectedDocs.filter(a => a.role === 'ref');
  // Artifacts without explicit role assignment fall back to context
  const ctx = selectedDocs.filter(a => a.role !== 'ref');

  if (refs.length > 0 || ctx.length > 0) {
    // SSOT: both `ref` and `context` are authoritative inputs; `ref` is the
    // original source material and wins on direct conflict. Task-scope is
    // bounded by `ref` (or directive when no ref), while `context` supplies
    // implementation detail only. Mirror `jobs/shared/injections/role-guide.md`
    // wording so the LLM sees consistent authority semantics across phases.
    const sections: string[] = [
      '## Provided Documents',
      '',
      '**Principle**: `ref` and `context` documents are both authoritative inputs. Use all of them.',
      '',
      '**Constraint**: `ref` is the original source material. When `ref` and `context` directly conflict on the same property, `ref` wins. Otherwise both are equally binding.',
      '',
      '**Constraint**: Task scope is determined by `ref` (or by the directive when no `ref` is provided). `context` supplies implementation detail but does NOT expand scope.',
      '',
      '**Constraint**: Provided documents are INPUTS. Do NOT edit them; writes this turn go to the Output Target.',
      '',
    ];
    for (const a of refs) sections.push(`### [ref] ${a.path}`, '', a.content, '');
    for (const a of ctx)  sections.push(`### [context] ${a.path}`, '', a.content, '');
    content.push({ type: 'text', text: sections.join('\n') });
  }
  
  // ✅ 4. Inject previously generated UI docs from pool (gated by task.include from decompose)
  const previousDocs = (!taskInclude || taskInclude.includes(ARTIFACT_PREFIX.UI_ANT))
    ? buildPreviousUiDocsFromPool(state.artifacts || [], task?.id || '')
    : '';
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
      
      const logSuffix = figmaMode ? 'by-figma' : 'by-ref';
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'docGen-uiDesign-fullMessage',
        totalLength,
        {
          taskId: task?.id,
          taskName: task?.name,
          templatePath: `jobs/design/nodes/execute/variants/ui-design-${logSuffix}/base`,
          usedTemplates: [
            `jobs/design/nodes/execute/variants/ui-design-${logSuffix}/rules`,
            `jobs/design/nodes/execute/injections/ui-tokens-guide-${logSuffix}`,
            `jobs/design/nodes/execute/injections/ui-assets-guide-${logSuffix}`,
            `jobs/design/nodes/execute/injections/ui-spec-guide-${logSuffix}`,
          ],
          injectedVariables: {
            systemPrompt: systemPrompt ? `[${systemPrompt.length} chars]` : undefined,
            resourcesSummary: resourcesSummary ? `[${resourcesSummary.length} chars]` : undefined,
            sourceDocs: selectedDocs.length > 0 ? `[${selectedDocs.reduce((s, a) => s + (a.content?.length || 0), 0)} chars, refs=${refs.length}, ctx=${allContext.length}]` : undefined,
            previousDocs: previousDocs ? `[${(previousDocs as string).length} chars]` : undefined,
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
  
  // ✅ 3. Source artifacts (PRD / requirements) — from artifact pool (include policy set by decompose)
  // SSOT: mirror role-guide wording. Source docs arrive via the RAC as
  // `role='context'` for Figma/Ref UI intents and as `role='ref'` for desc
  // intents; either way they are authoritative inputs (ref wins on conflict).
  const freshTaskInclude = (task as DesignTask | undefined)?.include;
  const freshTaskSourceFiles = (task as DesignTask)?.sourceFiles;
  let freshSourceArtifacts = selectArtifacts(state.artifacts || [], { include: [ARTIFACT_PREFIX.SOURCES] });
  if (freshTaskSourceFiles?.length) {
    freshSourceArtifacts = freshSourceArtifacts.filter(a =>
      freshTaskSourceFiles.some(f => a.path.endsWith('/' + f) || a.path === 'inputs/sources/' + f),
    );
  }
  if (freshSourceArtifacts.length > 0) {
    // SSOT: mirror role-guide wording (see buildUiDesignMessages comment).
    const refs = freshSourceArtifacts.filter(a => a.role === 'ref');
    const ctx = freshSourceArtifacts.filter(a => a.role !== 'ref');
    const sections: string[] = [
      '## Provided Documents',
      '',
      '**Principle**: `ref` and `context` documents are both authoritative inputs. Use all of them.',
      '',
      '**Constraint**: `ref` is the original source material. When `ref` and `context` directly conflict on the same property, `ref` wins. Otherwise both are equally binding.',
      '',
      '**Constraint**: Task scope is determined by `ref` (or by the directive when no `ref` is provided). `context` supplies implementation detail but does NOT expand scope.',
      '',
      '**Constraint**: Provided documents are INPUTS. Do NOT edit them; writes this turn go to the Output Target.',
      '',
    ];
    for (const a of refs) sections.push(`### [ref] ${a.path}`, '', a.content, '');
    for (const a of ctx)  sections.push(`### [context] ${a.path}`, '', a.content, '');
    content.push({ type: 'text', text: sections.join('\n') });
  }
  
  // ✅ 4. Inject previously generated UI docs from pool (gated by task.include from decompose)
  const freshPreviousDocs = (!freshTaskInclude || freshTaskInclude.includes(ARTIFACT_PREFIX.UI_ANT))
    ? buildPreviousUiDocsFromPool(state.artifacts || [], task?.id || '')
    : '';
  if (freshPreviousDocs) {
    content.push({
      type: 'text',
      text: freshPreviousDocs
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
    const { FilePromptAdapter } = await import('../../../../../../../periphery/adapters/prompt/FilePromptAdapter');
    const adapter = new FilePromptAdapter();
    const freshFigmaMode = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
    const continuationTemplate = freshFigmaMode
      ? 'jobs/design/nodes/execute/injections/ui-continuation-by-figma'
      : 'jobs/design/nodes/execute/injections/ui-continuation';
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
      
      const freshLogSuffix = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig)) ? 'by-figma' : 'by-ref';
      await logPrompt(
        state.context.featurePath,
        jobIdFresh,
        'design',
        'docGen-uiDesign-freshPrompt',
        totalLength,
        {
          taskId: task?.id,
          taskName: task?.name,
          templatePath: `jobs/design/nodes/execute/variants/ui-design-${freshLogSuffix}/base`,
          usedTemplates: [
            `jobs/design/nodes/execute/variants/ui-design-${freshLogSuffix}/rules`,
            `jobs/design/nodes/execute/injections/ui-tokens-guide-${freshLogSuffix}`,
            `jobs/design/nodes/execute/injections/ui-assets-guide-${freshLogSuffix}`,
            `jobs/design/nodes/execute/injections/ui-spec-guide-${freshLogSuffix}`,
          ],
          injectedVariables: {
            systemPrompt: systemPrompt ? `[${systemPrompt.length} chars]` : undefined,
            resourcesSummary: resourcesSummary ? `[${resourcesSummary.length} chars]` : undefined,
            sourceDocs: freshCombinedSource ? `[${freshCombinedSource.length} chars]` : undefined,
            previousDocs: freshPreviousDocs ? `[${freshPreviousDocs.length} chars]` : undefined,
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
  const isFigmaMode = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
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
 * Build previous UI docs context from artifact pool.
 * Only ui-spec tasks need tokens + assets as REFERENCE.
 */
function buildPreviousUiDocsFromPool(
  pool: import('@ant/shared').ResolvedArtifact[],
  taskId: string,
): string {
  if (!taskId.startsWith('ui-spec')) return '';

  const uiDocs = selectArtifacts(pool, { include: [ARTIFACT_PREFIX.UI_ANT] });
  let injectedDocs = '';

  for (const a of uiDocs) {
    const filename = a.path.split('/').pop() || '';
    if (filename === 'ui-tokens.json' && a.content && !a.content.includes('ant:template')) {
      injectedDocs += `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
      injectedDocs += `# REFERENCE: ui-tokens.json (ALL chapters completed)\n`;
      injectedDocs += `> Use these token keys. Do NOT use raw values that are defined here.\n`;
      injectedDocs += `════════════════════════════════════════════════════════════════════════════════\n\n`;
      injectedDocs += '```json\n' + a.content + '\n```';
    } else if (filename === 'ui-assets.json' && a.content && !a.content.includes('ant:template')) {
      injectedDocs += `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
      injectedDocs += `# REFERENCE: ui-assets.json (ALL chapters completed)\n`;
      injectedDocs += `> Reference these asset identifiers when documenting components.\n`;
      injectedDocs += `════════════════════════════════════════════════════════════════════════════════\n\n`;
      injectedDocs += '```json\n' + a.content + '\n```';
    }
  }

  return injectedDocs;
}

/**
 * Build system prompt for UI Design generation
 * 
 * Loads jobs/design/nodes/execute/variants/ui-design-{by-ref|by-figma}/base.md based on resolvedAction.intent
 * - Includes corresponding rules and injection guides via partials
 * - Injects previousChaptersSummary to prevent duplicate content
 * - Injects siblingTasks for MECE awareness in parallel chapters
 */
export async function buildUiDesignSystemPrompt(state: DesignGraphState): Promise<string> {
  const promptBuilder = state.deps?.promptBuilder;
  
  if (!promptBuilder) {
    throw new Error('[DocGen] PromptBuilder is required but not available in state.deps');
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
      
      const filePath = path.join(featureDirRel, designDirOf(actualTargetFile), actualTargetFile);
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
  const allTasks: Array<{ id: string; name: string; description?: string; targetFile?: string }> = state._allTasksSummary || [];
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
    detectedMode: state.resolvedAction?.mode,
    userLanguage: state.context.userLanguage || 'en',
    resolvedAction: state.resolvedAction,
  };

  const sysFigmaMode = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
  const templateSuffix = sysFigmaMode ? 'by-figma' : 'by-ref';
  const templatePath = `jobs/design/nodes/execute/variants/ui-design-${templateSuffix}/base`;

  const template = await promptBuilder.render(templatePath, injectedVariables);
  
  if (!template) {
    throw new Error(`[DocGen] Failed to load ${templatePath}.md template`);
  }

  const visualTierBasis = await promptBuilder.buildVisualTierBasis(
    state.resolvedAction?.basis,
    'design',
  );
  const finalTemplate = visualTierBasis ? `${visualTierBasis}\n\n${template}` : template;
  
  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'docGen-uiDesign-systemPrompt',
        finalTemplate.length,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          templatePath,
          usedTemplates: [
            `jobs/design/nodes/execute/variants/ui-design-${templateSuffix}/rules`,
            `jobs/design/nodes/execute/injections/ui-tokens-guide-${templateSuffix}`,
            `jobs/design/nodes/execute/injections/ui-assets-guide-${templateSuffix}`,
            `jobs/design/nodes/execute/injections/ui-spec-guide-${templateSuffix}`,
          ],
          injectedVariables: {
            taskDescription: injectedVariables.taskDescription ? `[${injectedVariables.taskDescription.length} chars]` : undefined,
            targetFile: injectedVariables.targetFile,
            detectedMode: injectedVariables.detectedMode,
            isLastTaskForDocument: injectedVariables.isLastTaskForDocument,
            forceAppend: injectedVariables.forceAppend,
            pathPattern: injectedVariables.pathPattern,
            previousChaptersSummary: injectedVariables.previousChaptersSummary ? `[${injectedVariables.previousChaptersSummary.length} chars]` : undefined,
            siblingTasks: injectedVariables.siblingTasks ? `[${injectedVariables.siblingTasks.length} chars]` : undefined,
            visualTierBasis: visualTierBasis ? `[${visualTierBasis.length} chars]` : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log prompt:`, logError);
    }
  }
  
  return finalTemplate;
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

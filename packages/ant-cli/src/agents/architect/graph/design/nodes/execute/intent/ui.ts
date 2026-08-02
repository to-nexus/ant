/**
 * UI Design Prompt Builder
 *
 * Handles message building for ui-design work type:
 * - buildUiDesignMessages: Main message builder
 * - buildUiDesignFreshPrompt: Fresh prompt for tool loop continuation
 * - buildUiDesignSystemPrompt: System prompt loader (from template)
 *
 * NOTE: Task instructions and tool guides are in templates:
 * - variants/ui-design-by-desc/{base,rules}.md (description-driven mode — gen-ui-desc / rev-ui)
 * - variants/ui-design-by-figma/{base,rules}.md (figma mode: MCP-based extraction)
 */

import { DesignGraphState } from '../../../state';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { logPrompt } from '../../../../../../../core/utils/promptLogger';
import { CacheableContent, MessageContentBlock } from '../../../../../../../core/ports/llm';
import { DesignTask } from '../../../../../types/task';
import type { FigmaNodeSummary } from '@ant/shared';
import { designDirOf, ARTIFACT_PREFIX, isFigmaPipeline, isFigmaDataPopulated } from '@ant/shared';
import { composeMessages } from '../../../../../../../core/utils/messageComposer';
import { selectArtifacts } from '../../../../../../../core/prompt/builder/ArtifactPipeline';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';
import { extractLastSectionKey } from '../../../_shared/anchor';
import { buildSelfCheckTrailingMessage } from './selfCheck';
import { deriveExecuteCompactParams } from './executeCompaction';

/**
 * Build multimodal messages for UI Design generation
 *
 * TOOLING-BASED APPROACH:
 * - Tasks load source documents and assets through dedicated tools (rather
 *   than pre-injecting full content) to keep the prompt under the cache
 *   budget.
 * - LLM uses tools when needed:
 *   - list_assets: List asset files for mapping
 */
export async function buildUiDesignMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  const task = state.currentTask;
  
  // ✅ Check if this is a continuation after tool calling
  const nodeExecute = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE);
  const isAfterToolCall = nodeExecute.length > 0;
  
  if (isAfterToolCall) {
    console.log(`🎨 [Execute] UI Design continuing with existing conversation (${nodeExecute.length} messages)`);

    // Build fresh user prompt as initial blocks
    const freshPrompt = await buildUiDesignFreshPrompt(state);

    // R5 self-check: surface the pending-done-check nudge (producer:
    // execute/index.ts sets `_pendingDoneCheck` every artifact-mutation turn
    // without <done>; without a consumer here it was write-only for ui).
    const continuationTask = task as DesignTask | undefined;
    const continuationTargetFile = continuationTask?.targetFile || 'ui-spec.json';
    const continuationDir = continuationTask?.targetDir ?? designDirOf(continuationTargetFile);
    const selfCheck = buildSelfCheckTrailingMessage(state, {
      artifactPath: `${continuationDir}/${continuationTargetFile}`,
    });

    // Compose messages via MessageComposer (handles history skip, compaction, budget)
    const { messages } = composeMessages({
      initialBlocks: freshPrompt,
      priorTurns: nodeExecute as any,
      ...(selfCheck ? { trailingUserMessage: selfCheck } : {}),
      // Window-keyed threshold — the 50K default evicts gathered reads
      // mid-task and refuels the re-read loop (see executeCompaction.ts).
      compactParams: deriveExecuteCompactParams(state),
    });

    return messages;
  }
  
  console.log(`🎨 [Execute] Building UI Design prompt for task: ${task?.id} (tool-based multimodal)`);
  
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

  const designTask = task as DesignTask | undefined;
  // Single injection SSOT — `task.include` (LLM-authored), falling back to
  // SOURCES so a task without an authored manifest still sees its upstream
  // plan docs. Role is inherited from the pool's RAC annotation.
  let selectedDocs = selectArtifacts(state.artifacts || [], {
    include: designTask?.include?.length ? designTask.include : [ARTIFACT_PREFIX.SOURCES],
  });
  if (taskSourceFiles?.length) {
    selectedDocs = selectedDocs.filter(a =>
      taskSourceFiles.some(f => a.path.endsWith('/' + f)),
    );
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
  
  // ✅ 4. Upstream docs (ui-tokens for assets; ui-tokens+ui-assets for spec)
  // are obtained on-disk via `read_file` per the per-file guide Workflow, NOT
  // pre-injected here. The scheduling barrier (barriers.assets/spec) guarantees
  // the upstream doc is fully written before a dependent runs, so the on-disk
  // copy is authoritative (the in-batch pool is not refreshed mid-run).
  
  // ✅ Log prompt structure (not content)
  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      // Calculate total text length
      const totalLength = content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .reduce((sum, c) => sum + c.text.length, 0);
      
      const logHandoff = (task as DesignTask | undefined)?.docFormat === 'handoff';
      const logSuffix = logHandoff ? 'by-handoff' : figmaMode ? 'by-figma' : 'by-desc';
      const uiTpl = logHandoff
        ? TEMPLATE_PATHS.designUiByHandoff
        : figmaMode ? TEMPLATE_PATHS.designUiByFigma : TEMPLATE_PATHS.designUiByDesc;
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'execute-uiDesign-fullMessage',
        totalLength,
        {
          taskId: task?.id,
          taskName: task?.name,
          callIndex: state._executeCallIndex || 0,
          templatePath: uiTpl.base,
          usedTemplates: logHandoff
            ? [
                uiTpl.rules!,
                state.resolvedAction?.mode === 'refactor'
                  ? 'jobs/shared/injections/handoff-bundle-revision'
                  : 'jobs/shared/injections/handoff-package-format',
              ]
            : [
                uiTpl.rules!,
                // ui-{tokens,assets,spec}-guide-{by-figma,by-desc} are injection
                // partials (Tier A auto-injection), not node base/rules — kept
                // as raw literals because they have no TEMPLATE_PATHS slot.
                `jobs/design/nodes/execute/injections/ui-tokens-guide-${logSuffix}`,
                `jobs/design/nodes/execute/injections/ui-assets-guide-${logSuffix}`,
                `jobs/design/nodes/execute/injections/ui-spec-guide-${logSuffix}`,
              ],
          injectedVariables: {
            systemPrompt: systemPrompt ? `[${systemPrompt.length} chars]` : undefined,
            resourcesSummary: resourcesSummary ? `[${resourcesSummary.length} chars]` : undefined,
            sourceDocs: selectedDocs.length > 0 ? `[${selectedDocs.reduce((s, a) => s + (a.content?.length || 0), 0)} chars, refs=${refs.length}, ctx=${ctx.length}]` : undefined,
            assetInventory: state.assetInventory ? `[${state.assetInventory.count} files]` : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Execute] Failed to log full message:`, logError);
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
  const freshTask = task as DesignTask | undefined;
  const freshTaskSourceFiles = freshTask?.sourceFiles;
  // Task include SSOT — same selector as the round-0 builder. The old
  // hard-coded `[SOURCES]` dropped the handoff bundle stubs from every
  // continuation round, blinding REVISE tasks to the bundle they edit.
  let freshSourceArtifacts = selectArtifacts(state.artifacts || [], {
    include: freshTask?.include?.length ? freshTask.include : [ARTIFACT_PREFIX.SOURCES],
  });
  if (freshTaskSourceFiles?.length) {
    freshSourceArtifacts = freshSourceArtifacts.filter(a =>
      freshTaskSourceFiles.some(f => a.path.endsWith('/' + f)),
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
  
  // ✅ 4. Upstream docs obtained on-disk via `read_file` per the per-file
  // guide Workflow (see buildUiDesignMessages note) — not pre-injected here.

  // ✅ 5. Add next-step instruction after tool call (figma mode only).
  // The continuation reminder existed because the legacy reference-image
  // pipeline split the task into "discover refs (Turn 1) → load image
  // (Turn 2) → emit JSON (Turn 3+)" and the LLM would otherwise stall
  // before emitting the file. Figma mode keeps the same shape (probe
  // metadata → fetch design context → emit JSON), so the figma-specific
  // continuation partial still applies. Description mode generates the
  // document directly from the prompt and does not need a continuation
  // reminder; if the LLM happens to call `list_assets` first the regular
  // execute prompt is enough to keep it going.
  const freshFigmaMode = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
  const isUiTokensTask = task?.id?.startsWith('ui-tokens');
  const isUiSpecTask = task?.id?.startsWith('ui-spec');

  if (freshFigmaMode && (isUiTokensTask || isUiSpecTask)) {
    const targetDoc = isUiTokensTask ? 'ui-tokens.json' : 'ui-spec.json';
    console.log(`🔔 [FreshPrompt] Adding "Next Steps" instruction for ${task?.id} → ${targetDoc}`);
    const { FilePromptAdapter } = await import('../../../../../../../periphery/adapters/prompt/FilePromptAdapter');
    const adapter = new FilePromptAdapter();
    const continuationText = await adapter.render(
      'jobs/design/nodes/execute/injections/ui-continuation-by-figma',
      { targetDoc },
    );
    content.push({
      type: 'text',
      text: `\n\n${continuationText}`,
    });
  }
  
  // ✅ Log prompt structure (not content) - tool loop continuation
  const jobIdFresh = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      const totalLength = content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .reduce((sum, c) => sum + c.text.length, 0);
      
      const freshFigmaMode = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
      const freshHandoff = (task as DesignTask | undefined)?.docFormat === 'handoff';
      const freshLogSuffix = freshHandoff ? 'by-handoff' : freshFigmaMode ? 'by-figma' : 'by-desc';
      const freshUiTpl = freshHandoff
        ? TEMPLATE_PATHS.designUiByHandoff
        : freshFigmaMode ? TEMPLATE_PATHS.designUiByFigma : TEMPLATE_PATHS.designUiByDesc;
      await logPrompt(
        state.context.featurePath,
        jobIdFresh,
        'design',
        'execute-uiDesign-freshPrompt',
        totalLength,
        {
          taskId: task?.id,
          taskName: task?.name,
          callIndex: state._executeCallIndex || 0,
          templatePath: freshUiTpl.base,
          usedTemplates: freshHandoff
            ? [
                freshUiTpl.rules!,
                state.resolvedAction?.mode === 'refactor'
                  ? 'jobs/shared/injections/handoff-bundle-revision'
                  : 'jobs/shared/injections/handoff-package-format',
              ]
            : [
                freshUiTpl.rules!,
                `jobs/design/nodes/execute/injections/ui-tokens-guide-${freshLogSuffix}`,
                `jobs/design/nodes/execute/injections/ui-assets-guide-${freshLogSuffix}`,
                `jobs/design/nodes/execute/injections/ui-spec-guide-${freshLogSuffix}`,
              ],
          injectedVariables: {
            systemPrompt: systemPrompt ? `[${systemPrompt.length} chars]` : undefined,
            resourcesSummary: resourcesSummary ? `[${resourcesSummary.length} chars]` : undefined,
            sourceDocs: freshSourceArtifacts.length > 0 ? `[${freshSourceArtifacts.reduce((s, a) => s + (a.content?.length || 0), 0)} chars, count=${freshSourceArtifacts.length}]` : undefined,
            isUiTokensTask,
            isUiSpecTask,
            isFreshPrompt: true,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Execute] Failed to log fresh prompt:`, logError);
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
 * - Counts of available assets
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
    const handoffMode = (state.currentTask as DesignTask | undefined)?.docFormat === 'handoff';
    resourcesSummary += '## Description-driven Mode\n';
    resourcesSummary += handoffMode
      ? 'No external visual source is provided. Treat the directive plus PRD / source documents listed below as the design authority and author the handoff bundle file directly from them.\n\n'
      : 'No external visual source is provided. Treat the directive plus PRD / source documents listed below as the design authority and produce the UI documents directly from them.\n\n';
  }

  const handoffAssets = (state.currentTask as DesignTask | undefined)?.docFormat === 'handoff';
  resourcesSummary += '\n## Asset Files (real, already placed under assets/service/)\n';
  const inv = state.assetInventory;
  if (inv?.count) {
    resourcesSummary += handoffAssets
      ? `There are ${inv.count} real asset file(s). When a bundle file needs one, reference it by its exact path below; use \`list_assets\` for detail.\n`
      : `There are ${inv.count} real asset file(s). Map the ones the UI needs into ui-assets.json with \`src\` = the exact path below; use \`list_assets\` for detail.\n`;
    for (const [group, files] of Object.entries(inv.groups ?? {})) {
      if (files.length === 0) continue;
      resourcesSummary += `- ${group}: ${files.slice(0, 20).map(f => f.split('/').pop()).join(', ')}${files.length > 20 ? ` … (+${files.length - 20})` : ''}\n`;
    }
    resourcesSummary += '\n';
  } else {
    resourcesSummary += handoffAssets
      ? 'No real asset files placed yet — author needed vector assets inside the bundle, never in a workspace directory outside the bundle root: shared marks / state illustrations as svg files in the bundle\'s `assets/`, per-content normal-state imagery inline in the consuming page.\n\n'
      : 'No real asset files placed yet — document needed slots as placeholder `src` paths under `assets/service/<category>/`.\n\n';
  }

  return resourcesSummary;
}

/**
 * Build system prompt for UI Design generation
 *
 * Loads jobs/design/nodes/execute/variants/ui-design-{by-desc|by-figma}/base.md based on resolvedAction.intent
 * - Includes corresponding rules and injection guides via partials
 * - Injects previousChaptersSummary to prevent duplicate content
 * - Injects siblingTasks for MECE awareness in parallel chapters
 */
export async function buildUiDesignSystemPrompt(state: DesignGraphState): Promise<string> {
  const promptBuilder = state.deps?.promptBuilder;
  
  if (!promptBuilder) {
    throw new Error('[Execute] PromptBuilder is required but not available in state.deps');
  }
  
  let previousChaptersSummary = '';
  let existingFileContent = '';
  let liveAnchor: string | null = null;
  // Per-file write strategy: REVISE only when the target actually exists on
  // disk (observed below). Defaults to the job mode when the disk read is
  // unavailable so behavior degrades to the legacy detectedMode gate.
  let targetExists = state.resolvedAction?.mode === 'refactor';

  const taskId = state.currentTask?.id || '';
  const taskDescription = state.currentTask?.description || '';
  const targetFile = state.currentTask?.targetFile;
  const uiDesignTask = state.currentTask as DesignTask | undefined;
  const isHandoff = uiDesignTask?.docFormat === 'handoff';
  if (isHandoff && !targetFile) {
    // Decompose fail-loud guarantees targetFile for handoff tasks; a miss here
    // means a stale checkpoint or a non-decompose writer.
    throw new Error(`[Execute UI] handoff task "${taskId}" is missing targetFile`);
  }

  // Determine target file from task ID if not explicitly set
  const actualTargetFile = targetFile ||
    (taskId.startsWith('ui-tokens') ? 'ui-tokens.json' :
     taskId.startsWith('ui-assets') ? 'ui-assets.json' :
     taskId.startsWith('ui-spec') ? 'ui-spec.json' : 'ui-spec.json');
  // Handoff files (DESIGN.md / tokens/*.css / screens/*.html) carry no
  // ant-canonical prefix — targetDir is the placement authority.
  const targetDirRel = uiDesignTask?.targetDir ?? designDirOf(actualTargetFile);
  
  // Pre-computed at decompose time (taskQueue is not accessible in worker subgraph)
  const isLastTaskForDocument = !!(state.currentTask as DesignTask)?.isLastTaskForDocument;
  const forceAppend = !!(state.currentTask as DesignTask)?.forceAppend;
  if (isLastTaskForDocument) {
    console.log(`📄 [Execute UI] This is the LAST task for ${actualTargetFile} - will NOT output metadata`);
  }
  if (forceAppend) {
    console.log(`📄 [Execute UI] forceAppend=true for ${taskId} — parallel chapter, will use <append>`);
  }
  
  // ✅ Check if file exists and extract last section number + existing sections
  if (state.deps?.fileSystem && state.context.featurePath) {
    try {
      const path = await import('path');
      const rootPath = state.deps.fileSystem.getRootPath?.() || '';
      const featureDirRel = rootPath
        ? path.relative(rootPath, state.context.featurePath)
        : state.context.featurePath.replace(/^\//, '');
      
      const filePath = path.join(featureDirRel, targetDirRel, actualTargetFile);
      const fileExists = await state.deps.fileSystem.fileExists(filePath);
      
      if (fileExists) {
        targetExists = true;
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
              console.warn(`📄 [Execute UI] Failed to parse ${actualTargetFile} as JSON:`, parseError);
            }
          }

          // Compute live insertion anchor from current disk state. This is the SSOT
          // for the appendAnchor prompt variable — decompose's earlier pre-computation
          // was retired because it always saw an empty file in new-build scenarios.
          liveAnchor = extractLastSectionKey(existingFileContent);

          if (previousChaptersSummary) {
            console.log(`📄 [Execute UI] Extracted summary from existing ${actualTargetFile}${liveAnchor ? ` (anchor=${liveAnchor})` : ''}`);
          }
        }
      } else {
        targetExists = false;
        console.log(`📄 [Execute UI] ${actualTargetFile} does not exist yet (first chapter)`);
      }
    } catch (error) {
      console.error(`[Execute UI] Error reading ${actualTargetFile}:`, error);
    }
  }
  
  // Build sibling tasks summary for MECE awareness in parallel chapters
  const allTasks: Array<{ id: string; name: string; description?: string; targetFile?: string; priority?: number }> = state._allTasksSummary || [];
  const siblingTasks = allTasks
    .filter(t => t.targetFile === actualTargetFile && t.id !== taskId)
    .map(t => `- ${t.id}: ${t.name} — ${t.description?.substring(0, 200) || ''}`)
    .join('\n');

  // Handoff bundles guarantee one writer per file, so `siblingTasks` (same target)
  // is always empty there. The bundle's OTHER files are what a task must be able to
  // address for the read-before-bind contract to be actionable.
  const bundleFileMap = isHandoff
    ? allTasks
        .filter(t => t.targetFile && t.targetFile !== actualTargetFile)
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
        .map(t => `- \`${t.targetFile}\` — ${t.name}`)
        .join('\n')
    : '';

  // Merge-then-delete carrier → full workspace-relative paths for delete_file.
  const removeFilePaths = (uiDesignTask?.removeFiles ?? []).map((rf) => `${targetDirRel}/${rf}`);

  const injectedVariables = {
    taskId: state.currentTask?.id,
    taskName: state.currentTask?.name,
    taskDescription,
    targetFile: actualTargetFile,
    targetPath: `${targetDirRel}/${actualTargetFile}`,
    previousChaptersSummary,
    isLastTaskForDocument,
    forceAppend,
    siblingTasks: siblingTasks || '',
    bundleFileMap: bundleFileMap || undefined,
    // Live anchor: last section identifier in the current target file, computed
    // this turn against disk state. Null when the file does not exist yet, is not
    // a section-keyed JSON, or is unparseable. The execute template's anchor
    // partial self-gates on truthiness. See `_shared/anchor.ts` for the SSOT.
    appendAnchor: liveAnchor,
    removeFilePaths: removeFilePaths.length > 0 ? removeFilePaths : undefined,
    detectedMode: state.resolvedAction?.mode,
    // Per-file write-strategy gate (REVISE vs GENERATE) — disk observation,
    // not job mode: a refactor job may add files that don't exist yet.
    targetExists,
    userLanguage: state.context.userLanguage || 'en',
    resolvedAction: state.resolvedAction,
  };

  const sysFigmaMode = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
  const templateSuffix = isHandoff ? 'by-handoff' : sysFigmaMode ? 'by-figma' : 'by-desc';
  const sysUiTpl = isHandoff
    ? TEMPLATE_PATHS.designUiByHandoff
    : sysFigmaMode ? TEMPLATE_PATHS.designUiByFigma : TEMPLATE_PATHS.designUiByDesc;
  const templatePath = sysUiTpl.base;

  const template = await promptBuilder.render(templatePath, injectedVariables);

  if (!template) {
    throw new Error(`[Execute] Failed to load ${templatePath}.md template`);
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
        'execute-uiDesign-systemPrompt',
        finalTemplate.length,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          callIndex: state._executeCallIndex || 0,
          templatePath,
          usedTemplates: isHandoff
            ? [
                sysUiTpl.rules!,
                state.resolvedAction?.mode === 'refactor'
                  ? 'jobs/shared/injections/handoff-bundle-revision'
                  : 'jobs/shared/injections/handoff-package-format',
              ]
            : [
                sysUiTpl.rules!,
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
            previousChaptersSummary: injectedVariables.previousChaptersSummary ? `[${injectedVariables.previousChaptersSummary.length} chars]` : undefined,
            siblingTasks: injectedVariables.siblingTasks ? `[${injectedVariables.siblingTasks.length} chars]` : undefined,
            visualTierBasis: visualTierBasis ? `[${visualTierBasis.length} chars]` : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Execute] Failed to log prompt:`, logError);
    }
  }
  
  return finalTemplate;
}


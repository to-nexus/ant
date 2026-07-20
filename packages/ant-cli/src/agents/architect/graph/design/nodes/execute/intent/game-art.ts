/**
 * Game-Art Design Prompt Builder
 *
 * Game-domain peer of `intent/ui.ts` (D28 vertical split). Handles message
 * building for game-art design work:
 * - buildGameArtMessages: main message builder
 * - buildGameArtFreshPrompt: fresh prompt for tool loop continuation
 * - buildGameArtSystemPrompt: system prompt loader (from template)
 *
 * Task instructions and per-file guides live in templates:
 * - variants/game-art-by-desc/{base,rules}.md (directive-driven — gen-game-art-desc / rev-game-art)
 * - variants/game-art-by-figma/{base,rules}.md (figma/workfile mode — gen-game-art-figma, Phase 5+)
 *
 * The three canonical catalogs are game-art-tokens.json / game-art-assets.json
 * / game-art-spec.json under visual/game-art/ant/ (mirrors visual/ui/ant/).
 */

import { DesignGraphState } from '../../../state';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { logPrompt } from '../../../../../../../core/utils/promptLogger';
import { CacheableContent, MessageContentBlock } from '../../../../../../../core/ports/llm';
import { DesignTask } from '../../../../../types/task';
import { designDirOf, ARTIFACT_PREFIX, getRACDocuments } from '@ant/shared';
import type { ResolvedArtifact } from '@ant/shared';
import { composeMessages } from '../../../../../../../core/utils/messageComposer';
import { selectArtifacts, ArtifactPoolView } from '../../../../../../../core/prompt/builder/ArtifactPipeline';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';
import { extractLastSectionKey } from '../../../_shared/anchor';

/** Figma/workfile mode is opted into only by the figma intent (Phase 5+). */
function isGameArtFigmaMode(state: DesignGraphState): boolean {
  return state.resolvedAction?.intent === 'gen-game-art-figma';
}

/** Resolve the target catalog filename from the task (id fallback). */
function resolveGameArtTargetFile(state: DesignGraphState): string {
  const taskId = state.currentTask?.id || '';
  return state.currentTask?.targetFile
    || (taskId.startsWith('game-art-tokens') ? 'game-art-tokens.json'
      : taskId.startsWith('game-art-assets') ? 'game-art-assets.json'
      : taskId.startsWith('game-art-spec') ? 'game-art-spec.json'
      : 'game-art-spec.json');
}

/**
 * Shared "Provided Documents" block. Mirrors the role-guide wording used by
 * the UI builder so authority semantics stay consistent across surfaces.
 */
function buildProvidedDocsSection(docs: ResolvedArtifact[]): string | null {
  if (docs.length === 0) return null;
  const refs = docs.filter(a => a.role === 'ref');
  const ctx = docs.filter(a => a.role !== 'ref');
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
  return sections.join('\n');
}

/**
 * Build multimodal messages for game-art catalog generation.
 * Tool-based: source docs arrive via the pool (task.include), assets via list_assets.
 */
export async function buildGameArtMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  const task = state.currentTask;

  const nodeExecute = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE);
  const isAfterToolCall = nodeExecute.length > 0;

  if (isAfterToolCall) {
    console.log(`🎮 [Execute] Game-Art continuing with existing conversation (${nodeExecute.length} messages)`);
    const freshPrompt = await buildGameArtFreshPrompt(state);
    const { messages } = composeMessages({
      initialBlocks: freshPrompt,
      priorTurns: nodeExecute as any,
    });
    return messages;
  }

  console.log(`🎮 [Execute] Building Game-Art prompt for task: ${task?.id} (tool-based)`);

  const content: CacheableContent[] = [];

  const systemPrompt = await buildGameArtSystemPrompt(state);
  content.push({ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } });

  content.push({ type: 'text', text: buildResourcesSummary(state) });

  // Source docs (PRD / directive) from the pool — task.include SSOT, SOURCES fallback.
  const designTask = task as DesignTask | undefined;
  const taskSourceFiles = designTask?.sourceFiles ? [...designTask.sourceFiles] : undefined;
  let selectedDocs = selectArtifacts(state.artifacts || [], {
    include: designTask?.include?.length ? designTask.include : [ARTIFACT_PREFIX.SOURCES],
  });
  if (taskSourceFiles?.length) {
    selectedDocs = selectedDocs.filter(a => taskSourceFiles.some(f => a.path.endsWith('/' + f)));
  }
  const providedDocs = buildProvidedDocsSection(selectedDocs);
  if (providedDocs) content.push({ type: 'text', text: providedDocs });

  // Upstream catalogs (tokens for assets; tokens+assets for spec) are NOT
  // pre-injected — dependents read them on-disk via `read_file` per the
  // per-file guide's Workflow. The scheduling barrier (barriers.assets/spec)
  // guarantees the upstream catalog is fully written before a dependent runs,
  // so the on-disk copy is authoritative (the in-batch pool is not refreshed
  // mid-run — see design/graph.ts pool-merge timing).

  await logGameArtPrompt(state, 'execute-gameArt-fullMessage', content, {
    taskId: task?.id,
    taskName: task?.name,
    sourceDocs: selectedDocs.length,
  });

  return [{ role: 'user', content }];
}

/** Fresh user prompt for tool-loop continuation. */
export async function buildGameArtFreshPrompt(state: DesignGraphState): Promise<CacheableContent[]> {
  const content: CacheableContent[] = [];
  const task = state.currentTask;

  const systemPrompt = await buildGameArtSystemPrompt(state);
  content.push({ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } });

  content.push({ type: 'text', text: buildResourcesSummary(state) });

  const designTask = task as DesignTask | undefined;
  const taskSourceFiles = designTask?.sourceFiles;
  let sourceArtifacts = selectArtifacts(state.artifacts || [], { include: [ARTIFACT_PREFIX.SOURCES] });
  if (taskSourceFiles?.length) {
    sourceArtifacts = sourceArtifacts.filter(a => taskSourceFiles.some(f => a.path.endsWith('/' + f)));
  }
  const providedDocs = buildProvidedDocsSection(sourceArtifacts);
  if (providedDocs) content.push({ type: 'text', text: providedDocs });

  // Upstream catalogs obtained via `read_file` (see buildGameArtMessages note).

  await logGameArtPrompt(state, 'execute-gameArt-freshPrompt', content, {
    taskId: task?.id,
    taskName: task?.name,
    sourceDocs: sourceArtifacts.length,
    isFreshPrompt: true,
  });

  return content;
}

/**
 * Build the system prompt for game-art catalog generation.
 * Loads game-art-by-{desc|figma}/base.md and prepends the gameArtTier basis.
 */
export async function buildGameArtSystemPrompt(state: DesignGraphState): Promise<string> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Execute] PromptBuilder is required but not available in state.deps');
  }

  let previousChaptersSummary = '';
  let liveAnchor: string | null = null;

  const taskId = state.currentTask?.id || '';
  const taskDescription = state.currentTask?.description || '';
  const actualTargetFile = resolveGameArtTargetFile(state);
  const designTask = state.currentTask as DesignTask | undefined;
  const isHandoff = designTask?.docFormat === 'handoff';
  // Handoff files (DESIGN.md / tokens/*.css / entities/*.html) carry no
  // ant-canonical prefix — targetDir is the placement authority.
  const targetDirRel = designTask?.targetDir ?? designDirOf(actualTargetFile);

  const isLastTaskForDocument = !!(state.currentTask as DesignTask)?.isLastTaskForDocument;
  const forceAppend = !!(state.currentTask as DesignTask)?.forceAppend;

  // Read the current on-disk catalog to compute forbidden-category summary + anchor.
  if (state.deps?.fileSystem && state.context.featurePath) {
    try {
      const path = await import('path');
      const rootPath = state.deps.fileSystem.getRootPath?.() || '';
      const featureDirRel = rootPath
        ? path.relative(rootPath, state.context.featurePath)
        : state.context.featurePath.replace(/^\//, '');
      const filePath = path.join(featureDirRel, targetDirRel, actualTargetFile);
      if (await state.deps.fileSystem.fileExists(filePath)) {
        const existing = await state.deps.fileSystem.readFile(filePath) || '';
        if (existing) {
          if (actualTargetFile.endsWith('.json')) {
            try {
              const parsed = JSON.parse(existing);
              const dataKeys = Object.keys(parsed).filter(k => k !== '_meta');
              if (dataKeys.length > 0) {
                previousChaptersSummary = dataKeys.map((k, i) => `- Category ${i + 1}: ${k}`).join('\n');
              }
            } catch (parseError) {
              console.warn(`🎮 [Execute Game-Art] Failed to parse ${actualTargetFile} as JSON:`, parseError);
            }
          }
          liveAnchor = extractLastSectionKey(existing);
        }
      } else {
        console.log(`🎮 [Execute Game-Art] ${actualTargetFile} does not exist yet (first chapter)`);
      }
    } catch (error) {
      console.error(`[Execute Game-Art] Error reading ${actualTargetFile}:`, error);
    }
  }

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
    targetPath: `${targetDirRel}/${actualTargetFile}`,
    previousChaptersSummary,
    isLastTaskForDocument,
    forceAppend,
    siblingTasks: siblingTasks || '',
    appendAnchor: liveAnchor,
    detectedMode: state.resolvedAction?.mode,
    userLanguage: state.context.userLanguage || 'en',
    resolvedAction: state.resolvedAction,
  };

  const figmaMode = isGameArtFigmaMode(state);
  const tpl = isHandoff
    ? TEMPLATE_PATHS.designGameArtByHandoff
    : figmaMode ? TEMPLATE_PATHS.designGameArtByFigma : TEMPLATE_PATHS.designGameArtByDesc;
  const template = await promptBuilder.render(tpl.base, injectedVariables);
  if (!template) {
    throw new Error(`[Execute] Failed to load ${tpl.base}.md template`);
  }

  // Game-domain peer of buildVisualTierBasis — visualTier is inactive for game.
  // The `concept` aesthetic layer seeds a fresh handoff (gen-game-art-desc) but
  // steps aside when a game-art reference (figma / ant-json / existing handoff)
  // is already the art authority in the RAC — read from the RAC inputs
  // (resolvedAction.refs ∪ context), NOT the mutated pool, so a producer's own
  // mid-job self-output never triggers suppression.
  const racGameArtDoc = state.resolvedAction
    ? new ArtifactPoolView(getRACDocuments(state.resolvedAction)).hasGameArt()
    : false;
  const gameArtTierBasis = await promptBuilder.buildGameArtTierBasis(
    state.resolvedAction?.basis,
    'design',
    { suppressConcept: racGameArtDoc },
  );
  const finalTemplate = gameArtTierBasis ? `${gameArtTierBasis}\n\n${template}` : template;

  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    const logSuffix = isHandoff ? 'by-handoff' : figmaMode ? 'by-figma' : 'by-desc';
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'execute-gameArt-systemPrompt',
        finalTemplate.length,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          templatePath: tpl.base,
          usedTemplates: isHandoff
            ? [tpl.rules!, 'jobs/shared/injections/handoff-package-format']
            : [
                tpl.rules!,
                `jobs/design/nodes/execute/injections/game-art-tokens-guide-${logSuffix}`,
                `jobs/design/nodes/execute/injections/game-art-assets-guide-${logSuffix}`,
                `jobs/design/nodes/execute/injections/game-art-spec-guide-${logSuffix}`,
              ],
          injectedVariables: {
            taskDescription: injectedVariables.taskDescription ? `[${injectedVariables.taskDescription.length} chars]` : undefined,
            targetFile: injectedVariables.targetFile,
            detectedMode: injectedVariables.detectedMode,
            isLastTaskForDocument: injectedVariables.isLastTaskForDocument,
            forceAppend: injectedVariables.forceAppend,
            previousChaptersSummary: injectedVariables.previousChaptersSummary ? `[${injectedVariables.previousChaptersSummary.length} chars]` : undefined,
            siblingTasks: injectedVariables.siblingTasks ? `[${injectedVariables.siblingTasks.length} chars]` : undefined,
            gameArtTierBasis: gameArtTierBasis ? `[${gameArtTierBasis.length} chars]` : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Execute] Failed to log game-art prompt:`, logError);
    }
  }

  return finalTemplate;
}

/** Runtime resources summary (dynamic — asset counts, mode note). */
function buildResourcesSummary(state: DesignGraphState): string {
  const isHandoff = (state.currentTask as DesignTask | undefined)?.docFormat === 'handoff';
  let summary = '\n\n# Available Resources\n\n';
  if (isGameArtFigmaMode(state)) {
    summary += '## Figma / Workfile Mode\n';
    summary += 'Use the Figma MCP tools to observe the source directly, then catalog what you observe.\n\n';
  } else {
    summary += '## Description-driven Mode\n';
    summary += isHandoff
      ? 'No external visual source is provided. Treat the directive plus PRD / source documents below as the design authority and author the handoff bundle file directly from them.\n\n'
      : 'No external visual source is provided. Treat the directive plus PRD / source documents below as the design authority and produce the catalogs directly from them.\n\n';
  }
  summary += '## Asset Files (real, already placed under assets/game/)\n';
  const inv = state.assetInventory;
  if (inv?.count) {
    summary += isHandoff
      ? `There are ${inv.count} real asset file(s). When a bundle file needs one, reference it by its exact path below; use \`list_assets\` for more detail.\n`
      : `There are ${inv.count} real asset file(s). Reference the ones that fit each category as \`kind:'external'\` (\`src\` = the exact path below); use \`list_assets\` for more detail.\n`;
    for (const [group, files] of Object.entries(inv.groups ?? {})) {
      if (files.length === 0) continue;
      summary += `- ${group}: ${files.slice(0, 20).map(f => f.split('/').pop()).join(', ')}${files.length > 20 ? ` … (+${files.length - 20})` : ''}\n`;
    }
    summary += '\n';
  } else {
    summary += isHandoff
      ? 'No real asset files are placed yet — author needed vector assets as svg files inside the bundle\'s `assets/` directory instead of pointing at missing files.\n\n'
      : 'No real asset files are placed yet — author entries as `kind:\'inline\'` primitives (the code-fulfillable floor).\n\n';
  }
  return summary;
}

/** Log prompt structure (not content). Best-effort. */
async function logGameArtPrompt(
  state: DesignGraphState,
  phase: string,
  content: CacheableContent[],
  extra: Record<string, unknown>,
): Promise<void> {
  if (!state.context.featurePath) return;
  const jobId = state.jobId || state._httpJobId || 'unknown';
  const figmaMode = isGameArtFigmaMode(state);
  const handoffMode = (state.currentTask as DesignTask | undefined)?.docFormat === 'handoff';
  const logSuffix = handoffMode ? 'by-handoff' : figmaMode ? 'by-figma' : 'by-desc';
  const tpl = handoffMode
    ? TEMPLATE_PATHS.designGameArtByHandoff
    : figmaMode ? TEMPLATE_PATHS.designGameArtByFigma : TEMPLATE_PATHS.designGameArtByDesc;
  try {
    const totalLength = content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .reduce((sum, c) => sum + c.text.length, 0);
    await logPrompt(state.context.featurePath, jobId, 'design', phase, totalLength, {
      taskId: extra.taskId as string | undefined,
      taskName: extra.taskName as string | undefined,
      templatePath: tpl.base,
      usedTemplates: handoffMode
        ? [tpl.rules!, 'jobs/shared/injections/handoff-package-format']
        : [
            tpl.rules!,
            `jobs/design/nodes/execute/injections/game-art-tokens-guide-${logSuffix}`,
            `jobs/design/nodes/execute/injections/game-art-assets-guide-${logSuffix}`,
            `jobs/design/nodes/execute/injections/game-art-spec-guide-${logSuffix}`,
          ],
      injectedVariables: extra,
    });
  } catch (logError) {
    console.warn(`⚠️  [Execute] Failed to log ${phase}:`, logError);
  }
}

/**
 * Design plan-phase prompt builder.
 *
 * Renders `jobs/design/nodes/plan/base.md` with intent-group dispatch
 * to the `variants/{spec,system-design}/{base,rules}` partials. Mirrors
 * the artifact-pipeline + cache-block pattern used by `execute/intent/spec`.
 *
 * Returns `TextContentBlock[]` so Anthropic prompt caching can split
 * the stable system / artifact content from the runtime user turn —
 * `buildCacheableBlocks` already implements the standard 3-block layout.
 */

import type { TextContentBlock } from '../../../../../../core/ports/llm';
import type { DesignGraphState } from '../../state';
import type { DesignTask } from '../../../../types/task';
import type { PromptBuildConfig } from '../../../../../../core/prompt/builder/PromptBuildConfig';
import { TEMPLATE_PATHS } from '../../../../../../core/prompt/builder/templatePaths';
import { buildCacheableBlocks } from '../../../../../../core/prompt/builder/CacheBlockMapper';
import { ARTIFACT_PREFIX } from '@ant/shared';
import { referenceCatalogVars } from '../../../../../common/tool/reference/catalogVars';
import {
  selectArtifacts,
} from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { loadExistingDesignDoc } from '../checkTaskStatus/loadExistingDesignDoc';

export interface BuildDesignPlanPromptResult {
  blocks: TextContentBlock[];
}

export async function buildPlanPromptBlocks(
  state: DesignGraphState,
  task: DesignTask,
): Promise<BuildDesignPlanPromptResult> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[DesignPlan] PromptBuilder not available');
  }

  const intentGroup = state.resolvedAction?.intentGroup ?? 'design-spec';
  const directive = state.overrideDirective || state.directive || '';
  const detectedMode = state.resolvedAction?.mode || 'generate';

  // Artifact selection — mirrors `design/nodes/execute/intent/spec.ts`.
  const taskAny = task as any;
  const taskSourceFiles: string[] | undefined = taskAny?.sourceFiles;
  // Single injection SSOT — `task.include` (LLM-authored), SOURCES fallback.
  let selectedArtifacts = selectArtifacts(state.artifacts || [], {
    include: taskAny?.include?.length ? taskAny.include : [ARTIFACT_PREFIX.SOURCES],
  });

  if (taskSourceFiles?.length) {
    const planPrefix = `${ARTIFACT_PREFIX.SOURCES}/`;
    selectedArtifacts = selectedArtifacts.filter((a) =>
      !a.path.startsWith(ARTIFACT_PREFIX.SOURCES) ||
      taskSourceFiles.some((f) => a.path.endsWith('/' + f) || a.path === planPrefix + f),
    );
  }

  const sectionIndex: number = taskAny?.sectionIndex ?? 0;
  const totalSections: number = taskAny?.totalSections ?? 1;
  const sectionScope: string = taskAny?.sectionScope ?? '';

  const refCat = await referenceCatalogVars(state);
  const config: PromptBuildConfig = {
    // designPlan triple includes a `rules` field; the design plan node
    // intentionally renders rules as a partial inside `base.md` rather than
    // through PromptBuilder's rules slot. Passing only base+system keeps
    // that wiring unchanged while still referencing the SSOT.
    templates: {
      base: TEMPLATE_PATHS.designPlan.base,
      system: TEMPLATE_PATHS.designPlan.system!,
    },
    pipeline: {
      sanitizeInput: true,
      applyPolicyGuardrails: false,
    },
    artifacts: selectedArtifacts,
    vars: {
      ...refCat,
      intentGroup,
      detectedMode,
      currentTask: {
        id: task.id,
        name: task.name,
        type: task.type,
        description: task.description,
        priority: task.priority,
        targetFile: (task as any).targetFile,
      },
      sectionIndex,
      totalSections,
      sectionScope,
      directive,
      hasTools: true,
      figmaAvailable: state.figmaAvailable === true,
      figmaFileKey: state.figmaFileKey,
      figmaStartNodeId: state.figmaStartNodeId,
      resolvedAction: state.resolvedAction,
      featureContext: state.featureContext,
      userLanguage: state.context.userLanguage || 'en',
      workspaceState: state.workspaceState,
    },
  };

  const promptResult = await promptBuilder.build(config);

  // Revision contract (refactor mode): the plan's object is the EXISTING
  // document — inject its body deterministically so the plan never depends
  // on the LLM electing to read it via tools. Same disk-first sourcing as
  // execute (`spec.ts`), single loader owner.
  const contextParts: string[] = [];
  if (detectedMode === 'refactor' && (task as any)?.targetFile) {
    const existing = await loadExistingDesignDoc(
      state,
      (task as any).targetFile,
      (task as any).targetDir,
    );
    if (existing) {
      contextParts.push(`# Existing Document (revision target)\n\n${existing}`);
      console.log(
        `📋 [DesignPlan] Loaded existing doc for revision plan: ${(task as any).targetFile} (${existing.length} chars)`,
      );
    } else {
      console.warn(
        `⚠️  [DesignPlan] Existing doc not readable for refactor plan: ${(task as any).targetFile}`,
      );
    }
  }

  const blocks = buildCacheableBlocks(promptResult, {
    contextParts: contextParts.length > 0 ? contextParts : undefined,
  });

  return { blocks: blocks as TextContentBlock[] };
}

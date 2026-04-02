/**
 * Sketch Node (Visual Graph)
 *
 * Draft exploration — generates multiple candidate images using Flash model.
 * Fast, low-cost generation for user to choose from.
 * Uses gemini-3.1-flash-image-preview (Nano Banana 2).
 */

import * as fs from 'fs';
import * as path from 'path';
import { VisualGraphState, DraftImage } from '../types.js';
import { SafetyBlockError } from '../../../../../periphery/adapters/llm/GeminiImageClient.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';

export async function sketchNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n✏️ [Visual:Sketch] Generating draft candidates...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('sketch', state._uiLocale as any), 'sketch');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'sketch', 0);
  }

  const chatAPI = getChatAPIClient();
  await chatAPI.startMessage();

  const imageClient = state.deps.sketchImageClient;
  const candidateCount = state.visualSettings?.candidateCount ?? 3;
  const prompt = state.engineeredPrompt || state.directive || '';
  const aspectRatio = state.resolvedAspectRatio || state.visualSettings?.defaultAspectRatio || '1:1';

  const refImage = loadSketchReference(state);

  console.log(`✏️ [Visual:Sketch] Prompt: ${prompt.substring(0, 100)}...`);
  console.log(`✏️ [Visual:Sketch] Candidates: ${candidateCount}, ratio: ${aspectRatio}${refImage ? ' +refImage' : ''}`);

  try {
    const generated = await imageClient.generate(prompt, {
      numberOfImages: candidateCount,
      outputFormat: 'jpeg',
      aspectRatio,
      temperature: 1.2,
      referenceImage: refImage,
    });

    const draftImages: DraftImage[] = generated.map((img, i) => ({
      data: img.data,
      mimeType: img.mimeType,
      prompt: img.prompt,
      modelConfig: {
        model: (imageClient as any).modelName || 'gemini-3.1-flash-image-preview',
        aspectRatio,
      },
      modelResponseMetadata: img.modelResponseMetadata || {},
      index: i,
    }));

    console.log(`✏️ [Visual:Sketch] Generated ${draftImages.length} drafts`);

    if (state._httpJobId) {
      try {
        const byteSizes = draftImages.map((d, i) => `[draft ${i + 1}] ${d.data.length} bytes`).join(', ');
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'sketch', prompt.length, {
          injectedVariables: { candidateCount, aspectRatio, hasReferenceImage: !!refImage },
          hardcodedContent: `engineeredPrompt: ${prompt}\n\nResult: ${draftImages.length}/${candidateCount} drafts — ${byteSizes}`,
        });
      } catch { /* non-critical */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'sketch', 0);
    }

    return {
      draftImages,
      visualError: undefined,
      safetyBlocked: false,
      _phaseTimings: { ...state._phaseTimings, sketch: Date.now() - phaseStart },
    };
  } catch (err: any) {
    if (state._httpJobId) {
      try {
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'sketch', prompt.length, {
          hardcodedContent: `engineeredPrompt: ${prompt}\n\nERROR: ${err.message}${err instanceof SafetyBlockError ? ' (SAFETY_BLOCK)' : ''}`,
        });
      } catch { /* non-critical */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'sketch', 0);
    }

    if (err instanceof SafetyBlockError) {
      console.warn('🛡️ [Visual:Sketch] Safety filter blocked generation');
      await chatAPI.finalizeMessage();
      return {
        draftImages: undefined,
        visualError: 'Image generation was blocked by safety filter. Please modify your request.',
        safetyBlocked: true,
        _phaseTimings: { ...state._phaseTimings, sketch: Date.now() - phaseStart },
      };
    }

    console.error('❌ [Visual:Sketch] Generation failed:', err.message);
    await chatAPI.finalizeMessage();
    return {
      draftImages: undefined,
      visualError: `Sketch generation failed: ${err.message}`,
      _phaseTimings: { ...state._phaseTimings, sketch: Date.now() - phaseStart },
    };
  }
}

/**
 * Load the latest draft as a style reference for iterative sketching.
 * Only activated when previous drafts exist on disk.
 */
function loadSketchReference(
  state: VisualGraphState
): { data: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | undefined {
  const paths = state.availableDraftPaths;
  if (!paths || paths.length === 0) return undefined;

  const latestPath = paths[paths.length - 1];
  try {
    const fullPath = path.isAbsolute(latestPath) ? latestPath : path.join(state.featurePath, latestPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`✏️ [Visual:Sketch] Reference draft not found: ${fullPath}`);
      return undefined;
    }

    const data = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    console.log(`✏️ [Visual:Sketch] Using latest draft as style reference: ${fullPath} (${data.length} bytes)`);
    return { data, mimeType: mimeType as any };
  } catch (err: any) {
    console.warn(`✏️ [Visual:Sketch] Failed to load reference draft: ${err.message}`);
    return undefined;
  }
}

/**
 * Router after sketch node
 */
export function routeAfterSketch(state: VisualGraphState): string {
  if (state.safetyBlocked) {
    console.log('[SketchRouter] Safety blocked → direct (for prompt revision)');
    return 'direct';
  }

  if (state.visualError) {
    console.log('[SketchRouter] Error → __end__');
    return '__end__';
  }

  if (state.draftImages && state.draftImages.length > 0) {
    console.log('[SketchRouter] Drafts generated → deliver (for clarify/selection)');
    return 'deliver';
  }

  console.log('[SketchRouter] No drafts → __end__');
  return '__end__';
}

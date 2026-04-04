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
export async function sketchNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n✏️ [Visual:Sketch] Generating draft candidates...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('sketch', state._uiLocale as any), 'sketch');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'sketch', 0);
  }

  const imageClient = state.deps.sketchImageClient;
  const candidateCount = state.visualSettings?.candidateCount ?? 3;
  const prompt = state.engineeredPrompt || state.directive || '';
  const aspectRatio = state.resolvedAspectRatio || state.visualSettings?.defaultAspectRatio || '1:1';

  const refImage = loadSketchReference(state);
  const variations = state.draftVariations;
  const basePrompt = state.basePrompt;
  const usePerDraftPrompts = !!basePrompt && Array.isArray(variations) && variations.length > 0;

  if (usePerDraftPrompts) {
    console.log(`✏️ [Visual:Sketch] Per-draft variation mode: basePrompt(${basePrompt!.length} chars) + ${variations!.length} variations, ratio: ${aspectRatio}${refImage ? ' +refImage' : ''}`);
  } else {
    console.log(`✏️ [Visual:Sketch] Prompt: ${prompt.substring(0, 100)}...`);
    console.log(`✏️ [Visual:Sketch] Candidates: ${candidateCount}, ratio: ${aspectRatio}${refImage ? ' +refImage' : ''}`);
  }

  try {
    const draftImages: DraftImage[] = [];

    if (usePerDraftPrompts) {
      // Per-draft variation: compose unique prompt for each draft
      for (let i = 0; i < variations!.length; i++) {
        const composedPrompt = `${basePrompt} ${variations![i].prompt}`.trim();
        console.log(`✏️ [Visual:Sketch] Draft ${i + 1}/${variations!.length}: ${composedPrompt.substring(0, 80)}...`);

        const generated = await imageClient.generate(composedPrompt, {
          numberOfImages: 1,
          outputFormat: 'jpeg',
          aspectRatio,
          temperature: 1.0,
          referenceImage: refImage,
        });

        if (generated.length > 0) {
          draftImages.push({
            data: generated[0].data,
            mimeType: generated[0].mimeType,
            prompt: composedPrompt,
            modelConfig: {
              model: (imageClient as any).modelName || 'gemini-3.1-flash-image-preview',
              aspectRatio,
            },
            modelResponseMetadata: generated[0].modelResponseMetadata || {},
            index: i,
          });
        }
      }
    } else {
      // Fallback: single prompt with numberOfImages (temperature-based variation)
      const generated = await imageClient.generate(prompt, {
        numberOfImages: candidateCount,
        outputFormat: 'jpeg',
        aspectRatio,
        temperature: 1.2,
        referenceImage: refImage,
      });

      for (let i = 0; i < generated.length; i++) {
        draftImages.push({
          data: generated[i].data,
          mimeType: generated[i].mimeType,
          prompt: generated[i].prompt,
          modelConfig: {
            model: (imageClient as any).modelName || 'gemini-3.1-flash-image-preview',
            aspectRatio,
          },
          modelResponseMetadata: generated[i].modelResponseMetadata || {},
          index: i,
        });
      }
    }

    console.log(`✏️ [Visual:Sketch] Generated ${draftImages.length} drafts`);

    if (state._httpJobId) {
      try {
        const byteSizes = draftImages.map((d, i) => `[draft ${i + 1}] ${d.data.length} bytes`).join(', ');
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'sketch', prompt.length, {
          injectedVariables: { candidateCount, aspectRatio, hasReferenceImage: !!refImage, perDraftVariations: usePerDraftPrompts },
          hardcodedContent: usePerDraftPrompts
            ? `basePrompt: ${basePrompt}\nvariations: ${JSON.stringify(variations!.map(v => v.prompt))}\n\nResult: ${draftImages.length} drafts — ${byteSizes}`
            : `engineeredPrompt: ${prompt}\n\nResult: ${draftImages.length}/${candidateCount} drafts — ${byteSizes}`,
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
      return {
        draftImages: undefined,
        visualError: 'Image generation was blocked by safety filter. Please modify your request.',
        safetyBlocked: true,
        _phaseTimings: { ...state._phaseTimings, sketch: Date.now() - phaseStart },
      };
    }

    console.error('❌ [Visual:Sketch] Generation failed:', err.message);
    return {
      draftImages: undefined,
      visualError: `Sketch generation failed: ${err.message}`,
      _phaseTimings: { ...state._phaseTimings, sketch: Date.now() - phaseStart },
    };
  }
}

/**
 * Load a draft as style reference for iterative sketching.
 *
 * Uses state.selectedDraftIndex when explicitly set.
 * Returns undefined (no reference) when no explicit selection —
 * prevents silently using the last draft as reference when the
 * user did not request it.
 */
function loadSketchReference(
  state: VisualGraphState
): { data: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | undefined {
  const paths = state.availableDraftPaths;
  if (!paths || paths.length === 0) return undefined;

  if (state.selectedDraftIndex == null) {
    console.log('✏️ [Visual:Sketch] No explicit draft selection — generating without style reference');
    return undefined;
  }

  const index = state.selectedDraftIndex;
  if (index < 0 || index >= paths.length) {
    console.warn(`✏️ [Visual:Sketch] selectedDraftIndex=${index} out of range (${paths.length} drafts)`);
    return undefined;
  }

  const targetPath = paths[index];
  try {
    const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(state.featurePath, targetPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`✏️ [Visual:Sketch] Reference draft not found: ${fullPath}`);
      return undefined;
    }

    const data = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    console.log(`✏️ [Visual:Sketch] Using draft #${index} as style reference: ${fullPath} (${data.length} bytes)`);
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

/**
 * Deliver Node (Visual Graph)
 *
 * Handles final output:
 * 1. If draftImages exist (from sketch) → save and notify (image gallery for selection)
 * 2. If finalImage exists (from render) → save to inputs/assets/gen/ and notify
 * 3. If svgDrafts exist (from engrave) → save and notify
 *
 * After saving, clears temporary state (draftImages, engineeredPrompt, etc.)
 * and adds a chapter marker to conversation history.
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { VisualGraphState, VisualConversationEntry } from '../types.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';

export async function deliverNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n📦 [Visual:Deliver] Delivering output...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('deliver', state._uiLocale as any), 'deliver');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'deliver', 0);
  }

  const featurePath = state.featurePath;

  let result: Partial<VisualGraphState>;

  if (state.finalImage) {
    result = await deliverFinalImage(state, featurePath, phaseStart);
  } else if (state.draftImages && state.draftImages.length > 0) {
    result = await deliverDraftImages(state, featurePath, phaseStart);
  } else if (state.svgDrafts && state.svgDrafts.length > 0) {
    result = await deliverSvgDrafts(state, featurePath, phaseStart);
  } else {
    console.warn('⚠️ [Visual:Deliver] Nothing to deliver');
    result = { _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart } };
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'deliver', 0);
  }

  return result;
}

async function deliverFinalImage(
  state: VisualGraphState,
  featurePath: string,
  phaseStart: number
): Promise<Partial<VisualGraphState>> {
  const image = state.finalImage!;
  const ext = mimeToExt(image.mimeType);
  const timestamp = Date.now();
  const filename = `gen-${timestamp}.${ext}`;
  const outputDir = path.join(featurePath, 'inputs/assets/gen');

  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, image.data);
  console.log(`📦 [Visual:Deliver] Saved final image: ${outputPath} (${image.data.length} bytes)`);

  let thumbnailPath: string | undefined;
  try {
    const draftsDir = path.join(outputDir, 'drafts');
    fs.mkdirSync(draftsDir, { recursive: true });
    const thumbFilename = `gen-${timestamp}-thumb.jpeg`;
    thumbnailPath = path.join(draftsDir, thumbFilename);
    await sharp(image.data)
      .resize(200, 200, { fit: 'inside' })
      .jpeg({ quality: 70 })
      .toFile(thumbnailPath);
    console.log(`📦 [Visual:Deliver] Generated thumbnail: ${thumbnailPath}`);
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] Thumbnail generation failed:', err.message);
    thumbnailPath = undefined;
  }

  try {
    const chatAPI = getChatAPIClient();
    const relativePath = `inputs/assets/gen/${filename}`;
    const sizeKB = (image.data.length / 1024).toFixed(1);
    await chatAPI.showChatStatus('downloaded', {
      filename,
      sizeKB,
      imagePath: relativePath,
    });
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] Chat notification failed:', err.message);
  }

  await notifyFileTree(state);

  const chapterMarker: VisualConversationEntry = {
    role: 'system',
    content: `[Asset saved: inputs/assets/gen/${filename}]`,
    timestamp: new Date().toISOString(),
    metadata: {
      savedAsset: `inputs/assets/gen/${filename}`,
      chapterSummary: `Generated ${ext.toUpperCase()} image from prompt: "${state.engineeredPrompt?.substring(0, 80)}..."`,
    },
  };

  return {
    outputPath,
    lastEngineeredPrompt: state.engineeredPrompt,
    lastOutputPath: outputPath,
    conversation: [...state.conversation, chapterMarker],
    draftImages: undefined,
    svgDrafts: undefined,
    engineeredPrompt: undefined,
    finalImage: undefined,
    selectedDraftIndex: undefined,
    routeDecision: undefined,
    needsSketches: undefined,
    isSvgRequest: undefined,
    _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart },
  };
}

async function deliverDraftImages(
  state: VisualGraphState,
  featurePath: string,
  phaseStart: number
): Promise<Partial<VisualGraphState>> {
  const drafts = state.draftImages!;
  const timestamp = Date.now();
  const outputDir = path.join(featurePath, 'inputs/assets/gen/drafts');
  fs.mkdirSync(outputDir, { recursive: true });

  const draftEntries: Array<{ index: number; imagePath: string; thumbnailPath: string }> = [];

  for (const draft of drafts) {
    const ext = mimeToExt(draft.mimeType);
    const filename = `draft-${timestamp}-${draft.index}.${ext}`;
    const thumbFilename = `draft-${timestamp}-${draft.index}-thumb.jpeg`;

    const draftPath = path.join(outputDir, filename);
    const thumbPath = path.join(outputDir, thumbFilename);

    fs.writeFileSync(draftPath, draft.data);

    try {
      await sharp(draft.data)
        .resize(200, 200, { fit: 'inside' })
        .jpeg({ quality: 70 })
        .toFile(thumbPath);
    } catch (err: any) {
      console.warn(`⚠️ [Visual:Deliver] Thumbnail failed for draft ${draft.index}:`, err.message);
    }

    draftEntries.push({
      index: draft.index,
      imagePath: `inputs/assets/gen/drafts/${filename}`,
      thumbnailPath: `inputs/assets/gen/drafts/${thumbFilename}`,
    });
  }

  console.log(`📦 [Visual:Deliver] Saved ${draftEntries.length} draft images with thumbnails`);

  try {
    const chatAPI = getChatAPIClient();
    await chatAPI.sendDraftSelection(draftEntries);
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] Chat notification failed:', err.message);
  }

  await notifyFileTree(state);

  const chapterMarker: VisualConversationEntry = {
    role: 'system',
    content: `[${draftEntries.length} draft candidates saved for selection]`,
    timestamp: new Date().toISOString(),
    metadata: {
      chapterSummary: `Generated ${draftEntries.length} drafts from prompt: "${state.engineeredPrompt?.substring(0, 80)}..."`,
    },
  };

  return {
    lastEngineeredPrompt: state.engineeredPrompt,
    conversation: [...state.conversation, chapterMarker],
    draftImages: undefined,
    svgDrafts: undefined,
    engineeredPrompt: undefined,
    finalImage: undefined,
    selectedDraftIndex: undefined,
    routeDecision: undefined,
    needsSketches: undefined,
    isSvgRequest: undefined,
    _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart },
  };
}

async function deliverSvgDrafts(
  state: VisualGraphState,
  featurePath: string,
  phaseStart: number
): Promise<Partial<VisualGraphState>> {
  const drafts = state.svgDrafts!;

  if (drafts.length === 1) {
    const outputDir = path.join(featurePath, 'inputs/assets/gen');
    fs.mkdirSync(outputDir, { recursive: true });

    const filename = `gen-${Date.now()}.svg`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, drafts[0].code, 'utf-8');
    console.log(`📦 [Visual:Deliver] Saved SVG: ${outputPath}`);

    try {
      const chatAPI = getChatAPIClient();
      const relativePath = `inputs/assets/gen/${filename}`;
      const sizeKB = (Buffer.byteLength(drafts[0].code, 'utf-8') / 1024).toFixed(1);
      await chatAPI.showChatStatus('downloaded', {
        filename,
        sizeKB,
        imagePath: relativePath,
      });
    } catch (err: any) {
      console.warn('⚠️ [Visual:Deliver] Chat notification failed:', err.message);
    }

    await notifyFileTree(state);

    const chapterMarker: VisualConversationEntry = {
      role: 'system',
      content: `[SVG saved: inputs/assets/gen/${filename}]`,
      timestamp: new Date().toISOString(),
      metadata: {
        savedAsset: `inputs/assets/gen/${filename}`,
        chapterSummary: `Generated SVG from prompt: "${state.engineeredPrompt?.substring(0, 80)}..."`,
      },
    };

    return {
      outputPath,
      lastEngineeredPrompt: state.engineeredPrompt,
      lastOutputPath: outputPath,
      conversation: [...state.conversation, chapterMarker],
      draftImages: undefined,
      svgDrafts: undefined,
      engineeredPrompt: undefined,
      finalImage: undefined,
      selectedDraftIndex: undefined,
      routeDecision: undefined,
      needsSketches: undefined,
      isSvgRequest: undefined,
      _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart },
    };
  }

  // Multiple SVG drafts: save files, generate thumbnails, use same draft selection UI as images
  const timestamp = Date.now();
  const outputDir = path.join(featurePath, 'inputs/assets/gen/drafts');
  fs.mkdirSync(outputDir, { recursive: true });

  const draftEntries: Array<{ index: number; imagePath: string; thumbnailPath: string }> = [];

  for (const draft of drafts) {
    const filename = `draft-${timestamp}-${draft.index}.svg`;
    const thumbFilename = `draft-${timestamp}-${draft.index}-thumb.jpeg`;

    const draftPath = path.join(outputDir, filename);
    const thumbPath = path.join(outputDir, thumbFilename);

    fs.writeFileSync(draftPath, draft.code, 'utf-8');

    try {
      await sharp(Buffer.from(draft.code))
        .resize(200, 200, { fit: 'inside' })
        .jpeg({ quality: 70 })
        .toFile(thumbPath);
    } catch (err: any) {
      console.warn(`⚠️ [Visual:Deliver] SVG thumbnail failed for draft ${draft.index}:`, err.message);
    }

    draftEntries.push({
      index: draft.index,
      imagePath: `inputs/assets/gen/drafts/${filename}`,
      thumbnailPath: `inputs/assets/gen/drafts/${thumbFilename}`,
    });
  }

  console.log(`📦 [Visual:Deliver] Saved ${draftEntries.length} SVG drafts with thumbnails`);

  try {
    const chatAPI = getChatAPIClient();
    await chatAPI.sendDraftSelection(draftEntries);
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] Chat notification failed:', err.message);
  }

  await notifyFileTree(state);

  const chapterMarker: VisualConversationEntry = {
    role: 'system',
    content: `[${draftEntries.length} SVG draft candidates saved for selection]`,
    timestamp: new Date().toISOString(),
    metadata: {
      chapterSummary: `Generated ${draftEntries.length} SVG drafts from prompt: "${state.engineeredPrompt?.substring(0, 80)}..."`,
    },
  };

  return {
    lastEngineeredPrompt: state.engineeredPrompt,
    conversation: [...state.conversation, chapterMarker],
    draftImages: undefined,
    svgDrafts: undefined,
    engineeredPrompt: undefined,
    finalImage: undefined,
    selectedDraftIndex: undefined,
    routeDecision: undefined,
    needsSketches: undefined,
    isSvgRequest: undefined,
    _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart },
  };
}

async function notifyFileTree(state: VisualGraphState): Promise<void> {
  if (!state.deps?.fileTreeUpdate) return;
  try {
    const projectId = state.deps.session?.projectId || process.env.ANT_PROJECT_ID || 'default';
    const featureName = state.deps.session?.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
    await state.deps.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] FileTree update failed:', err.message);
  }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpeg';
    case 'image/webp': return 'webp';
    default: return 'png';
  }
}

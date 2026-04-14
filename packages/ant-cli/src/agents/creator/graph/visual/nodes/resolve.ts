/**
 * Visual Resolve Strategy
 *
 * Loads session state and determines if this is a continuation or fresh start.
 * No workspace validation or jobTiming (visual is a lightweight job).
 */

import * as fs from 'fs';
import * as path from 'path';
import { VisualGraphState, SketchVariation } from '../types.js';
import type { ConversationEntry } from '../../../../../core/types/session.js';
import { detectUILocale } from '../../../../common/graph/timing/estimatingLabels.js';
import { resolveToRAC } from '@ant/shared';
import type { IntentId } from '@ant/shared';
import type { ResolveStrategy } from '../../../../common/graph/nodes/resolve/types.js';

export const visualResolveStrategy: ResolveStrategy<VisualGraphState> = {
  async loadArtifacts(state) {
    return loadVisualState(state);
  },

  async onResume(state) {
    return loadVisualState(state);
  },
};

/**
 * Shared logic for both new and resume paths.
 * Visual resolve doesn't distinguish between the two — it always loads session.
 */
async function loadVisualState(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  console.log('\n📂 [Visual:Resolve] Loading session state...');

  const featurePath = state.featurePath;
  if (!featurePath) {
    console.warn('⚠️ [Visual:Resolve] No featurePath — starting fresh');
    return {};
  }

  const sessionPath = path.join(featurePath, 'sessions/creator/visual.json');
  let conversation: ConversationEntry[] = [];
  let isResume = state.isResume ?? false;
  let lastEngineeredPrompt: string | undefined;
  let lastOutputPath: string | undefined;
  let lastAssetType: string | undefined;
  let lastJobMode: string | undefined;
  let availableSketchPaths: string[] | undefined;
  let lastBasePrompt: string | undefined;
  let lastSketchVariations: SketchVariation[] | undefined;
  let clarifyCount = state.clarifyCount || 0;

  try {
    if (fs.existsSync(sessionPath)) {
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));

      if (sessionData.state?.conversation && Array.isArray(sessionData.state.conversation)) {
        conversation = sessionData.state.conversation;
        console.log(`📂 [Visual:Resolve] Loaded ${conversation.length} conversation entries`);
      }
      if (sessionData.state?.lastEngineeredPrompt) {
        lastEngineeredPrompt = sessionData.state.lastEngineeredPrompt;
        console.log(`📂 [Visual:Resolve] Restored lastEngineeredPrompt (${lastEngineeredPrompt!.length} chars)`);
      }
      if (sessionData.state?.lastOutputPath) {
        lastOutputPath = sessionData.state.lastOutputPath;
        console.log(`📂 [Visual:Resolve] Restored lastOutputPath: ${lastOutputPath}`);
      }
      if (sessionData.state?.assetType) {
        lastAssetType = sessionData.state.assetType;
        console.log(`📂 [Visual:Resolve] Restored assetType: ${lastAssetType}`);
      }
      if (sessionData.state?.jobMode) {
        lastJobMode = sessionData.state.jobMode;
        console.log(`📂 [Visual:Resolve] Restored jobMode: ${lastJobMode}`);
      }
      if (sessionData.state?.availableSketchPaths && Array.isArray(sessionData.state.availableSketchPaths)) {
        availableSketchPaths = sessionData.state.availableSketchPaths;
        console.log(`📂 [Visual:Resolve] Restored availableSketchPaths (${availableSketchPaths!.length} paths)`);
      }
      if (sessionData.state?.basePrompt) {
        lastBasePrompt = sessionData.state.basePrompt;
        console.log(`📂 [Visual:Resolve] Restored basePrompt (${lastBasePrompt!.length} chars)`);
      }
      if (sessionData.state?.sketchVariations && Array.isArray(sessionData.state.sketchVariations)) {
        lastSketchVariations = sessionData.state.sketchVariations;
        console.log(`📂 [Visual:Resolve] Restored sketchVariations (${lastSketchVariations!.length} variations)`);
      }
      if (conversation.length > 0) {
        clarifyCount = conversation.filter((e, i) =>
          e.role === 'assistant' && !e.metadata?.savedAsset && conversation[i + 1]?.role === 'user'
        ).length;
        console.log(`📂 [Visual:Resolve] Restored clarifyCount: ${clarifyCount}`);
      }
      if (sessionData.state?.interruption) {
        isResume = true;
        console.log('🔄 [Visual:Resolve] Found interrupted session — resuming');
      }
    }
  } catch (err) {
    console.warn('⚠️ [Visual:Resolve] Failed to load session:', err);
  }

  // Fallback: scan sketches directory
  if (!availableSketchPaths) {
    const sketchesDir = path.join(featurePath, 'inputs/assets/gen/sketches');
    try {
      if (fs.existsSync(sketchesDir)) {
        const files = fs.readdirSync(sketchesDir)
          .filter(f => /^sketch-\d+-\d+\.(jpeg|jpg|png|webp|svg)$/i.test(f))
          .sort();
        if (files.length > 0) {
          const timestamps = files.map(f => f.match(/^sketch-(\d+)-/)?.[1]).filter(Boolean) as string[];
          const latestTs = timestamps.sort().pop();
          const latestFiles = latestTs ? files.filter(f => f.startsWith(`sketch-${latestTs}-`)) : files;
          availableSketchPaths = latestFiles.map(f => path.join(sketchesDir, f));
          console.log(`📂 [Visual:Resolve] Fallback scan: ${availableSketchPaths.length} sketch files (latest batch of ${files.length} total)`);
        }
      }
    } catch (err) {
      console.warn('⚠️ [Visual:Resolve] Failed to scan sketches directory:', err);
    }
  }

  const userDirective = state.overrideDirective || state.directive;

  // Parse structured sketch intent from overrideDirective prefix
  let sketchIntent: VisualGraphState['sketchIntent'];
  let selectedSketchIndex: number | undefined;
  let parsedDirective = userDirective;

  const intentMatch = userDirective?.match(
    /^\[SKETCH_(FINALIZE|REGENERATE|FEEDBACK)(?::(\d+))?\](?:\s*(.*))?$/s
  );
  if (intentMatch) {
    const [, action, indexStr, rest] = intentMatch;
    if (action === 'FINALIZE') {
      sketchIntent = 'finalize';
      selectedSketchIndex = indexStr != null ? parseInt(indexStr, 10) : undefined;
      parsedDirective = `Selected sketch ${(selectedSketchIndex ?? 0) + 1} for final rendering`;
      console.log(`📂 [Visual:Resolve] Sketch intent: finalize (sketch ${selectedSketchIndex})`);
    } else if (action === 'REGENERATE') {
      sketchIntent = 'regenerate';
      parsedDirective = 'Requested sketch regeneration with fresh exploration';
      console.log('📂 [Visual:Resolve] Sketch intent: regenerate');
    } else if (action === 'FEEDBACK') {
      sketchIntent = 'feedback';
      parsedDirective = rest?.trim() || userDirective;
      console.log(`📂 [Visual:Resolve] Sketch feedback: "${parsedDirective?.substring(0, 60)}"`);
    }
  }

  if (userDirective) {
    conversation.push({
      role: 'user',
      content: parsedDirective || userDirective,
      timestamp: new Date().toISOString(),
    });
    console.log('📝 [Visual:Resolve] Appended user directive to conversation');
  }

  // RAC creation: explicit path only (infer path creates RAC in detect node)
  const actionMetadata = state.actionMetadata;
  let resolvedAction = state.resolvedAction;
  if (!resolvedAction && actionMetadata?.intent) {
    resolvedAction = resolveToRAC(
      actionMetadata.intent as IntentId,
      { target: actionMetadata.target, refs: actionMetadata.refs, context: actionMetadata.context },
      'explicit',
    );
    console.log(`📋 [Visual:Resolve] RAC created (explicit): intent=${actionMetadata.intent}, mode=${resolvedAction.mode}`);
  }

  const result: Partial<VisualGraphState> = {
    conversation,
    isResume,
    lastEngineeredPrompt,
    lastOutputPath,
    availableSketchPaths,
    clarifyCount,
    sketchIntent,
    selectedSketchIndex,
    directive: parsedDirective || state.overrideDirective || state.directive,
    overrideDirective: parsedDirective || state.overrideDirective,
    _uiLocale: state._uiLocale || detectUILocale(state.directive),
    ...(resolvedAction ? { resolvedAction } : {}),
  };

  // Detect clarify response
  const lastConvBeforeUser = conversation.length >= 2 ? conversation[conversation.length - 2] : null;
  const isClarifyResponse = !!lastConvBeforeUser
    && lastConvBeforeUser.role === 'assistant'
    && !lastConvBeforeUser.metadata?.savedAsset
    && !sketchIntent;

  // Skip triage + classify for visual continuations
  if (sketchIntent || isClarifyResponse) {
    result.skipTriage = true;
    result.skipClassify = true;
    if (lastAssetType) result.assetType = lastAssetType as any;
    if (lastJobMode) result.jobMode = lastJobMode as any;
    if (lastBasePrompt) result.basePrompt = lastBasePrompt;
    if (lastSketchVariations) result.sketchVariations = lastSketchVariations;
    const bypassReason = sketchIntent ? `sketch:${sketchIntent}` : 'clarifyResponse';
    console.log(`📂 [Visual:Resolve] skipTriage+skipClassify=true (reason=${bypassReason}, assetType=${lastAssetType || 'general'}, jobMode=${lastJobMode || 'generate'})`);
  }

  return result;
}

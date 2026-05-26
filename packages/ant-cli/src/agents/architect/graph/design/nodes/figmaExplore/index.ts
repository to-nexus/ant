/**
 * figmaExplore Node
 *
 * Phase 0 of the Figma pipeline: explores Figma design files using MCP tools
 * to build FigmaExplorationResult (variation matrix, component states, annotations).
 *
 * Steps:
 * 1. Parse figmaConfig.file to extract file key and node ID
 * 2. Call get_metadata to build node tree
 * 3. Identify variation containers, annotations, and component states
 * 4. Return structured FigmaExplorationResult for downstream nodes
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { DesignGraphState } from '../../state';
import type { FigmaExplorationResult, FigmaExplorationError } from '@ant/shared';
import { parseFigmaUrl } from '../../../../../../core/ports/figma';
import { getFigmaMCPAdapter } from '../../../../../../periphery/adapters/figma/figmaMCPHandler';
import { extractMCPTextContent, isFigmaMCPSoftError, isLikelyMCPErrorResponse } from '../../../../../../periphery/adapters/figma/MCPTransport';
import { isRateLimitResponse, classifyFigmaError } from '../../../../../../periphery/adapters/figma/errors';
import { getSessionRuntimeDir } from '../../../../../../core/utils/sessionPaths';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';

import { parseMetadataXML } from './metadataParser';
import { findFrames, findAnnotationTexts, buildVariationMatrix, buildComponentStateMatrix, buildNodeSummary } from './nodeAnalyzer';
import { countNodes, emptyResult, extractVariableDefsSummary } from './utils';

const MAX_VARIABLE_DEFS_TOKENS = 8000;

export async function figmaExplore(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  const phaseStart = Date.now();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 FIGMA EXPLORE (Phase 0)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const figmaConfig = state.figmaConfig;
  if (!figmaConfig?.file) {
    console.log('   ⚠️ No Figma file configured, skipping exploration');
    return {
      figmaExplorationResult: emptyResult(),
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

  // Workflow instrumentation: signal phase start to broadcaster so this node
  // appears in the workflow UI active state. The matching exitNode is invoked
  // in the finally block at the bottom of this function so all early-return
  // paths (adapter init fail, parse_url, metadata_error, rate_limit,
  // soft_error, no usable data, success) emit a single exitNode automatically.
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'figmaExplore',
      0,
      undefined,
      undefined,
      state.recursionCount,
      state.recursionLimit,
    );
  }

  try {
  // Diagnostic collector for figma-exploration-debug.json
  const debugInfo: {
    jobId?: string;
    startedAt: string;
    completedAt?: string;
    elapsedMs?: number;
    files: any[];
    summary?: any;
  } = {
    jobId: state._httpJobId,
    startedAt: new Date().toISOString(),
    files: [],
  };
  const errors: FigmaExplorationError[] = [];

  let adapter;
  try {
    adapter = getFigmaMCPAdapter({ userId: state.context?.userId, redis: state.deps?.redis });
  } catch (err: any) {
    const errMsg = `MCP adapter init failed: ${err.message}`;
    console.error(`   ❌ ${errMsg}`);
    errors.push({ phase: 'adapter_init', message: errMsg, timestamp: new Date().toISOString() });
    await saveDebugFile(state, { ...debugInfo, completedAt: new Date().toISOString(), elapsedMs: Date.now() - phaseStart, files: [], summary: { errors } });
    return {
      figmaExplorationResult: { ...emptyResult(), explorationErrors: errors },
      designError: { type: 'figma_mcp_unavailable', message: errMsg },
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

  const result: FigmaExplorationResult = {
    variationMatrix: [],
    annotations: [],
    componentStateMatrix: [],
    totalFrameCount: 0,
    downloadedAssets: [],
  };

  const url = figmaConfig.file;
  const parsed = parseFigmaUrl(url);
  if (!parsed) {
    console.log(`   ⚠️ Invalid Figma URL: ${url}`);
    errors.push({ phase: 'parse_url', message: `Invalid Figma URL: ${url}`, timestamp: new Date().toISOString() });
    await saveDebugFile(state, { ...debugInfo, completedAt: new Date().toISOString(), elapsedMs: Date.now() - phaseStart, files: [], summary: { errors } });
    return {
      figmaExplorationResult: { ...emptyResult(), explorationErrors: errors },
      designError: { type: 'figma_invalid_config', message: `Invalid Figma URL: ${url}` },
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

  const { fileKey, nodeId } = parsed;
  const rootNodeId = nodeId || '0:1';
  const fileDebug: any = { url, fileKey, rootNodeId, status: 'success' };

  console.log(`   📄 Exploring file: ${fileKey} (node: ${rootNodeId})`);

  // --- getMetadata ---
  const metaStart = Date.now();
  const metadataResult = await adapter.getMetadata(fileKey, rootNodeId);
  const metaElapsed = Date.now() - metaStart;
  const rawContent = metadataResult.content;
  const contentSize = typeof rawContent === 'string' ? rawContent.length : JSON.stringify(rawContent).length;
  const extractedPreview = extractMCPTextContent(rawContent);

  fileDebug.getMetadata = {
    calledAt: new Date(metaStart).toISOString(),
    elapsedMs: metaElapsed,
    responseChars: contentSize,
    isError: !!metadataResult.isError,
    responsePreview: typeof extractedPreview === 'string' ? extractedPreview.substring(0, 500) : null,
  };

  if (metadataResult.isError) {
    const errContent = String(metadataResult.content);
    console.log(`   ❌ Metadata fetch failed: ${errContent}`);
    fileDebug.status = 'metadata_error';
    errors.push({ phase: 'get_metadata', fileKey, nodeId: rootNodeId, message: errContent, timestamp: new Date().toISOString() });
    debugInfo.files.push(fileDebug);
    await saveDebugFile(state, { ...debugInfo, completedAt: new Date().toISOString(), elapsedMs: Date.now() - phaseStart, files: debugInfo.files, summary: { errors } });
    const cat = classifyFigmaError(errContent);
    const errType = cat === 'rate_limit' ? 'figma_rate_limited'
      : cat === 'connection' ? 'figma_mcp_unavailable'
      : cat === 'environment' ? 'figma_window_not_open'
      : 'figma_data_error';
    return {
      figmaExplorationResult: { ...emptyResult(), explorationErrors: errors },
      designError: { type: errType, message: errContent },
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

  const contentType = Array.isArray(rawContent) ? 'array' : typeof rawContent;
  console.log(`      metadata response: type=${contentType}, size=${contentSize}, extracted=${extractedPreview ? extractedPreview.substring(0, 120) + '...' : 'null'}`);

  if (extractedPreview && isRateLimitResponse(extractedPreview)) {
    console.log(`   ❌ Figma API rate limited: "${extractedPreview}"`);
    fileDebug.status = 'rate_limited';
    errors.push({ phase: 'get_metadata', fileKey, nodeId: rootNodeId, message: `Figma API rate limited: ${extractedPreview}`, timestamp: new Date().toISOString() });
    debugInfo.files.push(fileDebug);
    await saveDebugFile(state, { ...debugInfo, completedAt: new Date().toISOString(), elapsedMs: Date.now() - phaseStart, files: debugInfo.files, summary: { errors } });
    return {
      figmaExplorationResult: { ...emptyResult(), explorationErrors: errors },
      designError: { type: 'figma_rate_limited', message: `Figma API rate limited: ${extractedPreview}` },
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

  if (extractedPreview && (isFigmaMCPSoftError(extractedPreview) || isLikelyMCPErrorResponse(extractedPreview))) {
    console.log(`   ❌ Figma MCP soft error: "${extractedPreview}"`);
    fileDebug.status = 'soft_error';
    errors.push({ phase: 'get_metadata', fileKey, nodeId: rootNodeId, message: `Soft error: ${extractedPreview}`, timestamp: new Date().toISOString() });
    debugInfo.files.push(fileDebug);
    await saveDebugFile(state, { ...debugInfo, completedAt: new Date().toISOString(), elapsedMs: Date.now() - phaseStart, files: debugInfo.files, summary: { errors } });
    const cat = classifyFigmaError(extractedPreview);
    const errType = cat === 'environment' ? 'figma_window_not_open'
      : cat === 'connection' ? 'figma_mcp_unavailable'
      : 'figma_data_error';
    return {
      figmaExplorationResult: { ...emptyResult(), explorationErrors: errors },
      designError: { type: errType, message: `Figma MCP error: ${extractedPreview}` },
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

  const nodes = parseMetadataXML(metadataResult.content);
  fileDebug.getMetadata.parsedNodeCount = countNodes(nodes);

  if (nodes.length === 0 && contentSize > 0) {
    errors.push({ phase: 'parse_metadata', fileKey, nodeId: rootNodeId, message: `Parse returned 0 nodes from ${contentSize} chars response`, timestamp: new Date().toISOString() });
  }

  const allFrames = findFrames(nodes);
  result.totalFrameCount += allFrames.length;

  const variations = buildVariationMatrix(nodes);
  result.variationMatrix.push(...variations);

  const frameIds = new Set(allFrames.map(f => f.id));
  const annotations = findAnnotationTexts(nodes, frameIds);
  result.annotations.push(...annotations);

  const componentStates = buildComponentStateMatrix(nodes);
  result.componentStateMatrix.push(...componentStates);

  const nodeSummary = buildNodeSummary(nodes);
  if (!result.nodeSummary) result.nodeSummary = [];
  result.nodeSummary.push(...nodeSummary);
  const maxDepthUsed = nodeSummary.length > 0 ? Math.max(...nodeSummary.map(n => n.depth)) : 0;
  console.log(`      nodeSummary: ${nodeSummary.length} entries (max depth ${maxDepthUsed})`);

  // --- getVariableDefs ---
  const varStart = Date.now();
  try {
    const varResult = await adapter.getVariableDefs(fileKey, rootNodeId);
    const varElapsed = Date.now() - varStart;
    const varRawContent = varResult.content;
    const varSize = typeof varRawContent === 'string' ? varRawContent.length : JSON.stringify(varRawContent).length;

    fileDebug.getVariableDefs = {
      calledAt: new Date(varStart).toISOString(),
      elapsedMs: varElapsed,
      responseChars: varSize,
      status: varResult.isError ? 'error' : 'success',
    };

    const varExtracted = extractMCPTextContent(varRawContent);
    const varTextForCheck = typeof varExtracted === 'string' ? varExtracted
      : (typeof varRawContent === 'string' ? varRawContent : JSON.stringify(varRawContent));
    if (isRateLimitResponse(varTextForCheck)) {
      console.log(`   ❌ Figma API rate limited during getVariableDefs`);
      errors.push({ phase: 'get_variable_defs', fileKey, nodeId: rootNodeId, message: 'Figma API rate limited', timestamp: new Date().toISOString() });
      result.explorationErrors = errors;
      debugInfo.files.push(fileDebug);
      await saveDebugFile(state, { ...debugInfo, completedAt: new Date().toISOString(), elapsedMs: Date.now() - phaseStart, files: debugInfo.files, summary: { errors } });
      return {
        figmaExplorationResult: result,
        designError: { type: 'figma_rate_limited', message: `Figma API rate limited: ${varTextForCheck}` },
        _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
      };
    }

    if (varResult.isError) {
      const errContent = typeof varRawContent === 'string' ? varRawContent : JSON.stringify(varRawContent);
      console.warn(`      ⚠️ getVariableDefs returned isError: ${errContent.substring(0, 200)}`);
      errors.push({ phase: 'get_variable_defs', fileKey, nodeId: rootNodeId, message: errContent.substring(0, 500), timestamp: new Date().toISOString() });
    } else {
      const varContent = extractMCPTextContent(varRawContent) ?? varRawContent;
      const varStr = typeof varContent === 'string' ? varContent : JSON.stringify(varContent);

      if (typeof varStr === 'string' && isLikelyMCPErrorResponse(varStr)) {
        console.warn(`      ⚠️ getVariableDefs returned error-like response: ${varStr.substring(0, 200)}`);
        fileDebug.getVariableDefs.status = 'soft_error';
        errors.push({ phase: 'get_variable_defs', fileKey, nodeId: rootNodeId, message: `Soft error: ${varStr.substring(0, 500)}`, timestamp: new Date().toISOString() });
      } else {
        const estimatedTokens = varStr.length / 3.5;
        fileDebug.getVariableDefs.estimatedTokens = Math.round(estimatedTokens);
        console.log(`      variableDefs: ~${Math.round(estimatedTokens)} tokens`);
        let varData: unknown;
        if (estimatedTokens < MAX_VARIABLE_DEFS_TOKENS) {
          varData = varContent;
        } else {
          console.warn(`      ⚠️ variableDefs too large, storing keys only`);
          varData = extractVariableDefsSummary(varContent);
        }
        result.variableDefs = varData;
      }
    }
  } catch (err: any) {
    const varElapsed = Date.now() - varStart;
    console.warn(`      ⚠️ getVariableDefs failed: ${err.message}`);
    fileDebug.getVariableDefs = { calledAt: new Date(varStart).toISOString(), elapsedMs: varElapsed, status: 'exception', error: err.message };
    errors.push({ phase: 'get_variable_defs', fileKey, nodeId: rootNodeId, message: err.message, timestamp: new Date().toISOString() });
  }

  debugInfo.files.push(fileDebug);

  if (errors.length > 0) {
    result.explorationErrors = errors;
  }

  const successFiles = debugInfo.files.filter((f: any) => f.status === 'success').length;
  console.log(`\n   📊 Exploration complete:`);
  console.log(`      Total frames: ${result.totalFrameCount}`);
  console.log(`      Variation groups: ${result.variationMatrix.length}`);
  console.log(`      Annotations: ${result.annotations.length}`);
  console.log(`      Component sets: ${result.componentStateMatrix.length}`);
  console.log(`      nodeSummary entries: ${result.nodeSummary?.length ?? 0}`);
  console.log(`      variableDefs: ${result.variableDefs ? 'loaded' : 'none'}`);
  if (errors.length > 0) {
    console.log(`      ⚠️ Errors: ${errors.length} (${errors.map(e => e.phase).join(', ')})`);
  }

  // Save debug + result files
  debugInfo.completedAt = new Date().toISOString();
  debugInfo.elapsedMs = Date.now() - phaseStart;
  debugInfo.summary = {
    totalFiles: 1,
    successFiles,
    failedFiles: 1 - successFiles,
    totalNodeCount: debugInfo.files.reduce((s: number, f: any) => s + (f.getMetadata?.parsedNodeCount ?? 0), 0),
    nodeSummaryCount: result.nodeSummary?.length ?? 0,
    variableDefsAvailable: !!result.variableDefs,
    errorCount: errors.length,
  };

  if (state.context?.featurePath) {
    try {
      const runtimeDir = getSessionRuntimeDir(state.context.featurePath, 'architect', 'design');
      await fs.mkdir(runtimeDir, { recursive: true });
      await Promise.all([
        fs.writeFile(path.join(runtimeDir, 'figma-exploration.json'), JSON.stringify(result, null, 2)),
        fs.writeFile(path.join(runtimeDir, 'figma-exploration-debug.json'), JSON.stringify(debugInfo, null, 2)),
      ]);
      console.log(`   💾 Saved figma-exploration.json + figma-exploration-debug.json`);
    } catch (err) {
      console.warn(`   ⚠️ Failed to save figma-exploration sidecar:`, err);
    }

    if (state._httpJobId) {
      try {
        const logger = getExecutionLogger({ featurePath: state.context.featurePath, jobId: state._httpJobId, jobType: 'design' });
        await logger.logPhaseComplete({ phase: 'figmaExplore', elapsedMs: debugInfo.elapsedMs!, details: debugInfo.summary });
      } catch { /* non-blocking */ }
    }
  }

  if (result.totalFrameCount === 0 && (!result.nodeSummary || result.nodeSummary.length === 0)) {
    const errMsg = errors.length > 0
      ? `Figma exploration failed: ${errors[0].message}`
      : 'Figma exploration returned no data from any configured file';
    console.log(`   ❌ No usable Figma data — setting designError to halt job`);
    return {
      figmaExplorationResult: { ...result, explorationErrors: errors },
      designError: {
        type: 'figma_no_data' as const,
        message: errMsg,
      },
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

  return {
    figmaExplorationResult: result,
    _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
  };
  } finally {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'figmaExplore', 0);
    }
  }
}

async function saveDebugFile(state: DesignGraphState, debugInfo: any): Promise<void> {
  if (!state.context?.featurePath) return;
  try {
    const runtimeDir = getSessionRuntimeDir(state.context.featurePath, 'architect', 'design');
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(path.join(runtimeDir, 'figma-exploration-debug.json'), JSON.stringify(debugInfo, null, 2));
  } catch { /* non-blocking */ }
}

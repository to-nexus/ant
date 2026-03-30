/**
 * figmaExplore Node
 *
 * Phase 0 of the Figma pipeline: explores Figma design files using MCP tools
 * to build FigmaExplorationResult (variation matrix, component states, annotations).
 *
 * Steps:
 * 1. Parse figmaConfig to extract file keys and node IDs
 * 2. Call get_metadata for each file to build node tree
 * 3. Identify variation containers, annotations, and component states
 * 4. Return structured FigmaExplorationResult for downstream nodes
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { DesignGraphState } from '../state';
import type { FigmaExplorationResult, FigmaExplorationError, FigmaNodeSummary, VariantProperty } from '@ant/shared';
import { parseFigmaUrl } from '../../../../../core/ports/figma';
import { getFigmaMCPAdapter } from '../../../tools/figmaMCPHandler';
import { extractMCPTextContent, isFigmaMCPSoftError, isLikelyMCPErrorResponse } from '../../../../../periphery/adapters/figma/MCPTransport';
import { isRateLimitResponse } from '../../../../../periphery/adapters/figma/errors';
import { getSessionRuntimeDir } from '../../../../../core/utils/sessionPaths';
import { getExecutionLogger } from '../../../../../core/utils/executionLogger';

interface MetadataNode {
  id: string;
  name: string;
  type: string;
  children?: MetadataNode[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function parseMetadataXML(rawContent: any): MetadataNode[] {
  if (!rawContent) return [];

  // 1) Extract text from MCP response wrapper
  const extracted = extractMCPTextContent(rawContent);
  let content: any = extracted ?? rawContent;

  // 2) If string, try JSON first then XML
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      const xmlNodes = parseXMLToNodes(content);
      if (xmlNodes.length > 0) return xmlNodes;
      console.warn('⚠️  [parseMetadataXML] Failed to parse as JSON or XML, content preview:', content.substring(0, 300));
      return [];
    }
  }

  // 3) Already structured data
  if (Array.isArray(content)) return content;
  if (content.children) return content.children;
  return [content];
}

/**
 * Parse Figma MCP XML metadata into MetadataNode[].
 * Handles format like: <FRAME id="1:2" name="Header" type="FRAME" x="0" y="0" width="1440" height="80">...</FRAME>
 */
function parseXMLToNodes(xml: string): MetadataNode[] {
  const nodes: MetadataNode[] = [];
  const tagPattern = /<(\w+)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let match;

  while ((match = tagPattern.exec(xml)) !== null) {
    const [, tagName, attrs, innerContent] = match;
    const node: MetadataNode = {
      id: extractAttr(attrs, 'id') || '',
      name: extractAttr(attrs, 'name') || tagName,
      type: extractAttr(attrs, 'type') || tagName.toUpperCase(),
    };

    const x = extractAttr(attrs, 'x');
    const y = extractAttr(attrs, 'y');
    const w = extractAttr(attrs, 'width') || extractAttr(attrs, 'w');
    const h = extractAttr(attrs, 'height') || extractAttr(attrs, 'h');
    if (x) node.x = Number(x);
    if (y) node.y = Number(y);
    if (w) node.width = Number(w);
    if (h) node.height = Number(h);

    if (innerContent?.trim()) {
      const children = parseXMLToNodes(innerContent);
      if (children.length > 0) node.children = children;
    }

    if (node.id) nodes.push(node);
  }

  return nodes;
}

function extractAttr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}=["']([^"']*)["']`);
  return pattern.exec(attrs)?.[1];
}

function findFrames(nodes: MetadataNode[]): MetadataNode[] {
  const frames: MetadataNode[] = [];
  for (const node of nodes) {
    if (node.type === 'FRAME' || node.type === 'SECTION' || node.type === 'GROUP') {
      frames.push(node);
    }
    if (node.children) {
      frames.push(...findFrames(node.children));
    }
  }
  return frames;
}

import type { AnnotationEntry } from '@ant/shared';

function findAnnotationTexts(
  nodes: MetadataNode[],
  frameIds: Set<string>,
  parentSection = 'root'
): AnnotationEntry[] {
  const annotations: AnnotationEntry[] = [];
  for (const node of nodes) {
    const currentSection =
      (node.type === 'SECTION' || node.type === 'GROUP') ? node.name : parentSection;
    if (node.type === 'TEXT' && !frameIds.has(node.id)) {
      annotations.push({ section: currentSection, text: node.name, nodeId: node.id });
    }
    if (node.children) {
      annotations.push(...findAnnotationTexts(node.children, frameIds, currentSection));
    }
  }
  return annotations;
}

const VARIATION_MAX_FRAMES_PER_GROUP = 8;
const VARIATION_MIN_WIDTH_RATIO = 1.5;
const VARIATION_MAX_DISTINCT_WIDTHS = 6;

function buildVariationMatrix(
  nodes: MetadataNode[]
): FigmaExplorationResult['variationMatrix'] {
  const matrix: FigmaExplorationResult['variationMatrix'] = [];

  for (const node of nodes) {
    if ((node.type === 'SECTION' || node.type === 'GROUP' || node.type === 'FRAME') && node.children) {
      const childFrames = node.children.filter(
        c => c.type === 'FRAME' && c.width && c.width > 300
      );

      if (childFrames.length >= 2 && childFrames.length <= VARIATION_MAX_FRAMES_PER_GROUP) {
        const widths = childFrames.map(f => Math.round(f.width!));
        const distinctWidths = new Set(widths);
        const minW = Math.min(...widths);
        const maxW = Math.max(...widths);

        if (distinctWidths.size >= 2
            && distinctWidths.size <= VARIATION_MAX_DISTINCT_WIDTHS
            && maxW / minW >= VARIATION_MIN_WIDTH_RATIO) {
          matrix.push({
            section: node.name,
            pageNodeId: node.id,
            frames: childFrames.map(f => ({
              nodeId: f.id,
              name: f.name,
              width: f.width || 0,
              height: f.height || 0,
            })),
          });
        }
      }
    }
    if (node.children) {
      matrix.push(...buildVariationMatrix(node.children));
    }
  }

  return matrix;
}

function parseVariantName(name: string): VariantProperty[] {
  if (!name.includes('=')) return [];
  return name.split(',')
    .map(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return null;
      return { property: pair.substring(0, eqIdx).trim(), value: pair.substring(eqIdx + 1).trim() };
    })
    .filter((p): p is VariantProperty => p !== null && p.property.length > 0);
}

function buildComponentStateMatrix(
  nodes: MetadataNode[]
): FigmaExplorationResult['componentStateMatrix'] {
  const matrix: FigmaExplorationResult['componentStateMatrix'] = [];

  for (const node of nodes) {
    if (node.type === 'COMPONENT_SET' && node.children) {
      const frames = node.children.map(c => {
        const variantProperties = parseVariantName(c.name);
        return {
          nodeId: c.id,
          name: c.name,
          stateName: c.name,
          ...(variantProperties.length > 0 ? { variantProperties } : {}),
          width: c.width || 0,
          height: c.height || 0,
        };
      });

      const axesSet = new Set<string>();
      for (const f of frames) {
        if (f.variantProperties) {
          for (const vp of f.variantProperties) axesSet.add(vp.property);
        }
      }

      matrix.push({
        componentName: node.name,
        ...(axesSet.size > 0 ? { variantAxes: [...axesSet] } : {}),
        frames,
      });
    }
    if (node.children) {
      matrix.push(...buildComponentStateMatrix(node.children));
    }
  }

  return matrix;
}

const NODE_SUMMARY_TYPES = new Set(['FRAME', 'SECTION', 'COMPONENT_SET', 'COMPONENT', 'GROUP']);
const NODE_SUMMARY_MAX_ENTRIES = 300;
const MAX_VARIABLE_DEFS_TOKENS = 8000;

function scanAllNodes(nodes: MetadataNode[], depth: number): FigmaNodeSummary[] {
  const result: FigmaNodeSummary[] = [];
  for (const node of nodes) {
    if (NODE_SUMMARY_TYPES.has(node.type)) {
      const entry: FigmaNodeSummary = {
        nodeId: node.id, name: node.name, type: node.type,
        depth, childCount: node.children?.length ?? 0,
      };
      if (node.width && node.height) {
        entry.dimensions = { width: node.width, height: node.height };
      }
      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        entry.isComponent = true;
      }
      result.push(entry);
    }
    if (node.children) result.push(...scanAllNodes(node.children, depth + 1));
  }
  return result;
}

function buildNodeSummary(nodes: MetadataNode[]): FigmaNodeSummary[] {
  const all = scanAllNodes(nodes, 0);
  if (all.length <= NODE_SUMMARY_MAX_ENTRIES) return all;

  const maxDepth = Math.max(...all.map(n => n.depth));
  for (let cutoff = maxDepth - 1; cutoff >= 2; cutoff--) {
    const pruned = all.filter(n => n.depth <= cutoff);
    if (pruned.length <= NODE_SUMMARY_MAX_ENTRIES) return pruned;
  }
  return all.filter(n => n.depth <= 1);
}

export async function figmaExplore(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  const phaseStart = Date.now();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 FIGMA EXPLORE (Phase 0)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const figmaConfig = state.figmaConfig;
  if (!figmaConfig?.files?.length) {
    console.log('   ⚠️ No Figma files configured, skipping exploration');
    return {
      figmaExplorationResult: emptyResult(),
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

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
      designError: { type: 'figma_window_not_open', message: errMsg },
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

  for (const url of figmaConfig.files) {
    const parsed = parseFigmaUrl(url);
    if (!parsed) {
      console.log(`   ⚠️ Invalid Figma URL: ${url}`);
      continue;
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
      console.log(`   ❌ Metadata fetch failed: ${metadataResult.content}`);
      fileDebug.status = 'metadata_error';
      errors.push({ phase: 'get_metadata', fileKey, nodeId: rootNodeId, message: String(metadataResult.content), timestamp: new Date().toISOString() });
      debugInfo.files.push(fileDebug);
      continue;
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
      continue;
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
          if (!result.variableDefs) {
            result.variableDefs = varData;
          } else {
            result.variableDefs = mergeVariableDefs(result.variableDefs, varData);
          }
        }
      }
    } catch (err: any) {
      const varElapsed = Date.now() - varStart;
      console.warn(`      ⚠️ getVariableDefs failed: ${err.message}`);
      fileDebug.getVariableDefs = { calledAt: new Date(varStart).toISOString(), elapsedMs: varElapsed, status: 'exception', error: err.message };
      errors.push({ phase: 'get_variable_defs', fileKey, nodeId: rootNodeId, message: err.message, timestamp: new Date().toISOString() });
    }

    debugInfo.files.push(fileDebug);
  }

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
    totalFiles: figmaConfig.files.length,
    successFiles,
    failedFiles: figmaConfig.files.length - successFiles,
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

    // Log phase completion to execution logger
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
        type: 'figma_window_not_open' as const,
        message: errMsg,
      },
      _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
    };
  }

  return {
    figmaExplorationResult: result,
    _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
  };
}

async function saveDebugFile(state: DesignGraphState, debugInfo: any): Promise<void> {
  if (!state.context?.featurePath) return;
  try {
    const runtimeDir = getSessionRuntimeDir(state.context.featurePath, 'architect', 'design');
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(path.join(runtimeDir, 'figma-exploration-debug.json'), JSON.stringify(debugInfo, null, 2));
  } catch { /* non-blocking */ }
}

function countNodes(nodes: MetadataNode[]): number {
  let count = nodes.length;
  for (const n of nodes) {
    if (n.children) count += countNodes(n.children);
  }
  return count;
}

function emptyResult(): FigmaExplorationResult {
  return {
    variationMatrix: [],
    annotations: [],
    componentStateMatrix: [],
    totalFrameCount: 0,
    downloadedAssets: [],
  };
}

function mergeVariableDefs(existing: unknown, incoming: unknown): unknown {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return [...existing, ...incoming];
  }
  if (typeof existing === 'object' && existing !== null
      && typeof incoming === 'object' && incoming !== null) {
    return { ...(existing as Record<string, unknown>), ...(incoming as Record<string, unknown>) };
  }
  return [existing, incoming];
}

function extractVariableDefsSummary(content: unknown): unknown {
  try {
    const obj = typeof content === 'string' ? JSON.parse(content) : content;
    if (typeof obj !== 'object' || obj === null) return content;
    const summary: Record<string, number> = {};
    const modes: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(obj)) {
      summary[key] = Array.isArray(value) ? value.length
        : (typeof value === 'object' && value !== null) ? Object.keys(value).length
        : 1;
      const valueObj = value as Record<string, unknown>;
      if (typeof valueObj === 'object' && valueObj !== null) {
        if ('modes' in valueObj) {
          modes[key] = Object.keys(valueObj.modes as object);
        } else if ('valuesByMode' in valueObj) {
          modes[key] = Object.keys(valueObj.valuesByMode as object);
        }
      }
    }
    const result: Record<string, unknown> = { _summary: true, collections: summary };
    if (Object.keys(modes).length > 0) result.modes = modes;
    return result;
  } catch {
    return { _summary: true, error: 'parse_failed' };
  }
}


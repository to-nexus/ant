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

import { DesignGraphState } from '../state';
import type { FigmaExplorationResult, FigmaNodeSummary } from '@ant/shared';
import { parseFigmaUrl } from '../../../../../core/ports/figma';
import { getMCPAdapter } from './tool';

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

function parseMetadataXML(content: any): MetadataNode[] {
  if (!content) return [];
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      return [];
    }
  }
  if (Array.isArray(content)) return content;
  if (content.children) return content.children;
  return [content];
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

function buildVariationMatrix(
  nodes: MetadataNode[]
): FigmaExplorationResult['variationMatrix'] {
  const matrix: FigmaExplorationResult['variationMatrix'] = [];

  for (const node of nodes) {
    if ((node.type === 'SECTION' || node.type === 'GROUP' || node.type === 'FRAME') && node.children) {
      const childFrames = node.children.filter(
        c => c.type === 'FRAME' && c.width && c.width > 300
      );
      if (childFrames.length > 1) {
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
    if (node.children) {
      matrix.push(...buildVariationMatrix(node.children));
    }
  }

  return matrix;
}

function buildComponentStateMatrix(
  nodes: MetadataNode[]
): FigmaExplorationResult['componentStateMatrix'] {
  const matrix: FigmaExplorationResult['componentStateMatrix'] = [];

  for (const node of nodes) {
    if (node.type === 'COMPONENT_SET' && node.children) {
      matrix.push({
        componentName: node.name,
        frames: node.children.map(c => ({
          nodeId: c.id,
          name: c.name,
          stateName: c.name,
          width: c.width || 0,
          height: c.height || 0,
        })),
      });
    }
    if (node.children) {
      matrix.push(...buildComponentStateMatrix(node.children));
    }
  }

  return matrix;
}

const NODE_SUMMARY_TYPES = new Set(['FRAME', 'SECTION', 'COMPONENT_SET', 'COMPONENT', 'GROUP']);
const NODE_SUMMARY_MAX_DEPTH = 3;
const MAX_VARIABLE_DEFS_TOKENS = 8000;

function buildNodeSummary(
  nodes: MetadataNode[],
  depth = 0,
): FigmaNodeSummary[] {
  const summaries: FigmaNodeSummary[] = [];
  for (const node of nodes) {
    if (NODE_SUMMARY_TYPES.has(node.type)) {
      summaries.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        depth,
        childCount: node.children?.length ?? 0,
      });
    }
    if (node.children && depth < NODE_SUMMARY_MAX_DEPTH) {
      summaries.push(...buildNodeSummary(node.children, depth + 1));
    }
  }
  return summaries;
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

  const adapter = getMCPAdapter(state);

  const result: FigmaExplorationResult = {
    variationMatrix: [],
    annotations: [],
    componentStateMatrix: [],
    interactionStates: [],
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

    console.log(`   📄 Exploring file: ${fileKey} (node: ${rootNodeId})`);

    const metadataResult = await adapter.getMetadata(fileKey, rootNodeId);
    if (metadataResult.isError) {
      console.log(`   ❌ Metadata fetch failed: ${metadataResult.content}`);
      continue;
    }

    const nodes = parseMetadataXML(metadataResult.content);
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
    console.log(`      nodeSummary: ${nodeSummary.length} entries (depth <= ${NODE_SUMMARY_MAX_DEPTH})`);

    try {
      const varResult = await adapter.getVariableDefs(fileKey, rootNodeId);
      if (!varResult.isError) {
        const varContent = varResult.content;
        const varStr = typeof varContent === 'string' ? varContent : JSON.stringify(varContent);
        const estimatedTokens = varStr.length / 3.5;
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
    } catch (err: any) {
      console.warn(`      ⚠️ getVariableDefs failed: ${err.message}`);
    }
  }

  console.log(`\n   📊 Exploration complete:`);
  console.log(`      Total frames: ${result.totalFrameCount}`);
  console.log(`      Variation groups: ${result.variationMatrix.length}`);
  console.log(`      Annotations: ${result.annotations.length}`);
  console.log(`      Component sets: ${result.componentStateMatrix.length}`);
  console.log(`      nodeSummary entries: ${result.nodeSummary?.length ?? 0}`);
  console.log(`      variableDefs: ${result.variableDefs ? 'loaded' : 'none'}`);

  return {
    figmaExplorationResult: result,
    _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
  };
}

function emptyResult(): FigmaExplorationResult {
  return {
    variationMatrix: [],
    annotations: [],
    componentStateMatrix: [],
    interactionStates: [],
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
    for (const [key, value] of Object.entries(obj)) {
      summary[key] = Array.isArray(value) ? value.length
        : (typeof value === 'object' && value !== null) ? Object.keys(value).length
        : 1;
    }
    return { _summary: true, collections: summary };
  } catch {
    return { _summary: true, error: 'parse_failed' };
  }
}


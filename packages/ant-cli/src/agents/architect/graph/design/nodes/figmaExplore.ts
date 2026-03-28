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
import type { FigmaExplorationResult, FigmaNodeSummary } from '@ant/shared';
import { parseFigmaUrl } from '../../../../../core/ports/figma';
import { getMCPAdapter } from './tool';
import { extractMCPTextContent, isFigmaMCPSoftError } from '../../../../../periphery/adapters/figma/MCPTransport';
import { getSessionRuntimeDir } from '../../../../../core/utils/sessionPaths';

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

    const rawContent = metadataResult.content;
    const contentType = Array.isArray(rawContent) ? 'array' : typeof rawContent;
    const contentSize = typeof rawContent === 'string' ? rawContent.length : JSON.stringify(rawContent).length;
    const extractedPreview = extractMCPTextContent(rawContent);
    console.log(`      metadata response: type=${contentType}, size=${contentSize}, extracted=${extractedPreview ? extractedPreview.substring(0, 120) + '...' : 'null'}`);

    if (extractedPreview && isFigmaMCPSoftError(extractedPreview)) {
      console.log(`   ❌ Figma MCP soft error: "${extractedPreview}"`);
      return {
        figmaExplorationResult: emptyResult(),
        designError: {
          type: 'figma_window_not_open',
          message: `Figma 파일이 열려있지 않습니다: ${extractedPreview}`,
          suggestedAction: 'Figma Desktop에서 디자인 파일을 연 후 다시 시도하세요.',
        },
        _phaseTimings: { ...(state._phaseTimings || {}), figmaExplore: Date.now() - phaseStart },
      };
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
        const rawVarContent = varResult.content;
        const varContent = extractMCPTextContent(rawVarContent) ?? rawVarContent;
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

  if (state.context?.featurePath) {
    try {
      const runtimeDir = getSessionRuntimeDir(state.context.featurePath, 'architect', 'design');
      await fs.mkdir(runtimeDir, { recursive: true });
      await fs.writeFile(
        path.join(runtimeDir, 'figma-exploration.json'),
        JSON.stringify(result, null, 2),
      );
      console.log(`   💾 Saved figma-exploration.json sidecar`);
    } catch (err) {
      console.warn(`   ⚠️ Failed to save figma-exploration sidecar:`, err);
    }
  }

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


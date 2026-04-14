import type { MetadataNode } from './metadataParser';
import type { FigmaExplorationResult, FigmaNodeSummary, VariantProperty, AnnotationEntry } from '@ant/shared';

export function findFrames(nodes: MetadataNode[]): MetadataNode[] {
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

export function findAnnotationTexts(
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

export function buildVariationMatrix(
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

export function buildComponentStateMatrix(
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

export function buildNodeSummary(nodes: MetadataNode[]): FigmaNodeSummary[] {
  const all = scanAllNodes(nodes, 0);
  if (all.length <= NODE_SUMMARY_MAX_ENTRIES) return all;

  const maxDepth = Math.max(...all.map(n => n.depth));
  for (let cutoff = maxDepth - 1; cutoff >= 2; cutoff--) {
    const pruned = all.filter(n => n.depth <= cutoff);
    if (pruned.length <= NODE_SUMMARY_MAX_ENTRIES) return pruned;
  }
  return all.filter(n => n.depth <= 1);
}

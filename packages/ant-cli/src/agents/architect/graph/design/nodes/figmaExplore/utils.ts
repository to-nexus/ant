import type { MetadataNode } from './metadataParser';
import type { FigmaExplorationResult } from '@ant/shared';

export function countNodes(nodes: MetadataNode[]): number {
  let count = nodes.length;
  for (const n of nodes) {
    if (n.children) count += countNodes(n.children);
  }
  return count;
}

export function emptyResult(): FigmaExplorationResult {
  return {
    variationMatrix: [],
    annotations: [],
    componentStateMatrix: [],
    totalFrameCount: 0,
    downloadedAssets: [],
  };
}

export function mergeVariableDefs(existing: unknown, incoming: unknown): unknown {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return [...existing, ...incoming];
  }
  if (typeof existing === 'object' && existing !== null
      && typeof incoming === 'object' && incoming !== null) {
    return { ...(existing as Record<string, unknown>), ...(incoming as Record<string, unknown>) };
  }
  return [existing, incoming];
}

export function extractVariableDefsSummary(content: unknown): unknown {
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

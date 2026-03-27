/**
 * Figma Integration Types
 * 
 * Shared types for Figma data configuration and MCP tool interaction.
 * Used by ant-cli (cloud agent) and ant-ui (frontend).
 * 
 * Bridge/Ant Desktop types are in bridge.ts (separate concern).
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const FIGMA_FILENAME = 'figma.json';
export const FIGMA_INPUT_PATH = 'inputs/figma.json';
export const FIGMA_MCP_ENDPOINT = 'http://127.0.0.1:3845/mcp';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Figma Data Configuration (inputs/figma.json schema)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Simplified figma.json schema — just an array of Figma URLs.
 * Each URL points to a Figma file or a specific node within a file.
 */
export interface FigmaDataConfig {
  files: string[];
}

export function createEmptyFigmaData(): FigmaDataConfig {
  return { files: [] };
}

export function isFigmaDataPopulated(data: FigmaDataConfig | undefined | null): boolean {
  if (!data) return false;
  return data.files.length > 0;
}

/**
 * Migrate legacy figma.json (object-based files[], config block) to
 * the simplified URL-only format. Safe to call on already-migrated data.
 */
export function migrateFigmaConfig(raw: unknown): FigmaDataConfig {
  if (!raw || typeof raw !== 'object') return createEmptyFigmaData();
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.files)) return createEmptyFigmaData();
  if (obj.files.length === 0) return { files: [] };
  if (typeof obj.files[0] === 'object' && obj.files[0] !== null) {
    return { files: obj.files.map((f: any) => f.url).filter(Boolean) };
  }
  return { files: obj.files.filter((f: unknown) => typeof f === 'string') };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UI Design Source Mode
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type UIDesignSource = 'figma' | 'references' | 'none';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCP Tool Types (Figma Desktop MCP tools)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface MCPToolResult {
  content: unknown;
  isError?: boolean;
}

export type FigmaMCPTool =
  | 'get_metadata'
  | 'get_design_context'
  | 'get_screenshot'
  | 'get_variable_defs';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// figmaExplore Node Output
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface VariationMatrixEntry {
  section: string;
  pageNodeId: string;
  frames: Array<{
    nodeId: string;
    name: string;
    theme?: string;
    width: number;
    height: number;
  }>;
}

export interface AnnotationEntry {
  section: string;
  text: string;
  nodeId: string;
}

export interface ComponentStateEntry {
  componentName: string;
  frames: Array<{
    nodeId: string;
    name: string;
    stateName: string;
    width: number;
    height: number;
  }>;
}

export interface InteractionStateEntry {
  groupName: string;
  trigger: string;
  frames: Array<{
    nodeId: string;
    name: string;
    state: string;
  }>;
}

export interface FigmaExplorationResult {
  variationMatrix: VariationMatrixEntry[];
  annotations: AnnotationEntry[];
  componentStateMatrix: ComponentStateEntry[];
  interactionStates: InteractionStateEntry[];
  variableDefs?: unknown;
  totalFrameCount: number;
  downloadedAssets: string[];
  nodeSummary?: FigmaNodeSummary[];
}

export interface FigmaNodeSummary {
  nodeId: string;
  name: string;
  type: string;
  depth: number;
  childCount: number;
}

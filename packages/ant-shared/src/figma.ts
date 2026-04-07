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
export const FIGMA_MCP_ENDPOINT = 'http://127.0.0.1:3845/mcp';
export const FIGMA_LOCAL_ASSET_ORIGINS = [
  'http://127.0.0.1:3845',
  'http://localhost:3845',
];
export const ASSET_PROXY_TOOL_NAME = '_ant_asset_download';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Figma Data Configuration (inputs/figma.json schema)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * figma.json schema — single Figma URL pointing to a file or node.
 * Figma Desktop MCP only supports the active tab, so one file at a time.
 */
export interface FigmaDataConfig {
  file: string | null;
}

export function createEmptyFigmaData(): FigmaDataConfig {
  return { file: null };
}

export function isFigmaDataPopulated(data: FigmaDataConfig | undefined | null): boolean {
  if (!data) return false;
  return !!data.file;
}

/**
 * Migrate legacy figma.json formats to the single-file schema.
 * Handles: { files: string[] }, { files: {url:string}[] }, { file: string|null }.
 * Safe to call on already-migrated data.
 */
export function migrateFigmaConfig(raw: unknown): FigmaDataConfig {
  if (!raw || typeof raw !== 'object') return createEmptyFigmaData();
  const obj = raw as Record<string, unknown>;

  // Already new format
  if ('file' in obj && !('files' in obj)) {
    const val = obj.file;
    return { file: typeof val === 'string' && val ? val : null };
  }

  // Legacy: files array
  if (Array.isArray(obj.files)) {
    if (obj.files.length === 0) return createEmptyFigmaData();
    const first = obj.files[0];
    if (typeof first === 'string') return { file: first || null };
    if (first && typeof first === 'object' && 'url' in (first as any)) {
      return { file: (first as any).url || null };
    }
  }

  return createEmptyFigmaData();
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

export interface VariantProperty {
  property: string;
  value: string;
}

export interface ComponentStateEntry {
  componentName: string;
  variantAxes?: string[];
  frames: Array<{
    nodeId: string;
    name: string;
    stateName: string;
    variantProperties?: VariantProperty[];
    width: number;
    height: number;
  }>;
}

export interface FigmaExplorationResult {
  variationMatrix: VariationMatrixEntry[];
  annotations: AnnotationEntry[];
  componentStateMatrix: ComponentStateEntry[];
  variableDefs?: unknown;
  totalFrameCount: number;
  downloadedAssets: string[];
  nodeSummary?: FigmaNodeSummary[];
  explorationErrors?: FigmaExplorationError[];
}

export interface FigmaExplorationError {
  phase: 'adapter_init' | 'get_metadata' | 'get_variable_defs' | 'parse_metadata' | 'parse_url';
  fileKey?: string;
  nodeId?: string;
  message: string;
  timestamp: string;
}

/**
 * Extract fileKey and optional nodeId from a Figma URL.
 * URL format: https://figma.com/design/:fileKey/:fileName?node-id=1-2
 */
export function extractFigmaUrlParts(url: string): { fileKey?: string; nodeId?: string } {
  const keyMatch = url.match(/figma\.com\/(?:design|file)\/([^\/]+)/);
  const nodeMatch = url.match(/node-id=([^&]+)/);
  return {
    fileKey: keyMatch?.[1],
    nodeId: nodeMatch?.[1]?.replace(/-/g, ':'),
  };
}

export interface FigmaNodeSummary {
  nodeId: string;
  name: string;
  type: string;
  depth: number;
  childCount: number;
  dimensions?: { width: number; height: number };
  isComponent?: boolean;
}

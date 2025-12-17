/**
 * Figma Port
 * Interface for Figma MCP integration
 * 
 * Provides access to Figma designs through MCP (Model Context Protocol)
 */

export interface FigmaPort {
  // Connection Management
  connect(token: string, serverUrl: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  
  // File Operations
  getFile(fileKey: string): Promise<FigmaFile>;
  getFileNodes(fileKey: string, nodeIds: string[]): Promise<FigmaNode[]>;
  
  // Design System
  getStyles(fileKey: string): Promise<FigmaStyle[]>;
  getComponents(fileKey: string): Promise<FigmaComponent[]>;
  getVariables(fileKey: string): Promise<FigmaVariable[]>;
  
  // Design Tokens
  extractDesignTokens(fileKey: string): Promise<DesignTokens>;
  
  // Code Generation Context
  getComponentCode(fileKey: string, nodeId: string, options?: CodeGenOptions): Promise<string>;
}

export interface FigmaFile {
  name: string;
  lastModified: string;
  thumbnailUrl?: string;
  version: string;
  document: FigmaNode;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: NodeType;
  visible?: boolean;
  locked?: boolean;
  children?: FigmaNode[];
  
  // Layout
  absoluteBoundingBox?: BoundingBox;
  absoluteRenderBounds?: BoundingBox;
  constraints?: Constraints;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutAlign?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  
  // Styling
  fills?: Paint[];
  strokes?: Paint[];
  effects?: Effect[];
  opacity?: number;
  blendMode?: BlendMode;
  
  // Typography (for TEXT nodes)
  characters?: string;
  style?: TypeStyle;
  
  // Component (for COMPONENT/INSTANCE nodes)
  componentId?: string;
  componentProperties?: Record<string, any>;
  
  // Auto Layout
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  
  // Additional properties
  exportSettings?: ExportSetting[];
  plugins?: any;
}

export type NodeType = 
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'VECTOR'
  | 'BOOLEAN_OPERATION'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'REGULAR_POLYGON'
  | 'RECTANGLE'
  | 'TEXT'
  | 'SLICE'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Constraints {
  vertical: 'TOP' | 'BOTTOM' | 'CENTER' | 'TOP_BOTTOM' | 'SCALE';
  horizontal: 'LEFT' | 'RIGHT' | 'CENTER' | 'LEFT_RIGHT' | 'SCALE';
}

export interface Paint {
  type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND' | 'IMAGE' | 'EMOJI';
  visible?: boolean;
  opacity?: number;
  color?: Color;
  gradientStops?: GradientStop[];
  scaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH';
}

export interface Color {
  r: number;  // 0-1
  g: number;  // 0-1
  b: number;  // 0-1
  a: number;  // 0-1
}

export interface GradientStop {
  position: number;  // 0-1
  color: Color;
}

export interface Effect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  visible?: boolean;
  radius: number;
  color?: Color;
  offset?: { x: number; y: number };
  spread?: number;
}

export type BlendMode = 
  | 'PASS_THROUGH'
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'LINEAR_BURN'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'LINEAR_DODGE'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY';

export interface TypeStyle {
  fontFamily: string;
  fontPostScriptName?: string;
  fontWeight: number;
  fontSize: number;
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM';
  letterSpacing: number;
  lineHeightPx: number;
  lineHeightPercent?: number;
  lineHeightUnit: 'PIXELS' | 'FONT_SIZE_%' | 'INTRINSIC_%';
}

export interface ExportSetting {
  suffix: string;
  format: 'JPG' | 'PNG' | 'SVG' | 'PDF';
  constraint: {
    type: 'SCALE' | 'WIDTH' | 'HEIGHT';
    value: number;
  };
}

export interface FigmaStyle {
  key: string;
  name: string;
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
  description?: string;
  remote?: boolean;
  
  // Style properties
  fills?: Paint[];
  strokes?: Paint[];
  textStyle?: TypeStyle;
  effects?: Effect[];
}

export interface FigmaComponent {
  key: string;
  name: string;
  description?: string;
  remote?: boolean;
  componentSetId?: string;
  
  // Component metadata
  node: FigmaNode;
}

export interface FigmaVariable {
  id: string;
  name: string;
  key: string;
  variableCollectionId: string;
  resolvedType: 'BOOLEAN' | 'FLOAT' | 'STRING' | 'COLOR';
  valuesByMode: Record<string, any>;
  description?: string;
}

export interface DesignTokens {
  colors: Record<string, ColorToken>;
  typography: Record<string, TypographyToken>;
  spacing: Record<string, number>;
  borderRadius: Record<string, number>;
  shadows: Record<string, ShadowToken>;
  sizing: Record<string, number>;
}

export interface ColorToken {
  value: string;  // hex, rgb, rgba
  type: 'solid' | 'gradient';
  description?: string;
}

export interface TypographyToken {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | string;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
}

export interface ShadowToken {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  color: string;
  type: 'drop' | 'inner';
}

export interface CodeGenOptions {
  framework?: 'react' | 'vue' | 'svelte' | 'html';
  styling?: 'css' | 'tailwind' | 'styled-components' | 'emotion';
  typescript?: boolean;
  includeComments?: boolean;
}

/**
 * Parse Figma URL to extract file key and node ID
 * 
 * Examples:
 * - https://www.figma.com/file/ABC123/My-Design
 * - https://www.figma.com/file/ABC123?node-id=123:456
 */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  // Match: https://www.figma.com/file/{fileKey}/{title}?node-id={nodeId}
  const fileRegex = /figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/;
  const nodeRegex = /node-id=([^&]+)/;
  
  const fileMatch = url.match(fileRegex);
  if (!fileMatch) return null;
  
  const fileKey = fileMatch[1];
  const nodeMatch = url.match(nodeRegex);
  const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]) : undefined;
  
  return { fileKey, nodeId };
}


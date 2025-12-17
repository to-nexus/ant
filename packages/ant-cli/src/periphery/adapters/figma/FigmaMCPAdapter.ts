/**
 * Figma MCP Adapter
 * 
 * Implements FigmaPort using Figma MCP (Model Context Protocol)
 * Supports both remote and local MCP servers
 */

import { 
  FigmaPort, 
  FigmaFile, 
  FigmaNode, 
  FigmaStyle, 
  FigmaComponent, 
  FigmaVariable,
  DesignTokens,
  CodeGenOptions,
  Color,
  ColorToken,
  TypographyToken,
  ShadowToken
} from '../../../core/ports/figma';

export interface FigmaMCPConfig {
  token: string;
  serverUrl: string;
  serverType: 'remote' | 'local';
}

/**
 * Figma MCP Adapter
 * 
 * TODO: Integrate with actual MCP SDK when available
 * For now, uses Figma REST API as fallback
 */
export class FigmaMCPAdapter implements FigmaPort {
  private config?: FigmaMCPConfig;
  private connected: boolean = false;
  
  async connect(token: string, serverUrl: string): Promise<void> {
    console.log(`[FigmaMCPAdapter] Connecting to MCP server: ${serverUrl}`);
    
    this.config = {
      token,
      serverUrl,
      serverType: serverUrl.includes('figma.com') ? 'remote' : 'local'
    };
    
    // Test connection
    const isValid = await this.testConnection();
    if (!isValid) {
      throw new Error('Failed to connect to Figma MCP server');
    }
    
    this.connected = true;
    console.log(`[FigmaMCPAdapter] ✅ Connected successfully`);
  }
  
  async disconnect(): Promise<void> {
    this.config = undefined;
    this.connected = false;
    console.log(`[FigmaMCPAdapter] Disconnected`);
  }
  
  async isConnected(): Promise<boolean> {
    return this.connected;
  }
  
  async getFile(fileKey: string): Promise<FigmaFile> {
    this.ensureConnected();
    
    console.log(`[FigmaMCPAdapter] Fetching file: ${fileKey}`);
    
    // TODO: Use MCP protocol when SDK is available
    // For now, fallback to Figma REST API
    const response = await this.figmaApiRequest(`/v1/files/${fileKey}`);
    
    return {
      name: response.name,
      lastModified: response.lastModified,
      thumbnailUrl: response.thumbnailUrl,
      version: response.version,
      document: response.document
    };
  }
  
  async getFileNodes(fileKey: string, nodeIds: string[]): Promise<FigmaNode[]> {
    this.ensureConnected();
    
    console.log(`[FigmaMCPAdapter] Fetching nodes: ${nodeIds.join(', ')}`);
    
    const idsParam = nodeIds.join(',');
    const response = await this.figmaApiRequest(`/v1/files/${fileKey}/nodes?ids=${idsParam}`);
    
    return Object.values(response.nodes).map((node: any) => node.document);
  }
  
  async getStyles(fileKey: string): Promise<FigmaStyle[]> {
    this.ensureConnected();
    
    const response = await this.figmaApiRequest(`/v1/files/${fileKey}/styles`);
    return response.meta?.styles || [];
  }
  
  async getComponents(fileKey: string): Promise<FigmaComponent[]> {
    this.ensureConnected();
    
    const response = await this.figmaApiRequest(`/v1/files/${fileKey}/components`);
    return response.meta?.components || [];
  }
  
  async getVariables(fileKey: string): Promise<FigmaVariable[]> {
    this.ensureConnected();
    
    try {
      const response = await this.figmaApiRequest(`/v1/files/${fileKey}/variables/local`);
      return response.meta?.variables || [];
    } catch (error) {
      console.warn('[FigmaMCPAdapter] Variables API not available, returning empty array');
      return [];
    }
  }
  
  async extractDesignTokens(fileKey: string): Promise<DesignTokens> {
    this.ensureConnected();
    
    console.log(`[FigmaMCPAdapter] Extracting design tokens from ${fileKey}`);
    
    const [file, styles, variables] = await Promise.all([
      this.getFile(fileKey),
      this.getStyles(fileKey),
      this.getVariables(fileKey)
    ]);
    
    const tokens: DesignTokens = {
      colors: {},
      typography: {},
      spacing: {},
      borderRadius: {},
      shadows: {},
      sizing: {}
    };
    
    // Extract colors from styles
    for (const style of styles) {
      if (style.styleType === 'FILL' && style.fills?.[0]) {
        const fill = style.fills[0];
        if (fill.type === 'SOLID' && fill.color) {
          const colorName = this.normalizeTokenName(style.name);
          tokens.colors[colorName] = {
            value: this.colorToHex(fill.color),
            type: 'solid',
            description: style.description
          };
        }
      }
      
      if (style.styleType === 'TEXT' && style.textStyle) {
        const typeName = this.normalizeTokenName(style.name);
        tokens.typography[typeName] = {
          fontFamily: style.textStyle.fontFamily,
          fontSize: style.textStyle.fontSize,
          fontWeight: style.textStyle.fontWeight,
          lineHeight: style.textStyle.lineHeightPx,
          letterSpacing: style.textStyle.letterSpacing
        };
      }
      
      if (style.styleType === 'EFFECT' && style.effects?.[0]) {
        const effect = style.effects[0];
        if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
          const shadowName = this.normalizeTokenName(style.name);
          tokens.shadows[shadowName] = {
            x: effect.offset?.x || 0,
            y: effect.offset?.y || 0,
            blur: effect.radius,
            spread: effect.spread || 0,
            color: effect.color ? this.colorToHex(effect.color) : '#000000',
            type: effect.type === 'DROP_SHADOW' ? 'drop' : 'inner'
          };
        }
      }
    }
    
    // Extract spacing and sizing from variables
    for (const variable of variables) {
      const varName = this.normalizeTokenName(variable.name);
      
      if (variable.resolvedType === 'FLOAT') {
        const value = Object.values(variable.valuesByMode)[0] as number;
        
        if (variable.name.toLowerCase().includes('spacing') || 
            variable.name.toLowerCase().includes('gap')) {
          tokens.spacing[varName] = value;
        } else if (variable.name.toLowerCase().includes('radius')) {
          tokens.borderRadius[varName] = value;
        } else {
          tokens.sizing[varName] = value;
        }
      }
      
      if (variable.resolvedType === 'COLOR') {
        const colorValue = Object.values(variable.valuesByMode)[0] as any;
        tokens.colors[varName] = {
          value: this.colorToHex(colorValue),
          type: 'solid',
          description: variable.description
        };
      }
    }
    
    console.log(`[FigmaMCPAdapter] ✅ Extracted design tokens:`, {
      colors: Object.keys(tokens.colors).length,
      typography: Object.keys(tokens.typography).length,
      spacing: Object.keys(tokens.spacing).length,
      shadows: Object.keys(tokens.shadows).length
    });
    
    return tokens;
  }
  
  async getComponentCode(
    fileKey: string, 
    nodeId: string, 
    options?: CodeGenOptions
  ): Promise<string> {
    this.ensureConnected();
    
    console.log(`[FigmaMCPAdapter] Generating code for node ${nodeId}`);
    
    const nodes = await this.getFileNodes(fileKey, [nodeId]);
    const node = nodes[0];
    
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }
    
    const framework = options?.framework || 'react';
    const styling = options?.styling || 'css';
    const typescript = options?.typescript ?? true;
    
    // TODO: Implement proper code generation based on framework and styling
    // For now, return placeholder
    return this.generatePlaceholderCode(node, framework, styling, typescript);
  }
  
  // Private helper methods
  
  private ensureConnected(): void {
    if (!this.connected || !this.config) {
      throw new Error('Not connected to Figma MCP server. Call connect() first.');
    }
  }
  
  private async testConnection(): Promise<boolean> {
    if (!this.config) return false;
    
    try {
      // Test with a simple API call to check token validity
      await this.figmaApiRequest('/v1/me');
      return true;
    } catch (error) {
      console.error('[FigmaMCPAdapter] Connection test failed:', error);
      return false;
    }
  }
  
  private async figmaApiRequest(endpoint: string): Promise<any> {
    if (!this.config) {
      throw new Error('Not connected');
    }
    
    // Use Figma REST API as fallback
    const baseUrl = 'https://api.figma.com';
    const url = `${baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'X-Figma-Token': this.config.token,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
  
  private colorToHex(color: Color): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = color.a;
    
    if (a < 1) {
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  
  private normalizeTokenName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  
  private generatePlaceholderCode(
    node: FigmaNode,
    framework: string,
    styling: string,
    typescript: boolean
  ): string {
    const ext = typescript ? 'tsx' : 'jsx';
    
    return `// Generated from Figma node: ${node.name}
// Framework: ${framework}, Styling: ${styling}

export const ${this.toPascalCase(node.name)} = () => {
  return (
    <div className="${this.toKebabCase(node.name)}">
      {/* TODO: Implement component based on Figma design */}
      <p>${node.name}</p>
    </div>
  );
};
`;
  }
  
  private toPascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
      .replace(/^./, chr => chr.toUpperCase());
  }
  
  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
      .replace(/^-+|-+$/g, '');
  }
}


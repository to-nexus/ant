/**
 * Figma Port
 * 
 * MCP-only design: Figma mode requires Full MCP connectivity
 * via Ant Desktop bridge (cloud) or direct local MCP (local).
 */

import type { MCPToolResult } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Port Interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface FigmaPort {
  // MCP Tools (Full MCP required -- used by figmaExplore + docGen)
  getDesignContext(fileKey: string, nodeId: string): Promise<MCPToolResult>;
  getMetadata(fileKey: string, nodeId: string): Promise<MCPToolResult>;
  getScreenshot(fileKey: string, nodeId: string): Promise<MCPToolResult>;
  getVariableDefs(fileKey: string, nodeId: string): Promise<MCPToolResult>;

  // Connectivity
  checkMCPAvailability(): Promise<boolean>;
}

/**
 * Parse Figma URL to extract file key and node ID.
 * Used by ProjectWizard for URL input.
 */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  const fileRegex = /figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/;
  const nodeRegex = /node-id=([^&]+)/;

  const fileMatch = url.match(fileRegex);
  if (!fileMatch) return null;

  const fileKey = fileMatch[1];
  const nodeMatch = url.match(nodeRegex);
  const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]) : undefined;

  return { fileKey, nodeId };
}

/**
 * FigmaMCPAdapter
 * 
 * Implements FigmaPort using MCPTransport for MCP tools.
 * All-or-Nothing: MCP is required for design pipeline.
 */

import type { FigmaPort } from '../../../core/ports/figma';
import type { MCPToolResult } from '@ant/shared';
import type { MCPTransport } from './MCPTransport';

export class FigmaMCPAdapter implements FigmaPort {
  private transport: MCPTransport;

  constructor(transport: MCPTransport) {
    this.transport = transport;
  }

  async getDesignContext(fileKey: string, nodeId: string): Promise<MCPToolResult> {
    return this.transport.callTool('get_design_context', { fileKey, nodeId });
  }

  async getMetadata(fileKey: string, nodeId: string): Promise<MCPToolResult> {
    return this.transport.callTool('get_metadata', { fileKey, nodeId });
  }

  async getScreenshot(fileKey: string, nodeId: string): Promise<MCPToolResult> {
    return this.transport.callTool('get_screenshot', { fileKey, nodeId });
  }

  async getVariableDefs(fileKey: string, nodeId: string): Promise<MCPToolResult> {
    return this.transport.callTool('get_variable_defs', { fileKey, nodeId });
  }

  async checkMCPAvailability(): Promise<boolean> {
    return this.transport.isAvailable();
  }
}

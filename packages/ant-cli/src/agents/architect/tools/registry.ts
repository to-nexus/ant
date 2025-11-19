/**
 * Tool Registry
 * 
 * Central registry for all tools available to the LLM
 */

import { ToolDefinition } from '../../../core/ports/llm';

export type ToolExecutor = (
  input: Record<string, any>,
  context: any
) => Promise<string | Record<string, any>>;

export interface Tool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool
   */
  register(name: string, tool: Tool): void {
    if (this.tools.has(name)) {
      console.warn(`⚠️  Tool "${name}" is already registered, overwriting...`);
    }
    this.tools.set(name, tool);
    console.log(`🔧 Registered tool: ${name}`);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tool definitions for LLM
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Execute a tool
   */
  async execute(
    name: string,
    input: Record<string, any>,
    context: any
  ): Promise<string | Record<string, any>> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    try {
      return await tool.executor(input, context);
    } catch (error: any) {
      console.error(`❌ Tool execution failed: ${name}`, error);
      return {
        error: true,
        message: `Tool execution failed: ${error.message}`,
        tool: name,
      };
    }
  }

  /**
   * Get count of registered tools
   */
  count(): number {
    return this.tools.size;
  }

  /**
   * List all tool names
   */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}


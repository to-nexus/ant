/**
 * ToolRegistry — ToolName→handler mapping with composability
 *
 * Populated from ToolCatalog by preset factories.
 * All tool names MUST be ToolName enum values — no arbitrary strings.
 */

import type { ToolHandler } from './types';
import type { ToolName } from './toolCatalog';

export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(name: ToolName, handler: ToolHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  wrap(name: ToolName, wrapper: (original: ToolHandler) => ToolHandler): this {
    const original = this.handlers.get(name);
    if (!original) {
      throw new Error(`Cannot wrap unregistered tool: ${name}`);
    }
    this.handlers.set(name, wrapper(original));
    return this;
  }

  names(): string[] {
    return Array.from(this.handlers.keys());
  }

  merge(other: ToolRegistry): this {
    for (const name of other.names()) {
      const handler = other.get(name);
      if (handler) this.handlers.set(name, handler);
    }
    return this;
  }
}

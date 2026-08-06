/**
 * Core streaming system for real-time LLM response processing
 *
 * @example
 * ```typescript
 * // In any agent node:
 * import { StreamOrchestrator, XMLStreamParser, CommonRenderStrategy } from '@core/streaming';
 *
 * const orchestrator = new StreamOrchestrator({
 *   parser: new XMLStreamParser(),
 *   renderStrategy: new CommonRenderStrategy(chatAPI),
 * });
 *
 * // Process LLM stream
 * for await (const event of llmStream) {
 *   await orchestrator.processEvent(event);
 * }
 *
 * const result = await orchestrator.finalize();
 * console.log('Raw response:', result.raw);
 * ```
 *
 * File authoring is tool-call-only (`create_file` / `append_file` /
 * `edit_file`) — see `ToolFileStreamer` for the live rendering surface.
 */

// Main orchestrator
export { StreamOrchestrator } from './StreamOrchestrator';
export type { StreamOrchestratorConfig } from './StreamOrchestrator';

// Parsers
export { XMLStreamParser } from './parsers/XMLStreamParser';
export type { IStreamParser } from './parsers/IStreamParser';

// Render strategies
export { CommonRenderStrategy } from './strategies/CommonRenderStrategy';
export type { IRenderStrategy } from './strategies/IRenderStrategy';

// State management
export { StreamState } from './state/StreamState';

// Types
// NOTE: LLMStreamEvent is now exported from core/ports/llm.ts (unified)
export type {
  ParsedAction,
  ParsedActionType,
  StreamResult
} from './types';


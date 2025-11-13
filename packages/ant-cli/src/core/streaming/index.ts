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
 *   existingFiles: new Set(['src/App.tsx', 'package.json'])
 * });
 * 
 * // Process LLM stream
 * for await (const event of llmStream) {
 *   await orchestrator.processEvent(event);
 * }
 * 
 * const result = await orchestrator.finalize();
 * console.log('Streamed files:', result.streamedFiles);
 * ```
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
export { FileRegistry } from './state/FileRegistry';

// Types
export type {
  LLMStreamEvent,
  ParsedAction,
  ParsedActionType,
  StreamResult,
  FileStreamInfo
} from './types';


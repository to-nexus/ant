/**
 * Core Chat Module
 *
 * Shared components for chat broadcasting + session-key derivation.
 * Used by both `LLMResponseService` (job worker) and `ChatService`
 * (api server). The pre-§5 `ChatSession` / `ChatMessage` types and
 * the ContentMerger have been removed in Phase 9.
 */

export * from './schema';
export { MessageBroadcaster } from './MessageBroadcaster';
export type { ChatBroadcastEnvelope } from './MessageBroadcaster';

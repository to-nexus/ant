/**
 * Chat Schema - Redis key patterns and session data converters
 * 
 * Defines the Redis key structure and data format for chat sessions
 */

import type { ChatSession, ChatMessage, FileOperationTracker } from './types';
import type { ChatSessionData, ChatMessageData } from '../ports/stateStore';
import type { UserContext } from '../types/user';

/**
 * Redis key prefix for chat data
 */
export const REDIS_KEY_PREFIX = 'ant:chat';

/**
 * Get Redis session key for a project/feature
 * Format: "org:user:projectId/featureName"
 */
export function getSessionKey(projectId: string, featureName: string, userContext?: UserContext): string {
  if (userContext?.organizationId && userContext?.userId) {
    return `${userContext.organizationId}:${userContext.userId}:${projectId}/${featureName}`;
  }
  return `local:local:${projectId}/${featureName}`;
}

/**
 * Get simple key for local cache (without user context)
 * Format: "projectId/featureName"
 */
export function getSimpleKey(projectId: string, featureName: string): string {
  return `${projectId}/${featureName}`;
}

/**
 * Convert internal ChatSession to Redis ChatSessionData
 */
export function toRedisSession(session: ChatSession): ChatSessionData {
  return {
    projectId: session.projectId,
    featureName: session.featureName,
    jobId: session.jobId,
    messages: session.messages.map(m => ({
      id: m.id,
      role: m.role,
      contents: m.contents,
      timestamp: m.timestamp,
      jobId: m.jobId,
      isStreaming: m.isStreaming
    })),
    userContext: session.userContext,
    thinkingStartTime: session.thinkingStartTime,
    lastThinkingContentIndex: session.lastThinkingContentIndex,
    activeFileOperations: session.activeFileOperations 
      ? Array.from(session.activeFileOperations.values())
      : undefined
  };
}

/**
 * Convert Redis ChatSessionData to internal ChatSession
 */
export function fromRedisSession(data: ChatSessionData): ChatSession {
  const session: ChatSession = {
    projectId: data.projectId,
    featureName: data.featureName,
    jobId: data.jobId,
    messages: data.messages as ChatMessage[],
    userContext: data.userContext,
    thinkingStartTime: data.thinkingStartTime,
    lastThinkingContentIndex: data.lastThinkingContentIndex
  };
  
  if (data.activeFileOperations) {
    session.activeFileOperations = new Map(
      data.activeFileOperations.map((op: FileOperationTracker) => [op.filePath, op])
    );
  }
  
  return session;
}

/**
 * Convert internal ChatMessage to Redis ChatMessageData
 */
export function toRedisMessage(message: ChatMessage): ChatMessageData {
  return {
    id: message.id,
    role: message.role,
    contents: message.contents,
    timestamp: message.timestamp,
    jobId: message.jobId,
    isStreaming: message.isStreaming
  };
}

/**
 * Convert Redis ChatMessageData to internal ChatMessage
 */
export function fromRedisMessage(data: ChatMessageData): ChatMessage {
  return data as ChatMessage;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new assistant message
 */
export function createAssistantMessage(jobId: string): ChatMessage {
  return {
    id: generateMessageId(),
    role: 'assistant',
    contents: [],
    timestamp: new Date().toISOString(),
    jobId,
    isStreaming: true
  };
}

/**
 * Create a new user message
 */
export function createUserMessage(content: string, jobId?: string): ChatMessage {
  return {
    id: generateMessageId(),
    role: 'user',
    contents: [{ type: 'text', content }],
    timestamp: new Date().toISOString(),
    jobId
  };
}

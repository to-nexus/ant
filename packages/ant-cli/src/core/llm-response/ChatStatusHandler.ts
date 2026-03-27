/**
 * ChatStatusHandler - Handles chat status messages in job workers
 * 
 * Generates and broadcasts status messages for various operations
 * (exploring, retrieving, reading, thinking, etc.)
 */

import type { SessionStore } from './SessionStore';
import type { MessageBroadcaster } from '../chat/MessageBroadcaster';
import type { ContentMerger } from '../chat/ContentMerger';
import type { MessageContent } from '../chat/types';
import type { ChatStatusType } from './types';
import { logger } from '../../utils/logger';

function formatFigmaTarget(nodeId?: string, nodeName?: string): string | null {
  if (!nodeId) return null;
  if (nodeId === '0:1' || nodeId === '0-1') return null;
  if (nodeName) return nodeName.length > 200 ? nodeName.slice(0, 197) + '...' : nodeName;
  return `node: ${nodeId}`;
}

export class ChatStatusHandler {
  constructor(
    private sessionStore: SessionStore,
    private contentMerger: ContentMerger,
    private broadcaster: MessageBroadcaster
  ) {}

  /**
   * Show chat status message
   * 
   * Rules:
   * - Content text is auto-generated based on type
   * - Auto-merge or disappear based on next content type (handled by ContentMerger)
   * 
   * Returns the content index
   */
  showChatStatus(type: ChatStatusType, metadata?: Record<string, any>): number {
    const session = this.sessionStore.getSession();
    const ctx = this.sessionStore.getContext();

    if (!session || !session.currentMessage) {
      logger.warn(`No active message for chat status`, { 
        component: 'ChatStatusHandler',
        projectId: ctx.projectId,
        featureName: ctx.featureName
      });
      return -1;
    }

    // Auto-generate content text based on type
    const content = this.generateStatusContent(type, metadata);

    const messageContent: MessageContent = {
      type,
      content,
      metadata: {
        provider: 'system',
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    // Use ContentMerger for intelligent merging
    const contentIndex = this.contentMerger.addContent(
      ctx.projectId,
      ctx.featureName,
      session,
      messageContent
    );

    // Update Redis asynchronously
    this.sessionStore.updateCurrentMessage().catch(err => {
      logger.warn(`Failed to update current message in Redis`, { 
        component: 'ChatStatusHandler' 
      }, err);
    });

    return contentIndex;
  }

  /**
   * Remove a chat status UI element by its content index
   * Used when a progress indicator (e.g. retrieving) finishes with 0 results
   */
  removeChatStatus(contentIndex: number, expectedType?: string): void {
    const session = this.sessionStore.getSession();
    const ctx = this.sessionStore.getContext();

    if (!session || !session.currentMessage) return;

    this.contentMerger.removeContent(
      ctx.projectId,
      ctx.featureName,
      session,
      contentIndex,
      expectedType
    );

    this.sessionStore.updateCurrentMessage().catch(err => {
      logger.warn(`Failed to update current message in Redis after remove`, {
        component: 'ChatStatusHandler'
      }, err);
    });
  }

  /**
   * Helper: Add exploring status
   */
  addExploringStatus(current: number, total: number): number {
    return this.showChatStatus('exploring', { filesCount: current, totalFiles: total });
  }

  /**
   * Helper: Add explored result
   */
  addExploredResult(filesCount: number, filesList?: string[]): number {
    return this.showChatStatus('explored', { filesCount, filesList });
  }

  /**
   * Helper: Add reading file status
   */
  addReadingFile(filePath: string): number {
    return this.showChatStatus('reading', { filePath });
  }

  /**
   * Helper: Add read complete
   */
  addReadComplete(filePath: string, error?: string): number {
    return this.showChatStatus('read', { filePath, error });
  }

  /**
   * Generate status content text based on type
   */
  private generateStatusContent(type: ChatStatusType, metadata?: Record<string, any>): string {
    switch (type) {
      case 'placeholder':
        return 'Planning next moves...';
        
      case 'exploring': {
        const filesCount = metadata?.filesCount ?? 0;
        const totalFiles = metadata?.totalFiles ?? 0;
        return filesCount > 0 
          ? `Exploring: ${filesCount}/${totalFiles} files`
          : 'Exploring: codebase...';
      }
      
      case 'explored': {
        const filesCount = metadata?.filesCount ?? 0;
        const error = metadata?.error;
        const content = metadata?.content;
        if (error) return `❌ Explore Failed: ${error}`;
        if (content) return content;
        return `Explored: ${filesCount} files with uncommitted changes`;
      }
      
      case 'retrieving': {
        const query = metadata?.query ?? '';
        return query 
          ? `Retrieving from Vector DB: '${query}'...`
          : 'Retrieving from Vector DB...';
      }
      
      case 'retrieved': {
        const filesCount = metadata?.filesCount ?? 0;
        const error = metadata?.error;
        const content = metadata?.content;
        if (error) return `❌ Retrieval Failed: ${error}`;
        if (content) return content;
        return `Retrieved: ${filesCount} files from Vector DB`;
      }
      
      case 'grepping': {
        const keywords = metadata?.keywords ?? [];
        const query = metadata?.query ?? '';
        if (keywords.length > 0) {
          return `Searching local files: ${keywords.slice(0, 3).join(', ')}${keywords.length > 3 ? '...' : ''}`;
        }
        if (query) return `Searching local files: '${query}'`;
        return 'Searching local files...';
      }
      
      case 'grepped': {
        const filesCount = metadata?.filesCount ?? 0;
        const error = metadata?.error;
        if (error) return `❌ Local Search Failed: ${error}`;
        return `Grepped: ${filesCount} files`;
      }
      
      case 'listing_files': {
        const directory = metadata?.directory ?? '.';
        const pattern = metadata?.pattern;
        return pattern 
          ? `📂 Listing files in ${directory} (${pattern})...`
          : `📂 Listing files in ${directory}...`;
      }
      
      case 'listed_files': {
        const filesCount = metadata?.filesCount ?? 0;
        const totalFiles = metadata?.totalFiles;
        const pattern = metadata?.pattern;
        const error = metadata?.error;
        if (error) return `❌ File Listing Failed: ${error}`;
        if (pattern) return `Listed: ${filesCount}/${totalFiles} files (${pattern})`;
        return `Listed: ${filesCount}/${totalFiles} files`;
      }
      
      case 'searching_code': {
        const pattern = metadata?.pattern ?? '';
        const filePattern = metadata?.file_pattern;
        return filePattern
          ? `🔍 Searching code: "${pattern}" in ${filePattern}...`
          : `🔍 Searching code: "${pattern}"...`;
      }
      
      case 'searched_code': {
        const filesCount = metadata?.filesCount ?? 0;
        const totalMatches = metadata?.totalMatches ?? 0;
        const error = metadata?.error;
        if (error) return `❌ Code Search Failed: ${error}`;
        if (totalMatches > 0) return `Found: ${totalMatches} matches in ${filesCount} files`;
        return `Found: ${filesCount} files`;
      }
      
      case 'reading': {
        const filePath = metadata?.filePath ?? '';
        return filePath ? `Reading: ${filePath}...` : 'Reading: file...';
      }
      
      case 'read': {
        const filePath = metadata?.filePath ?? '';
        const error = metadata?.error;
        if (error) return `❌ Read Failed: ${filePath || error}`;
        return filePath ? `Read: ${filePath}` : 'Read: file';
      }

      case 'reading_source': {
        const fn = metadata?.filePath ?? '';
        const range = metadata?.startLine ? ` (L${metadata.startLine}-L${metadata.endLine || '?'})` : '';
        return fn ? `Reading source: ${fn}${range}...` : 'Reading source doc...';
      }

      case 'read_source': {
        const fn = metadata?.filePath ?? '';
        const error = metadata?.error;
        if (error) return `❌ Read Source Failed: ${fn || error}`;
        const range = metadata?.startLine
          ? ` (L${metadata.startLine}-L${metadata.endLine || '?'} of ${metadata.totalLines || '?'})`
          : metadata?.totalLines ? ` (${metadata.totalLines} lines)` : '';
        return fn ? `Read source: ${fn}${range}` : 'Read source doc';
      }
      
      case 'thinking':
        return '';  // Empty content, will be filled by LLM tokens
        
      case 'indexing': {
        const message = metadata?.message ?? 'codebase...';
        return `Indexing: ${message}`;
      }
      
      case 'indexed': {
        const filesIndexed = metadata?.filesIndexed ?? 0;
        const chunks = metadata?.chunks ?? 0;
        const tokens = metadata?.tokens ?? 0;
        const duration = metadata?.duration ? `in ${(metadata.duration / 1000).toFixed(1)}s` : '';
        const error = metadata?.error;
        if (error) return `❌ Indexing Failed: ${error}`;
        return `✅ Indexed: ${filesIndexed} files → ${chunks} chunks (~${Math.round(tokens / 1000)}K tokens) ${duration}`.trim();
      }
      
      case 'analyzing': {
        const message = metadata?.message ?? 'files...';
        return `Analyzing: ${message}`;
      }
      
      case 'analyzed': {
        const content = metadata?.content;
        const keywordCount = metadata?.keywordCount ?? 0;
        const stackTraceCount = metadata?.stackTraceCount ?? 0;
        const semanticCount = metadata?.semanticCount ?? 0;
        const error = metadata?.error;
        if (error) return `❌ Analysis Failed: ${error}`;
        if (content) return content;
        if (keywordCount > 0) {
          return `🔑 Keywords Generated: ${stackTraceCount} stack trace + ${semanticCount} semantic`;
        }
        return `✅ Analyzed: ${metadata?.filesCount ?? 0} files`;
      }
      
      case 'storing': {
        const message = metadata?.message ?? 'lesson...';
        return `Storing: ${message}`;
      }
      
      case 'stored': {
        const message = metadata?.message;
        const error = metadata?.error;
        if (error) return `❌ Storage Failed: ${error}`;
        return `Stored: ${message ?? 'lesson successfully'}`;
      }
      
      case 'learning': {
        const taskName = metadata?.taskName ?? 'task';
        return `Learning lessons from: ${taskName}...`;
      }
      
      case 'learned': {
        const filesWritten = metadata?.filesWritten ?? 0;
        const branch = metadata?.branch ?? '';
        const content = metadata?.content;
        const error = metadata?.error;
        if (error) return `❌ Learning Failed: ${error}`;
        if (content) return content;
        return `Lessons learned: ${filesWritten} file(s) (${branch})`;
      }
      
      case 'searching_reference': {
        const project = metadata?.project ?? 'reference project';
        const query = metadata?.query ?? '';
        return query 
          ? `🔍 Searching ${project}: "${query}"...`
          : `🔍 Searching ${project}...`;
      }
      
      case 'searched_reference': {
        const project = metadata?.project ?? 'reference project';
        const filesCount = metadata?.filesCount ?? 0;
        const error = metadata?.error;
        if (error) return `❌ Search Failed (${project}): ${error}`;
        return `Found ${filesCount} file(s) in ${project}`;
      }
      
      case 'context_loaded': {
        const items = metadata?.items as Array<{ label: string; detail?: string }> | undefined;
        if (!items || items.length === 0) return 'Context loaded';
        return items.map(item => 
          item.detail ? `${item.label} (${item.detail})` : item.label
        ).join(', ');
      }
      
      case 'downloading': {
        const filename = metadata?.filename ?? 'asset';
        return `Downloading: ${filename}...`;
      }

      case 'downloaded': {
        const filename = metadata?.filename ?? 'asset';
        const error = metadata?.error;
        if (error) return `❌ Download Failed: ${filename}`;
        const sizeKB = metadata?.sizeKB;
        return sizeKB ? `Downloaded: ${filename} (${sizeKB} KB)` : `Downloaded: ${filename}`;
      }

      case 'figma_calling': {
        const toolName = metadata?.toolName ?? 'MCP tool';
        const label = toolName.replace(/^figma_/, '');
        const target = formatFigmaTarget(metadata?.nodeId, metadata?.nodeName);
        return target ? `Figma: ${label} (${target})...` : `Figma: ${label}...`;
      }

      case 'figma_called': {
        const toolName = metadata?.toolName ?? 'MCP tool';
        const label = toolName.replace(/^figma_/, '');
        const error = metadata?.error;
        const target = formatFigmaTarget(metadata?.nodeId, metadata?.nodeName);
        if (error) return target ? `❌ Figma Failed: ${label} (${target})` : `❌ Figma Failed: ${label}`;
        return target ? `Figma: ${label} (${target})` : `Figma: ${label}`;
      }

      case 'tool_action':
        return metadata?.content || 'Processing...';
      
      case 'triage_choice':
        // ✅ triage_choice uses message from metadata (the LLM's explanation)
        return metadata?.message || 'Processing...';
      
      case 'choice_card':
        // ✅ choice_card uses title from metadata (generic choice cards: eval_save, prd_apply)
        return metadata?.title || 'Choice required';
      
      case 'loading': {
        return 'Loading required files...';
      }
      
      case 'loaded': {
        const filesCount = metadata?.filesCount ?? 0;
        const content = metadata?.content;
        const error = metadata?.error;
        if (error) return `❌ Loading Failed: ${error}`;
        if (content) return content;
        return `Loaded: ${filesCount} required files`;
      }
      
      case 'file_create_failed':
      case 'file_edit_failed':
      case 'file_delete_failed': {
        const filePath = metadata?.filePath ?? 'file';
        const reason = metadata?.reason ?? 'Unknown error';
        return `❌ ${filePath}: ${reason}`;
      }
      
      case 'file_conflict': {
        const filePath = metadata?.filePath ?? 'file';
        const ownerTask = metadata?.ownerTask ?? 'another task';
        return `⚠️ File conflict: ${filePath} (owned by "${ownerTask}")`;
      }
      
      case 'file_conflict_retry': {
        const filePath = metadata?.filePath ?? 'file';
        const attempt = metadata?.attempt ?? 1;
        const maxRetries = metadata?.maxRetries ?? 3;
        return `🔄 Retrying file write: ${filePath} (attempt ${attempt}/${maxRetries})`;
      }
      
      case 'plan_generating':
        return metadata?.content ?? '';
      
      case 'plan':
        return metadata?.content ?? '';
      
      case 'task_response':
        return metadata?.content ?? '';
      
      default:
        return 'Processing...';
    }
  }
}

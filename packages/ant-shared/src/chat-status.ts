/**
 * generateChatStatusContent — SSOT for chat card body text.
 *
 * Single function both the backend emission path and the frontend rendering
 * path call to turn a `(ChatStatusType, metadata)` pair into a body string.
 *
 * Moved from `packages/ant-cli/src/core/llm-response/generateStatusContent.ts`
 * to `@ant/shared` so FE and BE share exactly one implementation — no drift
 * between live broadcast wording and replay/re-render wording is possible.
 */

import type { ChatStatusType } from './session-log';

const PROCESSING_LABELS: Record<string, { progress: string; complete: string }> = {
  bg_removal: { progress: 'Removing background', complete: 'Background removed' },
  upscale: { progress: 'Upscaling image', complete: 'Image upscaled' },
  optimize: { progress: 'Optimizing image', complete: 'Image optimized' },
};

function formatFigmaTarget(nodeId?: string, nodeName?: string): string | null {
  if (!nodeId) return null;
  if (nodeId === '0:1' || nodeId === '0-1') return null;
  if (nodeName) return nodeName.length > 200 ? nodeName.slice(0, 197) + '...' : nodeName;
  return `node: ${nodeId}`;
}

export function generateChatStatusContent(
  type: ChatStatusType,
  metadata?: Record<string, any>,
): string {
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
      return '';

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

    case 'processing': {
      const action = metadata?.action ?? 'processing';
      const label = PROCESSING_LABELS[action] ?? { progress: action, complete: action };
      const target = metadata?.target ?? '';
      return target ? `${label.progress}: ${target}...` : `${label.progress}...`;
    }

    case 'processed': {
      const action = metadata?.action ?? 'processing';
      const label = PROCESSING_LABELS[action] ?? { progress: action, complete: action };
      const target = metadata?.target ?? '';
      const error = metadata?.error;
      if (error) return `❌ ${label.complete} failed${target ? `: ${target}` : ''}`;
      const sizeKB = metadata?.sizeKB;
      const base = target ? `${label.complete}: ${target}` : label.complete;
      return sizeKB ? `${base} (${sizeKB} KB)` : base;
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
      return metadata?.message || 'Processing...';

    case 'choice_card':
      return metadata?.title || 'Choice required';

    case 'cancelled':
      return metadata?.message || 'Task cancelled';

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

    case 'file_creating':
    case 'file_writing':
    case 'file_editing':
    case 'file_updating':
    case 'file_deleting':
      return '';

    case 'file_create':
    case 'file_edit':
    case 'file_delete':
      return typeof metadata?.content === 'string' ? metadata.content : '';

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

    case 'command_running':
    case 'command_streaming':
    case 'command':
      return typeof metadata?.output === 'string' ? metadata.output : '';

    case 'plan_generating':
      return metadata?.content ?? '';

    case 'plan':
      return metadata?.content ?? '';

    case 'task_response':
      return metadata?.content ?? '';

    case 'text':
      return typeof metadata?.content === 'string' ? metadata.content : '';

    default:
      return 'Processing...';
  }
}

import { DesignGraphState } from '../../state';
import { ConversationEntry } from '../../../../../../core/types';
import { BOUNDARY } from '@ant/shared';

/**
 * Inter-Job Context Bridge: Build raw job completion record.
 * Always saves raw content without LLM summarization.
 * Compression is deferred to next job's resolve node.
 */
export function buildDesignJobRecord(state: DesignGraphState): { user: ConversationEntry; assistant: ConversationEntry } {
  const tasks = state.completedTasksDetails || [];
  const files = state.files || [];
  const taskNames = tasks.map((t: any) => t.name).join(', ');
  const timestamp = new Date().toISOString();
  const boundary = state.boundary || BOUNDARY.LIGHTWEIGHT;

  const user: ConversationEntry = {
    role: 'user',
    content: state.directive || state.overrideDirective || '',
    timestamp,
    metadata: { jobId: state.jobId || state._httpJobId, boundary },
  };

  const assistant: ConversationEntry = {
    role: 'assistant',
    content: [
      taskNames && `Tasks: ${taskNames}`,
      files.length > 0 && `Files: ${files.slice(0, 20).map(f => f.path).join(', ')}${files.length > 20 ? '...' : ''}`,
      state.planText && `Plan: ${state.planText.substring(0, 500)}`,
    ].filter(Boolean).join('\n'),
    timestamp,
    metadata: { jobId: state.jobId || state._httpJobId, boundary, taskCount: tasks.length, filesWritten: files.length },
  };

  return { user, assistant };
}

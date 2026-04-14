import { ArchitectGraphState } from '../../state';
import { ConversationEntry } from '../../../../../../core/types';
import { BOUNDARY } from '@ant/shared';

/**
 * Inter-Job Context Bridge: Build raw job completion record.
 * Always saves raw content without LLM summarization.
 * Compression is deferred to next job's resolve node.
 */
export function buildJobRecord(state: ArchitectGraphState): { user: ConversationEntry; assistant: ConversationEntry } {
  const tasks = state.completedTasksDetails || [];
  const filePaths = state.projectCodeContext?.filePaths || [];
  const taskNames = tasks.map((t: any) => t.name).join(', ');
  const timestamp = new Date().toISOString();
  const boundary = state.boundary || BOUNDARY.LIGHTWEIGHT;

  const user: ConversationEntry = {
    role: 'user',
    content: state.directive || state.overrideDirective || '',
    timestamp,
    metadata: { jobId: state.jobId, boundary },
  };

  const consumedDesignRefs = new Set<string>();
  for (const t of tasks) {
    if ((t as any).packages) {
      for (const pkg of (t as any).packages) {
        consumedDesignRefs.add(pkg);
      }
    }
  }

  const assistant: ConversationEntry = {
    role: 'assistant',
    content: [
      taskNames && `Tasks: ${taskNames}`,
      filePaths.length > 0 && `Files: ${filePaths.slice(0, 20).join(', ')}${filePaths.length > 20 ? '...' : ''}`,
      state.selectedSpec && `Based on: ${state.selectedSpec}`,
      consumedDesignRefs.size > 0 && `Design refs: ${[...consumedDesignRefs].join(', ')}`,
      state.planText && `Plan: ${state.planText.substring(0, 500)}`,
    ].filter(Boolean).join('\n'),
    timestamp,
    metadata: { jobId: state.jobId, boundary, taskCount: tasks.length, filesWritten: filePaths.length },
  };

  return { user, assistant };
}

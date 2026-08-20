import { useTranslation } from 'react-i18next';
import { Check, FileText, ListTodo } from 'lucide-react';
import { BoardContainer } from '../BoardContainer';
import { ElapsedTimeBadge, TokenUsageBadge, GaugesGroup } from '../kanban/KanbanHeader';
import { useStore } from '@/domain/store';
import { selectActivePipelineForSelectedProject } from '@/domain/store/selectors/pipelines';
import type { UniversalChecklistItem } from '@ant/shared';
import { KanbanData } from '@/infrastructure/http/api';
import { Spinner } from '@/presentation/components/common/async';
import { PipelineOriginChip } from '../Pipelines/PipelineOriginChip';

interface ChecklistBoardProps {
  kanbanData: KanbanData;
}

/**
 * ChecklistBoard — the workspace (universal) project's board surface,
 * replacing the kanban board (universal jobs have no tasks; checklist items
 * are NOT tasks and must never be cast into BaseTask cards).
 *
 * Renders `kanbanData.checklist` as a single ordered list (FIFO — declared
 * order preserved, at most one active item), with the same header chrome
 * (elapsed / tokens / recursion gauge) the other boards share.
 */
export function ChecklistBoard({ kanbanData }: ChecklistBoardProps) {
  const { t } = useTranslation('nav');
  const systemRecursionLimit = useStore((state) => state.recursionLimit);
  // The work tab marks pipeline-driven work: while the project's active
  // pipeline is running, the current job IS a pipeline step.
  const activePipeline = useStore((state) => selectActivePipelineForSelectedProject(state));
  const pipelineRunning = activePipeline && (activePipeline.state === 'running' || activePipeline.state === 'awaiting_human');
  const checklist = kanbanData.checklist;
  const items = checklist?.items ?? [];
  const doneCount = items.filter((i) => i.state === 'done').length;

  return (
    <BoardContainer
      className="checklist-board"
      titleActions={
        <>
          {pipelineRunning && <PipelineOriginChip pipelineId={activePipeline!.pipelineId} />}
          <ElapsedTimeBadge jobTiming={kanbanData.jobTiming} completedTasks={[]} inProgressTasks={[]} />
          <TokenUsageBadge
            jobId={kanbanData.jobId}
            tokenUsage={kanbanData.tokenUsage}
            tokenUsageByModel={kanbanData.tokenUsageByModel}
            estimatingTokenUsage={kanbanData.estimatingTokenUsage}
            phaseTokenUsages={kanbanData.phaseTokenUsages}
            completedTasks={[]}
            inProgressTasks={[]}
          />
        </>
      }
      headerActions={
        <GaugesGroup
          recursionCount={kanbanData.recursionCount}
          recursionLimit={kanbanData.recursionLimit || systemRecursionLimit}
          recursionTaskName={kanbanData.recursionTaskName}
        />
      }
    >
      <div className="max-w-2xl mx-auto px-6 py-8">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--text-3)' }}>
            <ListTodo className="w-8 h-8" style={{ color: 'var(--text-4)' }} />
            <span className="text-sm">
              {t('checklistBoard.empty', 'No checklist for this turn — the agent creates one for multi-deliverable work.')}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                {t('checklistBoard.progress', '{{done}} of {{total}} done', { done: doneCount, total: items.length })}
              </span>
              {checklist?.sourcePlanPath && (
                <span
                  className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--bg-raised)', color: 'var(--text-2)', border: '1px solid var(--border-1)' }}
                  title={checklist.sourcePlanPath}
                >
                  <FileText className="w-3 h-3" />
                  {t('checklistBoard.fromPlan', 'From plan')}: <code className="font-mono">{checklist.sourcePlanPath}</code>
                </span>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <ChecklistItemRow key={item.id} item={item} />
              ))}
            </div>
          </>
        )}
      </div>
    </BoardContainer>
  );
}

/** Single checklist row — pending ring / active spinner / done check (QuickStart StepRow vocabulary). */
function ChecklistItemRow({ item }: { item: UniversalChecklistItem }) {
  const status = item.state;
  return (
    <div
      className={`flex items-center gap-3 transition-all duration-300 ${
        status === 'pending' ? 'opacity-40' : status === 'done' ? 'opacity-70' : 'opacity-100'
      }`}
    >
      <div className="shrink-0 w-5 h-5 flex items-center justify-center">
        {status === 'done' ? (
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'var(--status-done-bg, oklch(70% 0.16 160))', color: 'var(--text-on-brand)' }}
          >
            <Check className="w-3 h-3" strokeWidth={3} style={{ color: 'var(--text-on-brand)' }} />
          </div>
        ) : status === 'active' ? (
          <Spinner size="lg" style={{ color: 'var(--violet-500)' }} />
        ) : (
          <div className="w-5 h-5 rounded-full" style={{ border: '2px solid var(--border-2)' }} />
        )}
      </div>
      <span
        className={`text-sm transition-colors duration-300 ${status === 'active' ? 'font-medium' : ''} ${status === 'done' ? 'line-through' : ''}`}
        style={{
          color: status === 'active' ? 'var(--violet-600)' : status === 'done' ? 'var(--text-2)' : 'var(--text-3)',
        }}
      >
        {item.text}
      </span>
    </div>
  );
}

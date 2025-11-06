import { Button } from '@/ui/button';

interface KanbanPausedPromptProps {
  tasksRemaining: number;
  onResume: () => Promise<void>;
}

/**
 * KanbanPausedPrompt - Resume prompt when task is paused due to recursion limit
 */
export function KanbanPausedPrompt({ tasksRemaining, onResume }: KanbanPausedPromptProps) {
  return (
    <div className="mb-4 p-6 bg-orange-50 dark:bg-orange-950 border-2 border-orange-300 dark:border-orange-700 rounded-lg">
      <div className="flex items-start gap-4">
        <div className="text-3xl">⏸️</div>
        <div className="flex-1">
          <div className="font-semibold text-lg text-orange-900 dark:text-orange-200 mb-2">
            Task paused due to recursion limit
          </div>
          <div className="text-sm text-orange-800 dark:text-orange-300 mb-4">
            {tasksRemaining} task{tasksRemaining !== 1 ? 's' : ''} remaining. 
            The agent will continue from where it left off.
          </div>
          <Button
            onClick={onResume}
            className="bg-orange-600 hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-800 text-white"
          >
            ▶️ Resume Task
          </Button>
        </div>
      </div>
    </div>
  );
}


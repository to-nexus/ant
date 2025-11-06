/**
 * KanbanEstimating - Estimating state display
 * Shown when agent is breaking down tasks
 */
export function KanbanEstimating() {
  return (
    <div className="p-8 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-700 rounded-lg">
      <div className="flex flex-col items-center justify-center gap-4 text-blue-900 dark:text-blue-200">
        <div className="text-4xl animate-spin">⏳</div>
        <div className="text-center">
          <div className="font-semibold text-lg mb-1">Breaking down tasks...</div>
          <div className="text-sm text-blue-700 dark:text-blue-300">
            Analyzing requirements and creating task queue
          </div>
        </div>
      </div>
    </div>
  );
}


import { Timer } from 'lucide-react';
import { Button } from '@/presentation/components/common/button';
import type { InterruptionDetails } from '@/domain/models/session';
import { KanbanStatusBanner, type BannerVariant } from './KanbanStatusBanner';
import type { ReactNode } from 'react';

interface KanbanPausedPromptProps {
  interruption: InterruptionDetails;
  onResume: () => Promise<void>;
  onDismiss: () => void;
}

/**
 * Get display info for each interruption reason
 */
function getInterruptionDisplay(interruption: InterruptionDetails): {
  variant: BannerVariant;
  icon: ReactNode;
  title: string;
} {
  // ✅ 모든 케이스에 공통 Timer 아이콘 사용
  const timerIcon = <Timer className="w-6 h-6" />;
  
  switch (interruption.reason) {
    case 'recursion_limit':
      return {
        variant: 'warning',
        icon: timerIcon,
        title: 'Task paused: Recursion limit reached'
      };
    case 'user_stopped':
      return {
        variant: 'info',
        icon: timerIcon,
        title: 'Task paused by user'
      };
    case 'api_error':
      return {
        variant: 'error',
        icon: timerIcon,
        title: 'Task paused: API error'
      };
    case 'process_crash':
      return {
        variant: 'error',
        icon: timerIcon,
        title: 'Task paused: Process crashed'
      };
    case 'timeout':
      return {
        variant: 'warning',
        icon: timerIcon,
        title: 'Task paused: Timeout'
      };
    default:
      return {
        variant: 'info',
        icon: timerIcon,
        title: 'Task paused'
      };
  }
}

/**
 * KanbanPausedPrompt - Resume prompt for interrupted tasks
 * Uses KanbanStatusBanner with interruption-specific styling
 */
export function KanbanPausedPrompt({ interruption, onResume, onDismiss }: KanbanPausedPromptProps) {
  const display = getInterruptionDisplay(interruption);
  const tasksRemaining = interruption.metadata?.tasksRemaining as number | undefined;
  
  // Build detailed message
  let detailedMessage = interruption.message;
  if (tasksRemaining !== undefined && tasksRemaining > 0) {
    detailedMessage += `\n\n${tasksRemaining} task${tasksRemaining !== 1 ? 's' : ''} remaining. The agent will continue from where it left off.`;
  }
  
  return (
    <KanbanStatusBanner
      variant={display.variant}
      icon={display.icon}
      title={display.title}
      message={detailedMessage}
    >
      <div className="flex items-center gap-3">
        {interruption.canResume && (
          <Button
            onClick={onResume}
            className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-lg hover:shadow-xl transition-all duration-200 font-semibold"
          >
            ▶️ Resume Task
          </Button>
        )}
        <Button
          onClick={onDismiss}
          variant="outline"
          className="border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors duration-200"
        >
          ✕ Dismiss
        </Button>
      </div>
    </KanbanStatusBanner>
  );
}


import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { BaseFooter } from './BaseFooter';

/**
 * InfoFooter - Displays task information and elapsed time
 */
export function InfoFooter() {
  const isRunning = useStore((state) => state.isRunning);
  const taskStartTime = useStore((state) => state.taskStartTime);
  const elapsedTime = useStore((state) => state.elapsedTime);
  const currentMode = useStore((state) => state.currentMode);

  useEffect(() => {
    if (!isRunning || !taskStartTime) {
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - taskStartTime) / 1000);
      useStore.setState({ elapsedTime: elapsed });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, taskStartTime]);

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const getModeConfig = (mode: 'generate' | 'refactor' | 'explain') => {
    switch (mode) {
      case 'generate':
        return { label: 'Generate', color: 'bg-green-100 text-green-700 border-green-300' };
      case 'refactor':
        return { label: 'Refactor', color: 'bg-blue-100 text-blue-700 border-blue-300' };
      case 'explain':
        return { label: 'Explain', color: 'bg-purple-100 text-purple-700 border-purple-300' };
      default:
        return { label: mode, color: 'bg-gray-100 text-gray-700 border-gray-300' };
    }
  };

  return (
    <BaseFooter zIndex={50}>
      <div className="px-4 py-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            {/* Mode Chip */}
            {currentMode && (
              <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${getModeConfig(currentMode).color}`}>
                {getModeConfig(currentMode).label}
              </div>
            )}
            
            {/* Elapsed Time */}
            {isRunning && (
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Elapsed Time:</span>
                <span className="font-mono font-semibold text-blue-600">
                  {formatTime(elapsedTime)}
                </span>
              </div>
            )}
            {!isRunning && elapsedTime > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Last Task Duration:</span>
                <span className="font-mono font-semibold text-gray-800">
                  {formatTime(elapsedTime)}
                </span>
              </div>
            )}
            {!isRunning && elapsedTime === 0 && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">No active task</span>
              </div>
            )}
          </div>
          <div className="text-gray-400 text-xs">
            {/* Reserved for future status indicators */}
          </div>
        </div>
      </div>
    </BaseFooter>
  );
}

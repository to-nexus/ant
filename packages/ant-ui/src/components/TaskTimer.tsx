import { useEffect, useState } from 'react';

interface TaskTimerProps {
  timing?: {
    startedAt?: string;
    completedAt?: string;
    pausedAt?: string;
    resumedAt?: string;
    totalPausedDuration: number;
    elapsedTime?: number;
  };
  isRunning?: boolean;
  className?: string;
}

/**
 * Format milliseconds to human-readable time
 */
function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Calculate current elapsed time for a running task
 */
function calculateCurrentElapsedTime(timing: NonNullable<TaskTimerProps['timing']>): number {
  if (!timing.startedAt) return 0;
  
  const startTime = new Date(timing.startedAt).getTime();
  const currentTime = Date.now();
  const totalDuration = currentTime - startTime;
  
  // Subtract paused duration
  return Math.max(0, totalDuration - timing.totalPausedDuration);
}

export function TaskTimer({ timing, isRunning = false, className = '' }: TaskTimerProps) {
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  
  useEffect(() => {
    // ✅ No timing info - wait for data
    if (!timing) {
      setElapsedTime(null);
      return;
    }
    
    // If task is completed, use the stored elapsed time
    if (timing.completedAt && timing.elapsedTime !== undefined) {
      setElapsedTime(timing.elapsedTime);
      return;
    }
    
    // If task is running and has startedAt, calculate and update elapsed time
    if (isRunning && timing.startedAt) {
      const updateElapsedTime = () => {
        const currentElapsed = calculateCurrentElapsedTime(timing);
        setElapsedTime(currentElapsed);
      };
      
      // Initial calculation
      updateElapsedTime();
      
      // Update every second
      const intervalId = setInterval(updateElapsedTime, 1000);
      
      return () => clearInterval(intervalId);
    }
    
    // Task is paused
    if (timing.pausedAt && timing.startedAt) {
      const pausedTime = new Date(timing.pausedAt).getTime();
      const startTime = new Date(timing.startedAt).getTime();
      const elapsedBeforePause = pausedTime - startTime - timing.totalPausedDuration;
      setElapsedTime(Math.max(0, elapsedBeforePause));
      return;
    }
    
    // Task has timing but not started yet - show 0
    if (timing) {
      setElapsedTime(0);
    }
  }, [timing, isRunning]);
  
  // ✅ Only hide if truly no data
  if (elapsedTime === null) {
    return null;
  }
  
  return (
    <span className={className}>
      {formatElapsedTime(elapsedTime)}
    </span>
  );
}

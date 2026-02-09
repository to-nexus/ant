import { useEffect, useState } from 'react';
import { Loader2, Timer } from 'lucide-react';

interface NodeActivityBannerProps {
  label: string;
  startedAt: string;  // ISO timestamp
}

/**
 * NodeActivityBanner - Compact banner showing current non-task node activity.
 * Displays label + real-time timer. Auto-mounted when estimatingLabel is set,
 * auto-removed when tasks begin (estimatingLabel is cleared by backend).
 */
export function NodeActivityBanner({ label, startedAt }: NodeActivityBannerProps) {
  const [elapsed, setElapsed] = useState('0s');

  useEffect(() => {
    const start = new Date(startedAt).getTime();

    const update = () => {
      const diff = Math.floor((Date.now() - start) / 1000);
      if (diff < 60) {
        setElapsed(`${diff}s`);
      } else {
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        setElapsed(`${m}m ${s}s`);
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <div className="mb-3 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800">
      <Loader2 className="w-4 h-4 text-purple-500 dark:text-purple-400 animate-spin flex-shrink-0" />
      <span className="text-sm font-medium text-purple-800 dark:text-purple-200 truncate">
        {label}
      </span>
      <span className="ml-auto flex items-center gap-1 text-xs font-mono text-purple-600 dark:text-purple-400 whitespace-nowrap">
        <Timer className="w-3 h-3" />
        {elapsed}
      </span>
    </div>
  );
}

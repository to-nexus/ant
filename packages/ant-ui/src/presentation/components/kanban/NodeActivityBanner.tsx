import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';

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
    <div
      className="mb-3 flex items-center gap-2.5 px-3 py-2 rounded-lg"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
      }}
    >
      <Spinner
        size="md"
        tone="inherit"
        className="flex-shrink-0"
        style={{ color: 'var(--violet-500)' }}
      />
      <span
        className="text-sm font-medium truncate"
        style={{ color: 'var(--text-1)' }}
      >
        {label}
      </span>
      <span
        className="ml-auto flex items-center gap-1 text-xs font-mono whitespace-nowrap"
        style={{ color: 'var(--violet-500)' }}
      >
        <Timer className="w-3 h-3" />
        {elapsed}
      </span>
    </div>
  );
}

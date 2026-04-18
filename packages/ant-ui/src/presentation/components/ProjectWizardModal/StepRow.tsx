import { Check, X } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { cn } from '@/shared/utils/design-system';
import type { ExecStepStatus } from './types';

export function StepRow({ label, status, error }: { label: string; status: ExecStepStatus; error?: string }) {
  return (
    <div className={cn(
      'flex items-center gap-3 transition-all duration-300',
      status === 'pending' && 'opacity-40',
      status === 'done' && 'opacity-70',
    )}>
      <div className="shrink-0 w-5 h-5 flex items-center justify-center">
        {status === 'done' ? (
          <div className="w-5 h-5 rounded-full bg-emerald-500 dark:bg-emerald-400 flex items-center justify-center">
            <Check className="w-3 h-3 text-white dark:text-gray-900" strokeWidth={3} />
          </div>
        ) : status === 'active' ? (
          <Spinner size="lg" className="text-emerald-500 dark:text-emerald-400" />
        ) : status === 'error' ? (
          <div className="w-5 h-5 rounded-full bg-red-500 dark:bg-red-400 flex items-center justify-center">
            <X className="w-3 h-3 text-white dark:text-gray-900" strokeWidth={3} />
          </div>
        ) : (
          <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className={cn(
          'text-sm transition-colors duration-300',
          status === 'active' && 'text-emerald-600 dark:text-emerald-400 font-medium',
          status === 'done' && 'text-gray-500 dark:text-gray-400',
          status === 'error' && 'text-red-600 dark:text-red-400 font-medium',
          status === 'pending' && 'text-gray-400 dark:text-gray-500',
        )}>
          {label}
        </span>
        {error && <div className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</div>}
      </div>
    </div>
  );
}

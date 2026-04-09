import { type ActionId } from '@ant/shared';
import type { ActionReadiness } from '@ant/shared';
import { FileText, Server, Palette, LayoutList, Code2, ImageIcon, BookOpen } from 'lucide-react';

const ACTION_VISUALS: Record<ActionId, { icon: any; bg: string; text: string }> = {
  plan: { icon: FileText, bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-600 dark:text-blue-400' },
  'system-design': { icon: Server, bg: 'bg-purple-100 dark:bg-purple-900/50', text: 'text-purple-600 dark:text-purple-400' },
  'ui-design': { icon: Palette, bg: 'bg-pink-100 dark:bg-pink-900/50', text: 'text-pink-600 dark:text-pink-400' },
  spec: { icon: LayoutList, bg: 'bg-rose-100 dark:bg-rose-900/50', text: 'text-rose-600 dark:text-rose-400' },
  code: { icon: Code2, bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-600 dark:text-emerald-400' },
  visual: { icon: ImageIcon, bg: 'bg-violet-100 dark:bg-violet-900/50', text: 'text-violet-600 dark:text-violet-400' },
  learn: { icon: BookOpen, bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-600 dark:text-amber-400' },
};

export { ACTION_VISUALS };

interface ActionChipProps {
  actionId: ActionId;
  label: string;
  description: string;
  readiness: ActionReadiness;
  variant: 'compact' | 'large';
  onClick: () => void;
  animationDelay?: number;
}

export function ActionChip({ actionId, label, description, readiness, variant, onClick, animationDelay = 0 }: ActionChipProps) {
  const visual = ACTION_VISUALS[actionId];
  if (!visual) return null;
  const Icon = visual.icon;
  const isLarge = variant === 'large';


  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        action-chip relative overflow-hidden w-full h-full
        rounded-2xl border border-gray-200 dark:border-[#30363d]
        bg-white dark:bg-gray-800/50
        cursor-pointer transition-all duration-200 text-left group
        hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-500
        hover:scale-[1.02] active:scale-[0.98]
        ${isLarge ? 'px-5 py-4' : 'px-4 py-3'}
      `}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="action-chip-glow absolute inset-[-1px] rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative flex items-center gap-3">
        <div className={`
          ${isLarge ? 'w-10 h-10' : 'w-9 h-9'}
          rounded-xl flex items-center justify-center shrink-0
          ${visual.bg}
          group-hover:scale-105 transition-transform duration-200
        `}>
          <Icon className={`${isLarge ? 'w-5 h-5' : 'w-4 h-4'} ${visual.text}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`${isLarge ? 'text-sm' : 'text-xs'} font-semibold text-gray-800 dark:text-gray-200 truncate`}>
              {label}
            </span>
          </div>
          {isLarge && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{description}</p>
          )}
        </div>
      </div>
    </button>
  );
}

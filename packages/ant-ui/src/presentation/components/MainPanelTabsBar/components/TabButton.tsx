import { X, LucideIcon } from 'lucide-react';
import { cn, textColors } from '@/shared/utils/design-system';

interface TabButtonProps {
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  isJobTab?: boolean;
  showText?: boolean;
  showCloseButton?: boolean;
  title?: string;
  onClick: () => void;
  onClose?: () => void;
}

export function TabButton({
  icon: Icon,
  label,
  isActive,
  isJobTab = false,
  showText = true,
  showCloseButton = false,
  title,
  onClick,
  onClose
}: TabButtonProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1.5 rounded-t transition-all text-sm font-medium',
        showText ? 'px-3' : 'px-2',
        isActive
          ? 'bg-white dark:bg-[#0d1117] text-gray-900 dark:text-white border-t border-x border-gray-200 dark:border-[#30363d]'
          : 'bg-gray-100 dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1c2128] cursor-pointer'
      )}
      title={title}
    >
      <div 
        onClick={onClick}
        className="flex items-center gap-2 flex-1"
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        {showText && <span className={isJobTab ? "whitespace-nowrap" : ""}>{label}</span>}
      </div>
      {showCloseButton && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          className={cn(
            'p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
            !showText && 'hidden'
          )}
          title={isJobTab ? "Remove job ID" : `Close ${label.toLowerCase()} tab`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

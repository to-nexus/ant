import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/presentation/components/common/badge';
import { TaskTimer } from './TaskTimer';
import { ChevronDown, ChevronRight, Timer, Coins, Package } from 'lucide-react';
import { UnifiedTask } from '@/domain/models/task';
import { useStore } from '@/domain/store';
import { statusColors, badgeColors, cn } from '@/shared/utils/design-system';
import { formatTokenUsageCompact } from '@/shared/utils/tokenUtils';

interface TaskCardProps {
  task: UnifiedTask;
  status: 'todo' | 'in-progress' | 'completed';
  index?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function TaskCard({
  task,
  status,
  isExpanded = false,
  onToggleExpand
}: TaskCardProps) {
  const { t } = useTranslation('kanban');
  // Get actual running state from store
  const isTaskRunning = useStore((state) => state.isRunning);
  
  const defaultExpanded = isExpanded;
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  
  const expanded = onToggleExpand !== undefined ? isExpanded : localExpanded;
  const toggleExpand = onToggleExpand || (() => setLocalExpanded(!localExpanded));
  
  // Map status to design system colors
  const statusMap = {
    'todo': 'todo',
    'in-progress': 'progress',
    'completed': 'completed'
  } as const;
  
  const colors = statusColors[statusMap[status]];
  const hasDescription = task.description && task.description.trim() !== '';
  // Show expand button for all statuses if there's description (not just in-progress)
  const showExpandButton = hasDescription;
  
  // Debug: Check task data (disabled to reduce log noise)
  // if (status === 'todo' || status === 'in-progress') {
  //   console.log(`[TaskCard] ${status}:`, {
  //     name: task.name,
  //     priority: task.priority,
  //     hasPriority: task.priority !== undefined,
  //     hasDescription,
  //     type: task.type
  //   });
  // }
  
  // ✅ Determine display type from task type
  const displayType = task.type;
  
  // Type badge styling
  const typeBadgeMap: Record<string, {color: string, label: string}> = {
    'feature': { color: badgeColors.feature, label: 'FEATURE' },
    'setup': { color: badgeColors.setup, label: '⚙️ SETUP' },
    'testgen': { color: 'bg-yellow-500 dark:bg-yellow-600 text-white', label: '🧪 TESTGEN' },
    'error': { color: badgeColors.error, label: '🔧 ERROR' },
    'verification': { color: badgeColors.final, label: '🎯 VERIFY' },
    'implementation': { color: 'bg-indigo-500 dark:bg-indigo-600 text-white', label: 'IMPL' },
    'testing': { color: 'bg-yellow-500 dark:bg-yellow-600 text-white', label: 'TEST' },
    'documentation': { color: 'bg-gray-500 dark:bg-gray-600 text-white', label: 'DOCS' },
    'review': { color: 'bg-pink-500 dark:bg-pink-600 text-white', label: 'REVIEW' },
    'deployment': { color: 'bg-teal-500 dark:bg-teal-600 text-white', label: 'DEPLOY' },
    'bugfix': { color: 'bg-orange-500 dark:bg-orange-600 text-white', label: 'FIX' },
    'refactor': { color: 'bg-cyan-500 dark:bg-cyan-600 text-white', label: 'REFACTOR' },
  };
  
  const typeBadge = typeBadgeMap[displayType.toLowerCase()] || { 
    color: 'bg-gray-400 dark:bg-gray-600 text-white', 
    label: displayType.toUpperCase() 
  };
  
  return (
    <div 
      className={cn(
        'p-3 rounded-lg border transition-colors relative',
        status === 'in-progress' ? 'border-2' : '',
        colors.border,
        colors.bg
      )}
    >
      {/* Wave effect for in-progress tasks (behind main content) */}
      {status === 'in-progress' && (
        <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-300/50 dark:via-blue-400/40 to-transparent" 
            style={{
              backgroundSize: '200% 100%',
              animation: 'wave-slide-continuous 2s linear infinite'
            }}
          />
        </div>
      )}
      
      <div className="flex items-start gap-2 relative z-10">
        {showExpandButton && (
          <button
            className="mt-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand();
            }}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        )}
        
        <div className="flex-1 min-w-0">
          {/* Task Name - Full Width (Clickable to toggle) */}
          <div 
            className={`mb-2 ${showExpandButton ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
            onClick={showExpandButton ? toggleExpand : undefined}
          >
            <span className={cn('text-sm font-medium', colors.text.primary)}>
              {task.name}
            </span>
          </div>
          
          {/* Badges + Timer Row - Wrap automatically (Clickable to toggle) */}
          <div 
            className={cn(
              'flex flex-wrap items-center gap-2',
              showExpandButton ? 'cursor-pointer' : ''
            )}
            onClick={showExpandButton ? toggleExpand : undefined}
          >
            {/* Priority Badge - Only for to-do */}
            {status === 'todo' && task.priority !== undefined && (
              <Badge variant="outline" className={cn(
                'flex-shrink-0',
                'bg-blue-100 dark:bg-blue-900',
                'text-blue-900 dark:text-blue-100',
                'border-blue-300 dark:border-blue-700'
              )}>
                {`P${task.priority}`}
              </Badge>
            )}
            
            {/* Interrupted Badge - Only for to-do tasks that were interrupted */}
            {status === 'todo' && task.interrupted && (
              <Badge variant="outline" className={cn(
                'flex items-center gap-1 flex-shrink-0',
                'bg-orange-100 dark:bg-orange-950',
                'border-orange-400 dark:border-orange-700',
                'text-orange-800 dark:text-orange-200'
              )}>
                <Timer className="w-3 h-3" />
                <span className="font-semibold text-xs">{t('task.paused')}</span>
              </Badge>
            )}
            
            {/* Type Badge */}
            <Badge className={cn(typeBadge.color, 'text-xs flex-shrink-0')}>
              {typeBadge.label}
            </Badge>
            
            {/* Package Scope */}
            {task.packages && task.packages.length > 0 && (
              <span className={cn('inline-flex items-start gap-1 text-xs min-w-0', colors.text.secondary)}>
                <Package className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className="break-words min-w-0">{task.packages.join(', ')}</span>
              </span>
            )}
            
            {            /* Timer - Show for in-progress and completed */}
            {status === 'in-progress' && (
              <span className={cn('font-medium flex items-center gap-1 text-xs flex-shrink-0', colors.text.secondary)}>
                <Timer className="w-3.5 h-3.5" />
                <TaskTimer timing={task.timing} isRunning={isTaskRunning} />
              </span>
            )}
            {status === 'completed' && task.timing && task.timing.elapsedTime !== undefined && (
              <span className={cn('flex items-center gap-1 text-xs flex-shrink-0', colors.text.secondary)}>
                <Timer className="w-3.5 h-3.5" />
                <TaskTimer timing={task.timing} />
              </span>
            )}
            
            {/* Token Usage - Show for in-progress (real-time) and completed tasks */}
            {(status === 'in-progress' || status === 'completed') && task.tokenUsage && (
              <span className={cn('flex items-center gap-1 text-xs flex-shrink-0', colors.text.secondary)}>
                <Coins className="w-3.5 h-3.5" />
                {formatTokenUsageCompact(task.tokenUsage)}
              </span>
            )}
          </div>
          
          {/* Expanded content - NOT clickable (allows text selection), blocks wave effect */}
          {expanded && hasDescription && (
            <div 
              className={cn(
                'mt-2 p-2 rounded border text-xs select-text relative z-20',
                'break-words whitespace-pre-wrap',  // ✅ Break long words (file paths) + preserve line breaks
                colors.border,
                'bg-white dark:bg-gray-900',
                colors.text.secondary
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {task.description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

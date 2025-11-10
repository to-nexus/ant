import { useState } from 'react';
import { Badge } from '@/ui/badge';
import { TaskTimer } from './TaskTimer';
import { ChevronDown, ChevronRight, Timer } from 'lucide-react';
import { UnifiedTask } from '@/types/task';
import { useStore } from '@/lib/store';
import { statusColors, badgeColors, cn } from '@/lib/design-system';

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
  // Get actual running state from store
  const isTaskRunning = useStore((state) => state.isRunning);
  
  // In-progress tasks should be expanded by default
  const defaultExpanded = status === 'in-progress' ? true : isExpanded;
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
  
  // ✅ Determine display type: Priority 1000 = Final Verification
  const displayType = task.priority === 1000 ? 'final' : task.type;
  
  // Type badge styling
  const typeBadgeMap: Record<string, {color: string, label: string}> = {
    'feature': { color: badgeColors.feature, label: 'FEATURE' },
    'setup': { color: badgeColors.setup, label: '⚙️ SETUP' },
    'error': { color: badgeColors.error, label: '🔧 ERROR' },
    'final': { color: badgeColors.final, label: '🎯 FINAL' },
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
          {/* Header - Clickable to toggle */}
          <div 
            className={`flex items-start gap-2 mb-1 ${showExpandButton ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
            onClick={showExpandButton ? toggleExpand : undefined}
          >
            {/* Priority Badge - Only for to-do (Left Side) */}
            {status === 'todo' && task.priority !== undefined && (
              <Badge variant="outline" className={cn(
                'flex-shrink-0',
                'bg-blue-100 dark:bg-blue-900',
                'text-blue-900 dark:text-blue-100',
                'border-blue-300 dark:border-blue-700'
              )}>
                {typeof task.priority === 'number' 
                  ? `P${task.priority}` 
                  : task.priority.toUpperCase()}
              </Badge>
            )}
            
            {/* Task Name (Center) */}
            <span className={cn('text-sm font-medium flex-1 min-w-0', colors.text.primary)}>
              {task.name}
            </span>
            
            {/* Right Side: Interrupted Badge + Type Badge (Stacked, Right-Aligned) */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {/* Interrupted Badge - Only for to-do tasks that were interrupted (TOP) */}
              {status === 'todo' && task.interrupted && (
                <Badge variant="outline" className={cn(
                  'flex items-center gap-1',
                  'bg-orange-100 dark:bg-orange-950',
                  'border-orange-400 dark:border-orange-700',
                  'text-orange-800 dark:text-orange-200'
                )}>
                  <span>⏸️</span>
                  <span className="font-semibold text-xs">Interrupted</span>
                </Badge>
              )}
              
              {/* Type Badge (BOTTOM) */}
              <Badge className={cn(typeBadge.color, 'text-xs')}>
                {typeBadge.label}
              </Badge>
            </div>
          </div>
          
          {/* Timing Info - Show for in-progress and completed */}
          <div 
            className={cn(
              'text-xs',
              colors.text.secondary,
              showExpandButton ? 'ml-0 cursor-pointer' : 'ml-12'
            )}
            onClick={showExpandButton ? toggleExpand : undefined}
          >
            {status === 'in-progress' && (
              <span className="font-medium flex items-center gap-1">
                <Timer className="w-3.5 h-3.5" />
                <TaskTimer timing={task.timing} isRunning={isTaskRunning} />
              </span>
            )}
            {status === 'completed' && task.timing && task.timing.elapsedTime !== undefined && (
              <span className="flex items-center gap-1">
                <Timer className="w-3.5 h-3.5" />
                <TaskTimer timing={task.timing} />
              </span>
            )}
          </div>
          
          {/* Expanded content - NOT clickable (allows text selection), blocks wave effect */}
          {expanded && hasDescription && (
            <div 
              className={cn(
                'mt-2 p-2 rounded border text-xs select-text relative z-20',
                colors.border,
                'bg-white dark:bg-gray-900',
                colors.text.secondary,
                showExpandButton ? 'ml-0' : 'ml-12'
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

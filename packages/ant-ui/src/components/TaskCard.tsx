import { useState } from 'react';
import { Badge } from '@/ui/badge';
import { TaskTimer } from './TaskTimer';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { UnifiedTask } from '@/types/task';
import { useStore } from '@/lib/store';

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
  
  // Color scheme based on status
  const colorSchemes = {
    'todo': {
      border: 'border-blue-200',
      bg: 'bg-blue-50/50',
      badgeBg: 'bg-blue-100',
      textPrimary: 'text-blue-900',
      textSecondary: 'text-blue-700',
    },
    'in-progress': {
      border: 'border-orange-400',
      bg: 'bg-orange-50',
      badgeBg: 'bg-orange-200 border-orange-400',
      textPrimary: 'text-orange-900',
      textSecondary: 'text-orange-700',
    },
    'completed': {
      border: 'border-green-200',
      bg: 'bg-green-50/50',
      badgeBg: 'bg-green-100',
      textPrimary: 'text-green-900',
      textSecondary: 'text-green-700',
    }
  };
  
  const colors = colorSchemes[status];
  const hasDescription = task.description && task.description.trim() !== '';
  // Show expand button for all statuses if there's description (not just in-progress)
  const showExpandButton = hasDescription;
  
  // Debug: Check task data
  if (status === 'todo' || status === 'in-progress') {
    console.log(`[TaskCard] ${status}:`, {
      name: task.name,
      priority: task.priority,
      hasPriority: task.priority !== undefined,
      hasDescription,
      type: task.type
    });
  }
  
  // ✅ Determine display type: Priority 1000 = Final Verification
  const displayType = task.priority === 1000 ? 'final' : task.type;
  
  // Type color mapping
  const typeColors: Record<string, string> = {
    'feature': 'bg-blue-500 text-white',
    'setup': 'bg-purple-500 text-white',
    'error': 'bg-red-500 text-white',
    'final': 'bg-green-600 text-white',
    'implementation': 'bg-indigo-500 text-white',
    'testing': 'bg-yellow-500 text-white',
    'documentation': 'bg-gray-500 text-white',
    'review': 'bg-pink-500 text-white',
    'deployment': 'bg-teal-500 text-white',
    'bugfix': 'bg-orange-500 text-white',
    'refactor': 'bg-cyan-500 text-white',
  };
  
  // Type display mapping
  const typeLabels: Record<string, string> = {
    'final': '🎯 FINAL',
    'setup': '⚙️ SETUP',
    'error': '🔧 ERROR',
    'feature': 'FEATURE',
  };
  
  const typeColor = typeColors[displayType.toLowerCase()] || 'bg-gray-400 text-white';
  const typeLabel = typeLabels[displayType.toLowerCase()] || displayType.toUpperCase();
  
  return (
    <div 
      className={`p-3 rounded-lg border ${status === 'in-progress' ? 'border-2' : ''} ${colors.border} ${colors.bg}`}
    >
      <div className="flex items-start gap-2">
        {showExpandButton && (
          <button
            className="mt-0.5 text-gray-500 hover:text-gray-700 transition-colors"
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
            {/* Priority Badge - Only for to-do */}
            {status === 'todo' && task.priority !== undefined && (
              <Badge variant="outline" className={`${colors.badgeBg} flex-shrink-0`}>
                {typeof task.priority === 'number' 
                  ? `P${task.priority}` 
                  : task.priority.toUpperCase()}
              </Badge>
            )}
            
            {/* Interrupted Badge - Only for to-do tasks that were interrupted */}
            {status === 'todo' && task.interrupted && (
              <Badge variant="outline" className="bg-orange-100 border-orange-400 text-orange-800 flex-shrink-0 flex items-center gap-1">
                <span>⏸️</span>
                <span className="font-semibold">Interrupted</span>
              </Badge>
            )}
            
            {/* Task Name (no ID shown) */}
            <span className={`text-sm font-medium ${colors.textPrimary} flex-1 min-w-0`}>
              {task.name}
            </span>
            
            {/* Type Badge */}
            <Badge className={`${typeColor} text-xs flex-shrink-0`}>
              {typeLabel}
            </Badge>
          </div>
          
          {/* Timing Info - Show for in-progress and completed */}
          <div 
            className={`text-xs ${colors.textSecondary} ${showExpandButton ? 'ml-0 cursor-pointer' : 'ml-12'}`}
            onClick={showExpandButton ? toggleExpand : undefined}
          >
            {status === 'in-progress' && (
              <span className="font-medium">
                ⏱️ <TaskTimer timing={task.timing} isRunning={isTaskRunning} />
              </span>
            )}
            {status === 'completed' && task.timing && task.timing.elapsedTime !== undefined && (
              <span>
                ⏱️ <TaskTimer timing={task.timing} />
              </span>
            )}
          </div>
          
          {/* Expanded content - NOT clickable (allows text selection) */}
          {expanded && hasDescription && (
            <div 
              className={`mt-2 p-2 rounded border ${colors.border} bg-white/50 text-xs ${colors.textSecondary} ${showExpandButton ? 'ml-0' : 'ml-12'} select-text`}
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

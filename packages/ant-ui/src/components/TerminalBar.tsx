import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { Bar } from './Bar';

/**
 * TerminalBar - Expandable terminal output bar
 * 
 * Features:
 * - Collapsible/expandable terminal output
 * - Resizable height
 * - Auto-scroll to latest logs
 * - Log type indicators (INFO, OUT, ERR, ERROR)
 * - Clear logs functionality
 */
export function TerminalBar() {
  const logs = useStore((state) => state.logs);
  const clearLogs = useStore((state) => state.clearLogs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [height, setHeight] = useState(400);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // ✅ REMOVED: Auto-expand when logs arrive
  // Users should manually expand/collapse terminal to keep their preferred state

  // Handle mouse resize when expanded
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !isExpanded) return;
      
      // Resize from top (inverted movement)
      const newHeight = Math.max(200, Math.min(800, height - e.movementY));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, height, isExpanded]);

  const getLogTypeIndicator = (type: string): string => {
    switch (type) {
      case 'info':
        return '[INFO]';
      case 'stdout':
        return '[OUT]';
      case 'stderr':
        return '[ERR]';
      case 'error':
        return '[ERROR]';
      default:
        return '[LOG]';
    }
  };

  const getLogTypeColor = (type: string): string => {
    switch (type) {
      case 'error':
        return 'text-red-600 dark:text-red-400';
      case 'stderr':
        return 'text-orange-600 dark:text-orange-400';
      case 'info':
        return 'text-blue-600 dark:text-blue-400';
      case 'stdout':
      default:
        return 'text-gray-700 dark:text-gray-300';
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
    } catch (_error) {
      return timestamp;
    }
  };

  return (
    <div className="relative bg-white dark:bg-gray-800 border-t-2 border-gray-300 dark:border-gray-700 shadow-lg shrink-0">
      {/* Resize handle (only when expanded) */}
      {isExpanded && (
        <div
          className={`h-1 cursor-ns-resize transition-all duration-200 ${
            isResizing 
              ? 'bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-700 dark:to-blue-800' 
              : 'bg-gradient-to-r from-blue-200 to-blue-300 dark:from-gray-700 dark:to-gray-600 hover:from-blue-400 hover:to-blue-500 dark:hover:from-gray-600 dark:hover:to-gray-500'
          }`}
          onMouseDown={() => setIsResizing(true)}
          title="Drag to resize terminal height"
        />
      )}
      
      {/* Header Bar (Always Visible) */}
      <Bar
        left={
          <>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              <span>🖥️ Terminal Output</span>
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded-full">
              {logs.length > 500 ? '500+' : logs.length} logs
            </span>
            {isExpanded && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {height}px
              </span>
            )}
          </>
        }
        right={
          logs.length > 0 ? (
            <button
              onClick={clearLogs}
              className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex items-center gap-1"
              title="Clear all logs"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          ) : undefined
        }
      />

      {/* Terminal Content (Expandable) - Light Mode */}
      {isExpanded && (
        <div
          ref={scrollRef}
          className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm overflow-y-auto p-4 border-t border-gray-200 dark:border-gray-700"
          style={{ height: `${height}px` }}
        >
          {logs.length === 0 ? (
            <div className="text-gray-500 dark:text-gray-400 text-center py-8">
              <div className="text-2xl mb-2">📟</div>
              <div>No logs yet...</div>
              <div className="text-xs mt-1">Execute a task to see output here</div>
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="mb-1 leading-relaxed hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded">
                <span className="text-gray-400 dark:text-gray-500 text-xs">{formatTimestamp(log.timestamp)}</span>
                {' '}
                <span className={`${getLogTypeColor(log.type)} text-xs font-bold`}>
                  {getLogTypeIndicator(log.type)}
                </span>
                {' '}
                <span className="text-gray-800 dark:text-gray-200">{log.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}


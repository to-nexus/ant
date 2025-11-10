import { useEffect, useRef, useState, useMemo } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useStore } from '@/lib/store';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { Bar, BaseBarProps } from './Bar';
import { filterLogsForTerminal } from '@/lib/logFilters';

/**
 * TerminalBar - Extends Bar
 * 
 * Expandable terminal output bar with extended functionality.
 * Inherits base styling from Bar and adds terminal-specific features.
 * 
 * Features:
 * - Collapsible/expandable terminal output
 * - Resizable height (100px minimum)
 * - Auto-collapse when resized below 100px
 * - Drag from collapsed state to expand (starts at 100px)
 * - Auto-scroll to latest logs
 * - Log type indicators (INFO, OUT, ERR, ERROR)
 * - Clear logs functionality
 */
export function TerminalBar(props: BaseBarProps = {}) {
  const logsVersion = useStore((state) => state.logsVersion);  // ✅ 로그 변경 감지
  const getLogs = useStore((state) => state.getLogs);
  const clearLogs = useStore((state) => state.clearLogs);
  const virtuosoRef = useRef<VirtuosoHandle>(null);  // ✅ Virtual scroll ref
  const [isExpanded, setIsExpanded] = useState(false);
  const [height, setHeight] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const startYRef = useRef<number>(0);  // ✅ Track initial Y position
  const startHeightRef = useRef<number>(0);  // ✅ Track initial height
  const MIN_HEIGHT = 100; // ✅ Minimum height in pixels

  // ✅ 로그 가져오기 (logsVersion 변경 시 자동 업데이트)
  const logs = useMemo(() => getLogs(), [logsVersion, getLogs]);
  
  // ✅ 필터링된 로그 (THINKING 생략, CODE 파일명만, RESPONSE 전체 표시)
  const filteredLogs = useMemo(() => filterLogsForTerminal(logs), [logs]);

  // ✅ Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (filteredLogs.length > 0 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: filteredLogs.length - 1,
        behavior: 'smooth',
        align: 'end'
      });
    }
  }, [filteredLogs.length]);

  // ✅ REMOVED: Auto-expand when logs arrive
  // Users should manually expand/collapse terminal to keep their preferred state

  // Handle mouse resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      // ✅ If collapsed, expand to MIN_HEIGHT on first drag
      if (!isExpanded) {
        setIsExpanded(true);
        setHeight(MIN_HEIGHT);
        startYRef.current = e.clientY;
        startHeightRef.current = MIN_HEIGHT;
        return;
      }
      
      // ✅ Calculate new height from initial position (more stable)
      const deltaY = startYRef.current - e.clientY;  // Inverted: drag up = increase height
      const newHeight = Math.max(MIN_HEIGHT, Math.min(800, startHeightRef.current + deltaY));
      
      // ✅ Auto-collapse if dragged below MIN_HEIGHT
      if (newHeight <= MIN_HEIGHT && startHeightRef.current > MIN_HEIGHT) {
        setIsExpanded(false);
        setIsResizing(false);
        return;
      }
      
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
  }, [isResizing, isExpanded]);

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
    <div 
      className="relative bg-white dark:bg-gray-800 border-t-2 border-gray-300 dark:border-gray-700 shadow-lg shrink-0"
      data-terminal-bar
    >
      {/* Resize handle (always visible - can drag from collapsed state) */}
      <div
        className={`h-1 cursor-ns-resize transition-all duration-200 ${
          isResizing 
            ? 'bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-700 dark:to-blue-800' 
            : 'bg-gradient-to-r from-blue-200 to-blue-300 dark:from-gray-700 dark:to-gray-600 hover:from-blue-400 hover:to-blue-500 dark:hover:from-gray-600 dark:hover:to-gray-500'
        }`}
        onMouseDown={(e) => {
          setIsResizing(true);
          startYRef.current = e.clientY;
          startHeightRef.current = height;
        }}
        title={isExpanded ? "Drag to resize terminal height" : "Drag up to open terminal"}
      />
      
      {/* Header Bar (Always Visible) - Extends Base Bar */}
      {Bar.render({
        left: (
          <>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              <span>🖥️ Terminal Output</span>
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded-full">
              {filteredLogs.length} logs
            </span>
            {isExpanded && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {height}px
              </span>
            )}
          </>
        ),
        right: logs.length > 0 ? (
            <button
              onClick={clearLogs}
              className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex items-center gap-1"
              title="Clear all logs"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          ) : undefined,
        className: props.className
      })}

      {/* Terminal Content (Expandable) - Virtual Scrolling */}
      {isExpanded && (
        <div
          className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm border-t border-gray-200 dark:border-gray-700"
          style={{ height: `${height}px` }}
        >
          {filteredLogs.length === 0 ? (
            <div className="text-gray-500 dark:text-gray-400 text-center py-8">
              <div className="text-2xl mb-2">📟</div>
              <div>No logs yet...</div>
              <div className="text-xs mt-1">Execute a task to see output here</div>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={filteredLogs}
              style={{ height: '100%' }}
              initialTopMostItemIndex={filteredLogs.length - 1}  // Start at bottom
              followOutput="smooth"  // Auto-scroll to new logs
              itemContent={(index, log) => (
                <div className="mb-1 leading-relaxed hover:bg-gray-100 dark:hover:bg-gray-800 px-6 py-1 rounded">
                  <span className="text-gray-400 dark:text-gray-500 text-xs">{formatTimestamp(log.timestamp)}</span>
                  {' '}
                  <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{log.message}</span>
                </div>
              )}
            />
          )}
        </div>
      )}
    </div>
  );
}


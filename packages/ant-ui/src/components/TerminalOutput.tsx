import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';

export function TerminalOutput() {
  const logs = useStore((state) => state.logs);
  const clearLogs = useStore((state) => state.clearLogs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(350); // Increased default height
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle mouse resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const newHeight = Math.max(150, Math.min(1000, height + e.movementY));
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
  }, [isResizing, height]);

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
        return 'text-red-400';
      case 'stderr':
        return 'text-yellow-400';
      case 'info':
        return 'text-blue-400';
      case 'stdout':
      default:
        return 'text-green-400';
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
    <Card className="relative">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>🖥️ Terminal Output</span>
          <div className="flex items-center gap-2">
            <button
              onClick={clearLogs}
              className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              title="Clear all logs"
            >
              Clear
            </button>
            <span className="text-xs text-gray-500">
              Height: {height}px | Logs: {logs.length}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div
          ref={scrollRef}
          className="bg-gray-900 text-green-400 font-mono overflow-y-auto p-4 rounded-b-lg border-l-4 border-green-500 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800"
          style={{ height: `${height}px` }}
        >
          {logs.length === 0 ? (
            <div className="text-gray-500 text-center py-8">
              <div className="text-2xl mb-2">📟</div>
              <div>No logs yet...</div>
              <div className="text-xs mt-1">Execute a task to see output here</div>
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="mb-1 leading-tight hover:bg-gray-800 px-1 py-0.5 rounded">
                <span className="text-gray-500 text-xs">{formatTimestamp(log.timestamp)}</span>
                {' '}
                <span className={`${getLogTypeColor(log.type)} text-xs font-bold`}>
                  {getLogTypeIndicator(log.type)}
                </span>
                {' '}
                <span className={getLogTypeColor(log.type)}>{log.message}</span>
              </div>
            ))
          )}
        </div>
        
        {/* Resize handle */}
        <div
          className={`h-3 bg-gradient-to-r from-gray-200 to-gray-300 hover:from-blue-300 hover:to-blue-400 cursor-ns-resize transition-all duration-200 ${
            isResizing ? 'from-blue-400 to-blue-500' : ''
          }`}
          onMouseDown={() => setIsResizing(true)}
          title="Drag to resize terminal height"
        >
          <div className="h-full flex items-center justify-center">
            <div className="w-12 h-1 bg-gray-500 rounded-full opacity-60"></div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
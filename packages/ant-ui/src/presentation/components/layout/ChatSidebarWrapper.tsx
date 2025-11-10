import { ChevronRight, WifiOff } from 'lucide-react';
import { Bar } from '../Bar';
import { ChatPanel } from '../chat/ChatPanel';

interface ChatSidebarWrapperProps {
  isCollapsed: boolean;
  width: number;
  isResizing: boolean;
  selectedAgent: string | null;
  selectedProject: string | null;
  selectedFeature: string | null;
  onExpand: () => void;
  onCollapse: () => void;
  onResizeStart: () => void;
}

export function ChatSidebarWrapper({
  isCollapsed,
  width,
  isResizing,
  selectedAgent,
  selectedProject,
  selectedFeature,
  onExpand,
  onCollapse,
  onResizeStart,
}: ChatSidebarWrapperProps) {
  // Collapsed state
  if (isCollapsed) {
    return (
      <div className="w-10 bg-white dark:bg-[#161b22] border-l border-gray-200 dark:border-[#30363d] flex flex-col items-center shrink-0 transition-colors shadow-sm">
        <button
          onClick={onExpand}
          className="h-10 w-10 flex items-center justify-center border-b border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          title="Expand Chat"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
      </div>
    );
  }

  // Expanded state
  return (
    <aside 
      className="bg-white dark:bg-[#161b22] border-l border-gray-200 dark:border-[#30363d] flex flex-col overflow-hidden transition-colors shrink-0 relative shadow-sm"
      style={{ width: `${width}px` }}
    >
      {/* Resize Handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors z-10"
        style={{
          backgroundColor: isResizing ? '#3b82f6' : 'transparent'
        }}
        onMouseDown={onResizeStart}
      />

      {/* Chat Bar */}
      {Bar.render({
        left: (
          <>
            {!selectedAgent ? (
              <>
                <WifiOff className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <span className="text-gray-700 dark:text-gray-200 font-medium">Chat is Offline</span>
              </>
            ) : (
              <>
                <span className="text-2xl">💬</span>
                <span className="text-gray-700 dark:text-gray-200 font-medium">
                  Chat with {selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)}
                </span>
              </>
            )}
          </>
        ),
        right: (
          <button
            onClick={onCollapse}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex items-center justify-center w-10 h-10 -mr-4 -my-4"
            title="Collapse Chat"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )
      })}
      
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          projectId={selectedProject}
          featureName={selectedFeature}
          enabled={!isCollapsed}
        />
      </div>
    </aside>
  );
}


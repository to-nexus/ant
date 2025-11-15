import { ChevronLeft, LogIn } from 'lucide-react';
import { Bar } from '../Bar';
import { ProjectSection } from '../ProjectSection';
import { FeatureSection } from '../FeatureSection';
import { ArtifactsPanel } from '../ArtifactsPanel';
import { useStore } from '@/domain/store';

interface ExplorerPanelProps {
  isCollapsed: boolean;
  width: number;
  selectedFile: string | null;
  showFileEditor: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  onCollapse: () => void;
  onToggleFileEditor: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function ExplorerPanel({
  isCollapsed,
  width,
  selectedFile,
  showFileEditor,
  connectionStatus,
  onCollapse,
  onToggleFileEditor,
  onResizeStart,
}: ExplorerPanelProps) {
  const backendMode = useStore((state) => state.backendMode);
  const userEmail = useStore((state) => state.userEmail);
  
  // Check authentication status
  const isAuthenticated = backendMode === 'local' || !!userEmail;
  
  if (isCollapsed) return null;

  return (
    <aside 
      className="bg-white dark:bg-[#161b22] border-r border-gray-200 dark:border-[#30363d] flex flex-col overflow-hidden transition-colors shrink-0 relative shadow-sm"
      style={{ width: `${width}px` }}
    >
      {/* Explorer Bar */}
      {Bar.render({
        left: (
          <>
            <button
              onClick={onCollapse}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex items-center justify-center w-10 h-10 -ml-4 -my-4"
              title="Collapse Explorer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-gray-700 dark:text-gray-200 font-medium">📁 Explorer</span>
          </>
        ),
        right: selectedFile ? (
          <button
            onClick={onToggleFileEditor}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              showFileEditor 
                ? 'bg-blue-500 text-white hover:bg-blue-600' 
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
            title="Toggle Editor"
          >
            Editor
          </button>
        ) : undefined
      })}
      
      <div className="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        {!isAuthenticated ? (
          <div className="text-center text-gray-400 dark:text-gray-500 mt-8">
            <div className="text-4xl mb-2">
              <LogIn className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600" />
            </div>
            <div className="text-sm font-medium mb-1">Sign In Required</div>
            <div className="text-xs text-gray-400 dark:text-gray-600">
              Please sign in to access your projects
            </div>
          </div>
        ) : connectionStatus === 'connected' ? (
          <>
            <ProjectSection />
            <FeatureSection />
            <ArtifactsPanel />
          </>
        ) : (
          <div className="text-center text-gray-400 dark:text-gray-500 mt-8">
            <div className="text-4xl mb-2">🔌</div>
            <div className="text-sm">
              {connectionStatus === 'error' ? 'Connection Error' : 'Disconnected'}
            </div>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-blue-500 hover:opacity-50 transition-opacity z-10"
        onMouseDown={onResizeStart}
      />
    </aside>
  );
}


import { useState } from 'react';
import { Sun, Moon, Monitor, Cloud, Bot, Code2 } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { useStore } from '@/domain/store';

export interface GlobalNavBarProps {
  // ✅ No props needed - uses hooks directly
}

/**
 * GlobalNavBar - Top-level navigation bar
 * 
 * Contains:
 * - App branding
 * - Theme toggle
 * - Connection status
 * - Deployment mode selector
 * 
 * ✅ Agent/Job selection and Run/Stop are now in Chat UI
 */
export function GlobalNavBar({}: GlobalNavBarProps) {
  const connectionStatus = useStore((state) => state.connectionStatus);
  const theme = useStore((state) => state.theme);
  const toggleTheme = useStore((state) => state.toggleTheme);
  const editorMode = useStore((state) => state.editorMode);
  const setEditorMode = useStore((state) => state.setEditorMode);
  
  // Deployment mode state
  const [deploymentMode, _setDeploymentMode] = useState<'local' | 'cloud'>('local');
  const [showLocalTooltip, setShowLocalTooltip] = useState(false);
  const [showCloudTooltip, setShowCloudTooltip] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gray-50 dark:bg-[#0d1117] border-b border-gray-300 dark:border-[#30363d] shadow-md transition-colors">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* ANT Logo - Neural Network Pattern */}
            <img 
              src={theme === 'dark' ? '/logo-dark.svg' : '/logo-light.svg'}
              alt="ANT Works Logo" 
              className="w-8 h-8" 
            />
            
            <h1 className="text-xl font-display font-bold text-gray-900 dark:text-white tracking-tight">ANT Works</h1>
            
            {/* Deployment Mode Selector */}
            <div className="deployment-mode-selector flex items-center gap-1 ml-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
              {/* Local Button */}
              <div className="relative">
                <button
                  onClick={() => {
                    // Already selected, toggle tooltip
                    setShowLocalTooltip(!showLocalTooltip);
                    setShowCloudTooltip(false);
                  }}
                  className={`
                    px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5
                    ${deploymentMode === 'local'
                      ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border border-blue-200 dark:border-transparent'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-60'
                    }
                  `}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Local
                </button>
                
                {/* Local Tooltip */}
                {showLocalTooltip && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 w-64">
                    <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs px-3 py-2 rounded-md shadow-lg">
                      <div className="font-semibold mb-1">Local Mode</div>
                      <div className="text-gray-300 dark:text-gray-400">
                        Work on your local machine. All results are stored locally.
                      </div>
                      {/* Arrow */}
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Cloud Button */}
              <div className="relative">
                <button
                  onClick={() => {
                    // Show tooltip but don't change selection
                    setShowCloudTooltip(!showCloudTooltip);
                    setShowLocalTooltip(false);
                  }}
                  className={`
                    px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5
                    text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer opacity-60 hover:opacity-80
                  `}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  Cloud
                </button>
                
                {/* Cloud Tooltip */}
                {showCloudTooltip && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 w-64">
                    <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs px-3 py-2 rounded-md shadow-lg">
                      <div className="font-semibold mb-1">Cloud Mode</div>
                      <div className="text-gray-300 dark:text-gray-400 mb-1">
                        Work on remote machines. All results are stored remotely.
                      </div>
                      <div className="text-yellow-400 dark:text-yellow-300 font-medium">
                        ⚠️ Currently in development
                      </div>
                      {/* Arrow */}
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Editor Mode Selector */}
            <div className="editor-mode-selector flex items-center gap-1 ml-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
              {/* Agents Button */}
              <button
                onClick={() => setEditorMode('agents')}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5
                  ${editorMode === 'agents'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border border-blue-200 dark:border-transparent'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }
                `}
              >
                <Bot className="w-3.5 h-3.5" />
                Agents
              </button>
              
              {/* Editor Button */}
              <button
                onClick={() => setEditorMode('editor')}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5
                  ${editorMode === 'editor'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border border-blue-200 dark:border-transparent'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }
                `}
              >
                <Code2 className="w-3.5 h-3.5" />
                Editor
              </button>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Theme Toggle Switch */}
            <button
              onClick={toggleTheme}
              className="relative inline-flex items-center h-8 rounded-full w-16 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 bg-gray-300 dark:bg-gray-600"
              aria-label="Toggle theme"
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {/* Switch Track */}
              <span className="sr-only">Toggle theme</span>
              {/* Switch Thumb */}
              <span
                className={`${
                  theme === 'dark' ? 'translate-x-8' : 'translate-x-1'
                } inline-flex items-center justify-center h-7 w-7 transform rounded-full bg-white dark:bg-gray-800 shadow-lg transition-transform duration-200 ease-in-out`}
              >
                {theme === 'light' ? (
                  <Sun className="w-4 h-4 text-gray-900" />
                ) : (
                  <Moon className="w-4 h-4 text-blue-400" />
                )}
              </span>
            </button>
            
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
            
            <ConnectionStatus status={connectionStatus} />
          </div>
        </div>
      </div>
    </header>
  );
}


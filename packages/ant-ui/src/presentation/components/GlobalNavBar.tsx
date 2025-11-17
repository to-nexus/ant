import { useState } from 'react';
import { Sun, Moon, Monitor, Cloud, Bot, Code2, User, LogOut } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { useStore } from '@/domain/store';
import { SignUpModal } from './auth/SignUpModal';
import { SignInModal } from './auth/SignInModal';
import { signUp, signIn, signOut, checkLocalBackend } from '@/infrastructure/http/api';

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
  const viewMode = useStore((state) => state.viewMode);
  const setViewMode = useStore((state) => state.setViewMode);
  const selectedProject = useStore((state) => state.selectedProject);
  const userEmail = useStore((state) => state.userEmail);
  const userOrganization = useStore((state) => state.userOrganization);
  const setUser = useStore((state) => state.setUser);
  const clearUser = useStore((state) => state.clearUser);
  const reset = useStore((state) => state.reset);
  const frontendMode = useStore((state) => state.frontendMode);
  const backendMode = useStore((state) => state.backendMode);
  const setBackendMode = useStore((state) => state.setBackendMode);
  
  // Auth modal state
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [editorTooltip, setEditorTooltip] = useState<string | null>(null);
  
  // Check if user is signed in
  const isSignedIn = !!userEmail && !!userOrganization;
  
  // ✅ UI 선택 상태: /local 페이지면 'local', 아니면 backendMode
  const uiSelectedMode = window.location.pathname === '/local' ? 'local' : backendMode;
  
  // Handle deployment mode change
  const handleModeChange = async (mode: 'local' | 'cloud') => {
    // If on /local page and user clicks cloud, go back to home
    if (window.location.pathname === '/local' && mode === 'cloud') {
      // Switch to cloud mode and navigate home
      setBackendMode('cloud');
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
      
      // Reload projects in cloud mode
      const fetchProjects = useStore.getState().fetchProjects;
      fetchProjects();
      return;
    }
    
    // Early return if same mode (but only for non-/local pages)
    if (mode === backendMode && window.location.pathname !== '/local') return;
    
    // ✅ Local 선택 시 health check 수행
    if (mode === 'local') {
      console.log('[GNB] Checking local backend availability...');
      const isAvailable = await checkLocalBackend();
      
      if (isAvailable) {
        // ✅ 로컬 서버 정상 응답 → 백엔드 전환
        console.log('[GNB] Local backend available, switching mode');
        setBackendMode('local');
        
        // Reload projects after mode change
        const fetchProjects = useStore.getState().fetchProjects;
        fetchProjects();
      } else {
        // ❌ 로컬 서버 응답 없음 → 안내 페이지만 표시 (backendMode 유지)
        console.log('[GNB] Local backend not available, showing setup guide');
        window.history.pushState({}, '', '/local');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      return;
    }
    
    // Cloud 선택 시 (바로 전환)
    if (mode === 'cloud') {
      setBackendMode('cloud');
      
      // ✅ Only reload projects if authenticated (cloud mode requires auth)
      if (isSignedIn) {
        const fetchProjects = useStore.getState().fetchProjects;
        fetchProjects();
      }
    }
  };
  
  // Handle sign up
  const handleSignUp = async (email: string) => {
    const response = await signUp(email);
    if (response.success && response.user) {
      setUser(response.user.email, response.user.organization);
      // Load projects after sign up
      const fetchProjects = useStore.getState().fetchProjects;
      await fetchProjects();
    }
  };
  
  // Handle sign in
  const handleSignIn = async (email: string) => {
    const response = await signIn(email);
    if (response.success && response.user) {
      setUser(response.user.email, response.user.organization);
      // Load projects after sign in
      const fetchProjects = useStore.getState().fetchProjects;
      await fetchProjects();
    }
  };
  
  // Handle sign out
  const handleSignOut = async () => {
    await signOut();
    clearUser();
    setShowUserMenu(false);
    
    // ✅ Reset all job/task/kanban state
    reset();
    
    // Clear projects after sign out
    const setProjects = useStore.getState().setProjects;
    const setSelectedProject = useStore.getState().setSelectedProject;
    const setSelectedFeature = useStore.getState().setSelectedFeature;
    setProjects([]);
    setSelectedProject(undefined);
    setSelectedFeature(undefined);
  };
  
  // Handle Editor mode switch
  const handleEditorViewSwitch = () => {
    // ✅ Check if project is selected
    if (!selectedProject) {
      setEditorTooltip('Please select a project first');
      setTimeout(() => setEditorTooltip(null), 3000);
      return;
    }
    
    // ✅ Simply switch to editor view (like Local/Cloud does)
    setViewMode('editor');
  };

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
              <button
                onClick={() => handleModeChange('local')}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 border
                  ${uiSelectedMode === 'local'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border-blue-200 dark:border-transparent'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-60 border-transparent'
                  }
                `}
                title={frontendMode === 'cloud' && uiSelectedMode !== 'local' ? 'View local setup guide' : 'Switch to local backend'}
              >
                <Monitor className="w-3.5 h-3.5" />
                Local
              </button>
              
              {/* Cloud Button */}
              <button
                onClick={() => handleModeChange('cloud')}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 border
                  ${uiSelectedMode === 'cloud'
                    ? 'bg-white dark:bg-gray-700 text-purple-600 dark:text-white shadow-md border-purple-200 dark:border-transparent'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-60 border-transparent'
                  }
                `}
                title="Switch to cloud backend"
              >
                <Cloud className="w-3.5 h-3.5" />
                Cloud
              </button>
            </div>
            
            {/* View Mode Selector */}
            <div className="view-mode-selector flex items-center gap-1 ml-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg relative">
              {/* Agents Button */}
              <button
                onClick={() => setViewMode('agents')}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 border
                  ${viewMode === 'agents'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border-blue-200 dark:border-transparent'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-60 border-transparent'
                  }
                `}
              >
                <Bot className="w-3.5 h-3.5" />
                Agents
              </button>
              
              {/* Editor Button */}
              <button
                onClick={handleEditorViewSwitch}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 border
                  ${viewMode === 'editor'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border-blue-200 dark:border-transparent'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-60 border-transparent'
                  }
                `}
                title={selectedProject ? 'Open codebase in editor' : 'Select a project first'}
              >
                <Code2 className="w-3.5 h-3.5" />
                Editor
              </button>
              
              {/* Tooltip for Editor button */}
              {editorTooltip && (
                <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-gray-900 dark:bg-gray-700 text-white text-xs px-3 py-2 rounded shadow-lg whitespace-nowrap z-50">
                  {editorTooltip}
                  <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
                </div>
              )}
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
            
            {/* User Section (Cloud Mode only) */}
            {uiSelectedMode === 'cloud' && (
              <>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                
                {!isSignedIn ? (
                  // Not signed in - Show Sign Up / Sign In buttons
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowSignUpModal(true)}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 
                               hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    >
                      Sign Up
                    </button>
                    <button
                      onClick={() => setShowSignInModal(true)}
                      className="px-4 py-1.5 text-sm font-semibold text-white 
                               bg-gradient-to-r from-emerald-500 to-teal-600 
                               hover:from-emerald-600 hover:to-teal-700 
                               dark:from-emerald-400 dark:to-teal-500 
                               dark:hover:from-emerald-500 dark:hover:to-teal-600 
                               rounded-md shadow-md hover:shadow-lg 
                               transition-all duration-200"
                    >
                      Sign In
                    </button>
                  </div>
                ) : (
                  // Signed in - Show user info with dropdown
                  <div className="relative">
                    <button
                      onClick={() => setShowUserMenu(!showUserMenu)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-md 
                               bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 
                               transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {userOrganization}
                        </span>
                        <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        <span className="text-xs font-semibold text-gray-900 dark:text-white">
                          {userEmail?.split('@')[0]}
                        </span>
                      </div>
                    </button>
                    
                    {/* User Menu Dropdown */}
                    {showUserMenu && (
                      <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-gray-800 
                                    rounded-md shadow-lg border border-gray-200 dark:border-gray-700 
                                    py-1 z-50">
                        <button
                          onClick={handleSignOut}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 
                                   hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 
                                   transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          Sign Out
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Auth Modals */}
      <SignUpModal
        isOpen={showSignUpModal}
        onClose={() => setShowSignUpModal(false)}
        onSignUp={handleSignUp}
      />
      
      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
        onSignIn={handleSignIn}
      />
    </header>
  );
}


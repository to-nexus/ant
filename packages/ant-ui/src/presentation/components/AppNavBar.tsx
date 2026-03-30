import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sun, Moon, Monitor, Cloud, Bot, Code2, User, LogOut, Globe } from 'lucide-react';
import { DesktopStatusIndicator } from './DesktopStatusIndicator';
import { useStore } from '@/domain/store';
import { signOut, checkLocalBackend, getBackendMode, getLocalBackendPort } from '@/infrastructure/http/api';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@/i18n';

/**
 * Get OAuth backend base URL
 * OAuth redirect는 전체 URL이 필요하므로 상대경로 대신 절대 URL 반환
 * - local mode: http://localhost:{port} (사용자 설정 포트)
 * - cloud mode: VITE_CLOUD_BACKEND_BASE
 */
function getOAuthBackendBase(): string {
  const mode = getBackendMode();
  
  if (mode === 'cloud') {
    return import.meta.env.VITE_CLOUD_BACKEND_BASE || '';
  }
  
  // local mode: localhost:{port}
  const port = getLocalBackendPort();
  return `http://localhost:${port}`;
}

export interface AppNavBarProps {
  // No props needed - uses hooks directly
}

/**
 * AppNavBar - Top-level navigation bar for the authenticated App (/app/*)
 */
export function AppNavBar({}: AppNavBarProps) {
  const { t } = useTranslation('nav');
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useStore((state) => state.theme);
  const toggleTheme = useStore((state) => state.toggleTheme);
  const language = useStore((state) => state.language);
  const setLanguage = useStore((state) => state.setLanguage);
  const mainView = useStore((state) => state.mainView);
  const setMainView = useStore((state) => state.setMainView);
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const userEmail = useStore((state) => state.userEmail);
  const userOrganization = useStore((state) => state.userOrganization);
  const clearUser = useStore((state) => state.clearUser);
  const reset = useStore((state) => state.reset);
  const backendMode = useStore((state) => state.backendMode);
  const setBackendMode = useStore((state) => state.setBackendMode);
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);
  const setOnboardingSkipped = useStore((state) => state.setOnboardingSkipped);
  const setQuickStartProjectId = useStore((state) => state.setQuickStartProjectId);
  
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [editorTooltip, setEditorTooltip] = useState<string | null>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  
  // Close language menu on outside click
  useEffect(() => {
    if (!showLangMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showLangMenu]);
  
  // Check if user is signed in
  const isSignedIn = !!userEmail && !!userOrganization;
  
  const uiSelectedMode = location.pathname === '/local' ? 'local' : backendMode;
  
  const handleModeChange = async (mode: 'local' | 'cloud') => {
    if (location.pathname === '/local' && mode === 'cloud') {
      setBackendMode('cloud');
      navigate('/');
      
      const fetchProjects = useStore.getState().fetchProjects;
      fetchProjects();
      return;
    }
    
    if (mode === backendMode && location.pathname !== '/local') return;
    
    if (mode === 'local') {
      const isAvailable = await checkLocalBackend();
      
      if (isAvailable) {
        setBackendMode('local');
        
        const fetchProjects = useStore.getState().fetchProjects;
        fetchProjects();
      } else {
        navigate('/local');
      }
      return;
    }
    
    if (mode === 'cloud') {
      setBackendMode('cloud');
      
      if (isSignedIn) {
        const fetchProjects = useStore.getState().fetchProjects;
        fetchProjects();
      }
    }
  };
  
  // Handle Sign In / Sign Up — always redirect to Google OIDC with returnTo=/app/
  const handleSignInClick = () => {
    const backendBase = getOAuthBackendBase();
    window.location.href = `${backendBase}/api/auth/google?returnTo=${encodeURIComponent('/app/')}`;
  };
  
  const handleSignUpClick = () => {
    const backendBase = getOAuthBackendBase();
    window.location.href = `${backendBase}/api/auth/google?returnTo=${encodeURIComponent('/app/')}`;
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

    window.location.href = '/';
  };
  
  // Handle Editor mode switch
  const handleCodeIdeViewSwitch = async () => {
    // ✅ Check if project is selected
    if (!selectedProject) {
                      setEditorTooltip(t('viewMode.selectProjectFirst'));
      setTimeout(() => setEditorTooltip(null), 3000);
      return;
    }
    
    // ✅ Open IDE via ant-cli (project/feature docker) and embed via proxy URL
    try {
      // Show skeleton immediately (avoid "blank iframe" race)
      useStore.getState().setIdeBaseUrl(undefined);
      useStore.getState().setIdeConnecting(true);
      useStore.getState().setIdeFrameLoaded(false);
      useStore.getState().switchToCodeIdeView(`/${selectedProject}`);

      const { startCloudIDE, SERVER_BASE, RESERVED_FEATURE_NAME } = await import('@/infrastructure/http/api');
      const featureName = selectedFeature || RESERVED_FEATURE_NAME;
      const { instance } = await startCloudIDE(selectedProject, featureName);

      // ✅ Use proxy URL (instance.url) instead of directUrl for production
      // Proxy handles SSL and routing through main server
      const proxyUrl = `${SERVER_BASE()}${instance.url}`;
      useStore.getState().setIdeBaseUrl(proxyUrl);
      useStore.getState().setIdeWorkspacePath(instance.workspacePath || `/${selectedProject}`);
      useStore.getState().reloadIdeFrame();
      useStore.getState().setIdeConnecting(false);
      useStore.getState().setIdeFrameLoaded(false);
      useStore.getState().switchToCodeIdeView(instance.workspacePath || `/${selectedProject}`);
    } catch (error: any) {
      console.error('[GlobalNavBar] Failed to open IDE:', error);
      setEditorTooltip(t('viewMode.failedToOpenIde'));
      useStore.getState().setIdeConnecting(false, error?.message || t('viewMode.failedToOpenIde'));
      setTimeout(() => setEditorTooltip(null), 3000);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gray-50 dark:bg-[#0d1117] border-b border-gray-300 dark:border-[#30363d] shadow-md transition-colors">
      <div className="px-2 sm:px-4 py-2 sm:py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-1.5 sm:space-x-3 min-w-0">
            <a href="/" className="flex items-center space-x-1.5 sm:space-x-2 hover:opacity-80 transition-opacity">
              <img 
                src={`${import.meta.env.BASE_URL}${theme === 'dark' ? 'logo-dark.svg' : 'logo-light.svg'}`}
                alt={t('brand.logoAlt')} 
                className="w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0" 
              />
              <h1 className="hidden md:block text-xl font-display font-bold text-gray-900 dark:text-white tracking-tight whitespace-nowrap">ANT Works</h1>
            </a>
            
            {/* Deployment Mode Selector (hidden: only cloud mode active for now) */}
            <div className="deployment-mode-selector hidden items-center gap-1 ml-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
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
                title={uiSelectedMode !== 'local' ? t('deploymentMode.switchToLocal') : t('deploymentMode.currentlyLocal')}
              >
                <Monitor className="w-3.5 h-3.5" />
                {t('deploymentMode.local')}
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
                title={t('deploymentMode.switchToCloud')}
              >
                <Cloud className="w-3.5 h-3.5" />
                {t('deploymentMode.cloud')}
              </button>
            </div>
            
            {/* View Mode Selector */}
            <div className="view-mode-selector flex items-center gap-1 ml-2 sm:ml-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg relative">
              {/* Agents Button */}
              <button
                onClick={() => setMainView('agents')}
                className={`
                  px-1.5 sm:px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 border
                  ${mainView === 'agents'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border-blue-200 dark:border-transparent'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-60 border-transparent'
                  }
                `}
              >
                <Bot className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('viewMode.agents')}</span>
              </button>
              
              {/* Editor Button */}
              <button
                onClick={handleCodeIdeViewSwitch}
                className={`
                  px-1.5 sm:px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 border
                  ${mainView === 'codeIde'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border-blue-200 dark:border-transparent'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-60 border-transparent'
                  }
                `}
                title={selectedProject ? t('viewMode.openEditor') : t('viewMode.selectProjectFirst')}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('viewMode.code')}</span>
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
          
          <div className="flex items-center space-x-1.5 sm:space-x-3">
            {/* Language Selector */}
            <div className="relative" ref={langMenuRef}>
              <button
                onClick={() => setShowLangMenu(!showLangMenu)}
                className="inline-flex items-center gap-1.5 px-1.5 sm:px-2.5 py-1.5 text-xs font-medium rounded-md
                         bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300
                         hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700
                         transition-colors"
                title={t('language.label')}
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{LANGUAGE_LABELS[language]}</span>
              </button>
              {showLangMenu && (
                <div className="absolute top-full right-0 mt-1 w-32 bg-white dark:bg-gray-800 
                              rounded-md shadow-lg border border-gray-200 dark:border-gray-700 
                              py-1 z-50">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      onClick={() => {
                        setLanguage(lang);
                        setShowLangMenu(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm transition-colors flex items-center justify-between
                        ${language === lang 
                          ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300' 
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                    >
                      {LANGUAGE_LABELS[lang]}
                      {language === lang && <span className="text-blue-500">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theme Toggle — icon button on small, sliding toggle on sm+ */}
            <button
              onClick={toggleTheme}
              className="sm:hidden inline-flex items-center justify-center w-8 h-8 rounded-full
                       bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600
                       transition-colors focus:outline-none flex-shrink-0"
              aria-label={t('theme.toggle')}
              title={t('theme.switchTo', { mode: theme === 'light' ? 'dark' : 'light' })}
            >
              {theme === 'light' ? (
                <Sun className="w-4 h-4 text-gray-700" />
              ) : (
                <Moon className="w-4 h-4 text-blue-400" />
              )}
            </button>
            <button
              onClick={toggleTheme}
              className="hidden sm:relative sm:inline-flex items-center h-8 rounded-full w-16 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 bg-gray-300 dark:bg-gray-600 flex-shrink-0"
              aria-label={t('theme.toggle')}
              title={t('theme.switchTo', { mode: theme === 'light' ? 'dark' : 'light' })}
            >
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
            
            <DesktopStatusIndicator />
            
            {/* User Section (Cloud Mode only) */}
            {uiSelectedMode === 'cloud' && (
              <>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                
                {!isSignedIn ? (
                  // Not signed in - Show Sign Up / Sign In buttons
                  <div className="flex items-center gap-1 sm:gap-2">
                    <button
                      onClick={handleSignUpClick}
                      className="hidden sm:block px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 
                               hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    >
                      {t('auth.signUp')}
                    </button>
                    <button
                      onClick={handleSignInClick}
                      className="px-2.5 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold text-white 
                               bg-gradient-to-r from-emerald-500 to-teal-600 
                               hover:from-emerald-600 hover:to-teal-700 
                               dark:from-emerald-400 dark:to-teal-500 
                               dark:hover:from-emerald-500 dark:hover:to-teal-600 
                               rounded-md shadow-md hover:shadow-lg 
                               transition-all duration-200"
                    >
                      {t('auth.signIn')}
                    </button>
                  </div>
                ) : (
                  // Signed in - Show user info with dropdown
                  <div className="relative">
                    <button
                      onClick={() => setShowUserMenu(!showUserMenu)}
                      className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-md 
                               bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 
                               transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="hidden md:inline text-xs font-medium text-gray-500 dark:text-gray-400">
                          {userOrganization}
                        </span>
                        <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        <span className="hidden sm:inline text-xs font-semibold text-gray-900 dark:text-white">
                          {userEmail?.split('@')[0]}
                        </span>
                      </div>
                    </button>
                    
                    {/* User Menu Dropdown */}
                    {showUserMenu && (
                      <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-gray-800 
                                    rounded-md shadow-lg border border-gray-200 dark:border-gray-700 
                                    py-1 z-50">
                        <button
                          onClick={() => {
                            setQuickStartProjectId(undefined);
                            setOnboardingSkipped(true);
                            openMainPanelTab('accountConfig');
                            setShowUserMenu(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 
                                   hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 
                                   transition-colors"
                        >
                          <User className="w-4 h-4" />
                          {t('auth.accountConfig')}
                        </button>
                        <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                        <button
                          onClick={handleSignOut}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 
                                   hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 
                                   transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          {t('auth.signOut')}
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
      
    </header>
  );
}


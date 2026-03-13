import { ChevronLeft, LogIn } from 'lucide-react';
import { Bar } from '../Bar';
import { ProjectSection } from '../ProjectSection';
import { FeatureSection } from '../FeatureSection';
import { ArtifactsPanel } from '../ArtifactsPanel';
import { QuickStartCTA } from '../common/QuickStartCTA';
import { useStore } from '@/domain/store';
import { useTranslation } from 'react-i18next';

interface ExplorerPanelProps {
  isCollapsed: boolean;
  width: number;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  onCollapse: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function ExplorerPanel({
  isCollapsed,
  width,
  connectionStatus,
  onCollapse,
  onResizeStart,
}: ExplorerPanelProps) {
  const { t } = useTranslation(['explorer', 'onboarding']);
  const backendMode = useStore((state) => state.backendMode);
  const userEmail = useStore((state) => state.userEmail);
  const projects = useStore((state) => state.projects);
  const onboardingSkipped = useStore((state) => state.onboardingSkipped);
  const setOnboardingSkipped = useStore((state) => state.setOnboardingSkipped);
  
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
              title={t('panel.collapse')}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-gray-700 dark:text-gray-200 font-medium">📁 {t('panel.title')}</span>
          </>
        ),
        right: undefined
      })}
      
      <div className="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        {!isAuthenticated ? (
          <div className="text-center text-gray-400 dark:text-gray-500 mt-8">
            <div className="text-4xl mb-2">
              <LogIn className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600" />
            </div>
            <div className="text-sm font-medium mb-1">{t('panel.signInRequired')}</div>
            <div className="text-xs text-gray-400 dark:text-gray-600">
              {t('panel.signInHint')}
            </div>
          </div>
        ) : connectionStatus === 'connected' ? (
          <>
            <ProjectSection explorerWidth={width} />
            <FeatureSection explorerWidth={width} />
            <ArtifactsPanel explorerWidth={width} />

            {onboardingSkipped && projects.length === 0 && (
              <div className="mt-4 mx-1 space-y-2">
                <QuickStartCTA
                  variant="plan"
                  title={t('onboarding:quickstart.fleshOutIdea')}
                  hint={t('onboarding:quickstart.fleshOutIdeaHint')}
                  onClick={() => setOnboardingSkipped(false)}
                />
                <QuickStartCTA
                  variant="design"
                  title={t('onboarding:quickstart.designSystem')}
                  hint={t('onboarding:quickstart.designSystemHint')}
                  onClick={() => useStore.getState().setProjectSetupConfig({ mode: 'design' })}
                />
                <QuickStartCTA
                  variant="code"
                  title={t('onboarding:quickstart.codeFromDesign')}
                  hint={t('onboarding:quickstart.codeFromDesignHint')}
                  onClick={() => useStore.getState().setProjectSetupConfig({ mode: 'code' })}
                />
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-gray-400 dark:text-gray-500 mt-8">
            <div className="text-4xl mb-2">🔌</div>
            <div className="text-sm">
              {connectionStatus === 'error' ? t('connection.error') : t('connection.disconnected')}
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


import { ChevronLeft, LogIn, Sparkles } from 'lucide-react';
import { Bar } from '../Bar';
import { ProjectSection } from '../ProjectSection';
import { FeatureSection } from '../FeatureSection';
import { ArtifactsPanel } from '../ArtifactsPanel';
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
            <ProjectSection />
            <FeatureSection />
            <ArtifactsPanel explorerWidth={width} />

            {/* ✅ Onboarding return card — when workspace is empty and user skipped onboarding */}
            {onboardingSkipped && projects.length === 0 && (
              <div className="mt-4 mx-1">
                <button
                  onClick={() => setOnboardingSkipped(false)}
                  className="w-full flex items-center gap-3 px-3 py-3
                             bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30
                             border border-emerald-200 dark:border-emerald-800/50 rounded-xl
                             text-sm text-emerald-700 dark:text-emerald-300
                             hover:from-emerald-100 hover:to-teal-100 dark:hover:from-emerald-950/50 dark:hover:to-teal-950/50
                             hover:shadow-sm transition-all duration-200 group"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 group-hover:scale-105 transition-transform">
                    <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{t('onboarding:quickstart.goToOnboarding')}</div>
                    <div className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                      {t('onboarding:quickstart.goToOnboardingHint')}
                    </div>
                  </div>
                </button>
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


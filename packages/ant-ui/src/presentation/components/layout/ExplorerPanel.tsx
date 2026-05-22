import { ChevronLeft, LogIn } from 'lucide-react';
import { Bar } from '../Bar';
import { ProjectSection } from '../ProjectSection';
import { FeatureSection } from '../FeatureSection';
import { ArtifactsPanel } from '../ArtifactsPanel';
import { QuickStartCTA } from '../common/QuickStartCTA';
import { useStore } from '@/domain/store';
import { selectServerMode } from '@/domain/store/selectors/auth';
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
  const serverMode = useStore((state) => selectServerMode(state));
  const userEmail = useStore((state) => state.userEmail);
  const projects = useStore((state) => state.projects);
  const onboardingSkipped = useStore((state) => state.onboardingSkipped);
  const setOnboardingSkipped = useStore((state) => state.setOnboardingSkipped);

  // Check authentication status (serverMode unresolved → treat as cloud).
  const isAuthenticated = serverMode === 'local' || !!userEmail;
  
  if (isCollapsed) return null;

  return (
    <aside
      className="flex flex-col overflow-hidden shrink-0 relative"
      style={{
        width: `${width}px`,
        background: 'var(--surface-1)',
        borderRight: '1px solid var(--border-1)',
        boxShadow: 'var(--shadow-1)',
        transition: 'background 200ms ease, border-color 200ms ease',
      }}
    >
      {/* Explorer Bar */}
      {Bar.render({
        left: (
          <>
            <button
              onClick={onCollapse}
              className="flex items-center justify-center w-10 h-10 -ml-4 -my-4"
              style={{ color: 'var(--text-3)', background: 'transparent' }}
              title={t('panel.collapse')}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>📁 {t('panel.title')}</span>
          </>
        ),
        right: undefined
      })}

      <div
        className="flex-1 px-3 py-3 space-y-3 overflow-y-auto"
        style={{ background: 'var(--surface-1)' }}
      >
        {!isAuthenticated ? (
          <div className="text-center mt-8" style={{ color: 'var(--text-3)' }}>
            <div className="mb-2">
              <LogIn className="w-12 h-12 mx-auto" style={{ color: 'var(--text-3)', opacity: 0.5 }} />
            </div>
            <div className="text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>{t('panel.signInRequired')}</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
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
                {/* TEMP(action-system-compat): hide design/code CTAs until ProjectWizardModal is compatible.
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
                */}
              </div>
            )}
          </>
        ) : (
          <div className="text-center mt-8" style={{ color: 'var(--text-3)' }}>
            <div className="text-4xl mb-2">🔌</div>
            <div className="text-sm">
              {connectionStatus === 'error' ? t('connection.error') : t('connection.disconnected')}
            </div>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-ew-resize z-10"
        style={{ background: 'transparent' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--violet-500)'; (e.currentTarget as HTMLDivElement).style.opacity = '0.5'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
        onMouseDown={onResizeStart}
      />
    </aside>
  );
}


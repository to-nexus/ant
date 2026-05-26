import { Lock, AlertTriangle, Menu } from 'lucide-react';
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
      }}
    >
      {/* Explorer Bar — handoff B3 ExplorerPanel header layout */}
      {Bar.render({
        left: (
          <>
            <span style={{ fontSize: 14, lineHeight: 1 }}>📁</span>
            <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{t('panel.title')}</span>
          </>
        ),
        right: (
          <button
            type="button"
            onClick={onCollapse}
            title={t('panel.collapse')}
            aria-label={t('panel.collapse')}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              color: 'var(--text-3)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <Menu size={14} />
          </button>
        ),
      })}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 8px',
          minHeight: 0,
          background: 'var(--surface-1)',
        }}
      >
        {!isAuthenticated ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '40px 20px',
              gap: 10,
              color: 'var(--text-3)',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'var(--gradient-aurora-soft)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--violet-700)',
              }}
            >
              <Lock size={22} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
              {t('panel.signInRequired')}
            </div>
            <div style={{ fontSize: 11, maxWidth: 220, color: 'var(--text-3)' }}>
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
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '40px 20px',
              gap: 10,
              color: 'var(--text-3)',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'color-mix(in srgb, var(--orange-500) 14%, transparent)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--orange-600)',
              }}
            >
              <AlertTriangle size={22} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
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


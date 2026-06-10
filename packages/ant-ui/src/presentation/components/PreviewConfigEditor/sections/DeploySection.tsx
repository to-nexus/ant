import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Rocket,
  AlertCircle,
  Square,
  ArrowRight,
  Moon,
  Box,
  Globe,
  Lock,
} from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type { DeployStatus, DeployLogEntry, DeployVisibility } from '@/infrastructure/http/api';
import type { DeployDisabledReason } from '../../FeatureSection/hooks/useDeployManager';
import { BoardViewModeToggle } from '@/presentation/components/aurora/BoardViewModeToggle';
import {
  SectionCard,
  SignalRing,
} from '@/presentation/components/ConfigEditor/aurora';
import type { SignalRingState } from '@/presentation/components/ConfigEditor/aurora';

interface DeployAccent {
  color: string;
  label: string;
  ring: SignalRingState;
}

function c3vDeployAccent(
  phase: string | undefined,
  t: TFunction,
): DeployAccent {
  switch (phase) {
    case 'running':
      return {
        color: 'oklch(45% 0.16 155)',
        label: t('preview.deploy.running', 'Deployed'),
        ring: 'running',
      };
    case 'building':
      return {
        color: 'var(--violet-700)',
        label: t('preview.deploy.building', 'Building...'),
        ring: 'starting',
      };
    case 'deploying':
      return {
        color: 'oklch(50% 0.20 320)',
        label: t('preview.deploy.deploying', 'Deploying...'),
        ring: 'starting',
      };
    case 'starting':
      return {
        color: 'oklch(50% 0.22 270)',
        label: t('preview.deploy.starting', 'Waking up...'),
        ring: 'starting',
      };
    case 'hibernated':
      return {
        color: 'var(--text-3)',
        label: t('preview.deploy.hibernated', 'Hibernated'),
        ring: 'hibernated',
      };
    case 'unavailable':
      return {
        color: 'oklch(50% 0.16 50)',
        label: t('preview.deploy.unavailable', 'Artifact missing'),
        ring: 'warning',
      };
    case 'error':
      return {
        color: 'var(--status-error-fg)',
        label: t('preview.deploy.error', 'Deploy Failed'),
        ring: 'error',
      };
    default:
      return {
        color: 'var(--text-4)',
        label: t('preview.deploy.idle', 'Not deployed'),
        ring: 'idle',
      };
  }
}

function bigBtn({
  bg,
  fg,
  glow,
  border,
  disabled,
}: {
  bg: string;
  fg: string;
  glow?: string;
  border?: string;
  disabled?: boolean;
}): React.CSSProperties {
  return {
    height: 36,
    padding: '0 14px',
    borderRadius: 'var(--r-md)',
    fontSize: 12.5,
    fontWeight: 700,
    border: border ?? 'none',
    background: bg,
    color: fg,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
    boxShadow: glow ?? 'none',
    letterSpacing: '-0.005em',
  };
}

export function DeploySection({
  deployStatus,
  deployLogs,
  isDeployLoading,
  canDeploy,
  disabledReason,
  onDeploy,
  onStopDeploy,
  onOpenDeployUrl,
}: {
  deployStatus: DeployStatus | undefined;
  deployLogs: DeployLogEntry[];
  isDeployLoading: boolean;
  /**
   * False when the backend would reject a deploy request (no feature
   * selected, or a `code` job is actively writing the source tree).
   * Derived by `useDeployManager`; button stays disabled with a tooltip.
   */
  canDeploy: boolean;
  disabledReason: DeployDisabledReason | undefined;
  onDeploy: (visibility: DeployVisibility) => void;
  onStopDeploy: () => void;
  /**
   * Open a deploy URL in a new tab.
   *
   * Pass an explicit `url` for multi-package per-package buttons. No-arg
   * call uses the top-level representative URL (single-package back-compat).
   */
  onOpenDeployUrl: (url?: string) => void;
}) {
  const { t } = useTranslation('explorer');

  // Visibility chosen for the NEXT deploy. Seeds from the current deploy's
  // visibility (so a re-deploy keeps the prior choice), default public.
  const [selectedVisibility, setSelectedVisibility] = useState<DeployVisibility>(
    deployStatus?.visibility ?? 'public',
  );

  const phase = deployStatus?.phase;

  // Active = a static server process owns a port on some pod
  const isRunning = phase === 'running';
  const isWorking = phase === 'building' || phase === 'deploying' || phase === 'starting';
  const isHibernated = phase === 'hibernated';
  const isUnavailable = phase === 'unavailable';
  const isError = phase === 'error';
  const isDeployActive = isRunning || isWorking;

  // deployLogs reserved for a future Aurora deploy console; not rendered here.
  void deployLogs;

  const accent = c3vDeployAccent(phase, t);

  const primaryButtonLabel = isUnavailable
    ? t('preview.deploy.redeploy', 'Re-deploy')
    : t('preview.deploy.deploy', 'Deploy');

  const disabledTooltip = (() => {
    if (canDeploy) return undefined;
    if (disabledReason === 'no-feature-selected') {
      return t('preview.deploy.disabled.noFeatureSelected', 'Select a feature branch to deploy');
    }
    if (disabledReason === 'code-job-active') {
      return t(
        'preview.deploy.disabled.codeJobActive',
        'A code job is running on this feature. Deploy is available once it completes.',
      );
    }
    return undefined;
  })();

  const statusSlot = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <SignalRing state={accent.ring} size={8} />
      <span style={{ fontSize: 11, fontWeight: 700, color: accent.color }}>
        {accent.label}
      </span>
    </span>
  );

  const openable = (deployStatus?.packages || []).filter((p) => !!p.url);
  const singleOpenUrl =
    openable.length <= 1
      ? deployStatus?.url ?? openable[0]?.url ?? null
      : null;
  const showSingleOpen =
    (isRunning || isHibernated) && openable.length <= 1 && !!singleOpenUrl;
  const showMultiOpen =
    (isRunning || isHibernated) && openable.length > 1;

  return (
    <SectionCard
      icon="Zap"
      title={t('preview.deploy.title', 'Deploy')}
      description={t(
        'preview.deploy.description',
        'Build and serve a production-optimized static version of your project.',
      )}
      accent="aurora"
      status={statusSlot}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {!isDeployActive && (
          <BoardViewModeToggle<DeployVisibility>
            value={selectedVisibility}
            onChange={setSelectedVisibility}
            options={[
              { id: 'public', label: t('preview.deploy.visibility.public', 'Public'), icon: Globe },
              { id: 'private', label: t('preview.deploy.visibility.private', 'Private'), icon: Lock },
            ]}
            ariaLabel={t('preview.deploy.visibility.label', 'Deploy visibility')}
          />
        )}
        {(isRunning || isHibernated) && deployStatus?.visibility === 'private' && (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--text-3)' }}
            title={t('preview.deploy.visibility.privateHint', 'Only you can access this deploy')}
          >
            <Lock size={12} strokeWidth={2} />
            {t('preview.deploy.visibility.private', 'Private')}
          </span>
        )}
        {!isDeployActive ? (
          <button
            type="button"
            onClick={() => onDeploy(selectedVisibility)}
            disabled={isDeployLoading || !canDeploy}
            title={disabledTooltip}
            style={
              isDeployLoading || !canDeploy
                ? bigBtn({
                    bg: 'var(--bg-surface-2)',
                    fg: 'var(--text-4)',
                    border: '1px solid var(--border-2)',
                    disabled: true,
                  })
                : bigBtn({
                    bg: 'var(--gradient-aurora)',
                    fg: 'white',
                    glow: '0 6px 18px -6px oklch(55% 0.20 290 / 0.5)',
                  })
            }
          >
            {isDeployLoading ? (
              <Spinner size="sm" tone="inherit" />
            ) : (
              <Rocket size={14} strokeWidth={2} />
            )}
            {primaryButtonLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStopDeploy}
            style={bigBtn({
              bg: 'linear-gradient(135deg, oklch(60% 0.20 25), oklch(58% 0.22 15))',
              fg: 'white',
              glow: '0 6px 18px -6px oklch(55% 0.20 25 / 0.55)',
            })}
          >
            <Square size={14} strokeWidth={2} />
            {t('preview.deploy.stop', 'Stop')}
          </button>
        )}
      </div>

      {!canDeploy && disabledTooltip && (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 11,
            color: 'var(--text-4)',
            fontStyle: 'italic',
          }}
        >
          ⓘ {disabledTooltip}
        </p>
      )}

      {/* Single Open chip */}
      {showSingleOpen && singleOpenUrl && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--border-1)',
          }}
        >
          <DeployUrlChip
            label={
              isHibernated
                ? t('preview.deploy.wake', 'Wake up')
                : t('preview.deploy.open', 'Open')
            }
            url={singleOpenUrl}
            onOpen={() => onOpenDeployUrl(singleOpenUrl)}
            hibernated={isHibernated}
            big
          />
        </div>
      )}

      {/* Multi-package chip grid */}
      {showMultiOpen && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--border-1)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          {openable.map((pkg) => (
            <DeployUrlChip
              key={pkg.slug || pkg.name}
              label={pkg.name}
              url={pkg.url as string}
              onOpen={() => onOpenDeployUrl(pkg.url || undefined)}
              hibernated={isHibernated}
            />
          ))}
        </div>
      )}

      {isError && deployStatus?.error && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: 10,
            background: 'var(--status-error-bg)',
            border: '1px solid oklch(82% 0.12 25)',
            borderRadius: 'var(--r-md)',
            color: 'var(--status-error-fg)',
          }}
        >
          <AlertCircle size={13} style={{ marginTop: 2, flexShrink: 0 }} />
          <p
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {deployStatus.error}
          </p>
        </div>
      )}

      {isUnavailable && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: 'oklch(94% 0.06 50 / 0.6)',
            border: '1px solid oklch(82% 0.10 50)',
            borderRadius: 'var(--r-md)',
            color: 'oklch(50% 0.16 50)',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {deployStatus?.error || t('preview.deploy.unavailable', 'Artifact missing')}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function DeployUrlChip({
  label,
  url,
  onOpen,
  hibernated,
  big = false,
}: {
  label: string;
  url: string;
  onOpen: () => void;
  hibernated: boolean;
  big?: boolean;
}) {
  const grad = hibernated
    ? 'var(--gradient-cool)'
    : 'var(--gradient-aurora)';
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: big ? '12px 14px' : '10px 12px',
        background: 'var(--bg-surface)',
        border: '1.5px solid var(--violet-300)',
        borderRadius: 'var(--r-md)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: '0 2px 6px -3px oklch(55% 0.18 290 / 0.18)',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: 26,
          height: 26,
          borderRadius: 'var(--r-sm)',
          background: grad,
          color: 'white',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Box size={12} strokeWidth={2.5} />
        {hibernated && (
          <Moon
            size={10}
            strokeWidth={2.2}
            style={{
              position: 'absolute',
              right: -3,
              bottom: -3,
              background: 'var(--bg-surface)',
              color: 'var(--text-3)',
              borderRadius: '50%',
              padding: 1,
            }}
          />
        )}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text-1)',
            letterSpacing: '-0.005em',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={url}
        >
          {url}
        </span>
      </span>
      <ArrowRight
        size={14}
        strokeWidth={2}
        style={{ color: 'var(--text-3)', flexShrink: 0 }}
      />
    </button>
  );
}

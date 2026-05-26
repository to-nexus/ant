
import { AlertTriangle } from 'lucide-react';
import { Tooltip } from '@/presentation/components/common/Tooltip';

const FIGMA_BADGE_BASE: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 3,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 9,
  fontWeight: 800,
  flexShrink: 0,
};

interface FigmaStatusIndicatorProps {
  isPopulated: boolean | null;
  bridgeConnected: boolean;
  figmaDesktopReachable: boolean;
  onOpenSettings: () => void;
  t: (key: string) => string;
}

export function FigmaStatusIndicator({
  isPopulated,
  bridgeConnected,
  figmaDesktopReachable,
  onOpenSettings,
  t,
}: FigmaStatusIndicatorProps) {
  if (isPopulated === null) return null;

  if (!isPopulated) {
    return (
      <Tooltip content={t('panel.figmaEmpty')} placement="right">
        <span className="inline-flex items-center flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        </span>
      </Tooltip>
    );
  }

  const isFullyConnected = bridgeConnected && figmaDesktopReachable;

  if (isFullyConnected) {
    return (
      <Tooltip content={t('panel.figmaConnected')} placement="right">
        <span
          title={t('panel.figmaConnected')}
          style={{
            ...FIGMA_BADGE_BASE,
            background:
              'linear-gradient(135deg, oklch(70% 0.18 25), oklch(72% 0.18 290))',
            color: 'white',
          }}
        >
          F
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      content={
        <div className="space-y-1.5">
          <div>{t('panel.figmaNotConnected')}</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings();
            }}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            {t('panel.goToAccountSettings')}
          </button>
        </div>
      }
      placement="right"
    >
      <span
        style={{
          ...FIGMA_BADGE_BASE,
          background: 'oklch(70% 0.04 290)',
          color: 'var(--text-4)',
          opacity: 0.4,
          cursor: 'pointer',
        }}
      >
        F
      </span>
    </Tooltip>
  );
}

interface TemplateStatusIndicatorProps {
  reason?: string;
  contentLength?: number;
  threshold?: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export function TemplateStatusIndicator({
  reason,
  contentLength,
  threshold,
  t,
}: TemplateStatusIndicatorProps) {
  let tooltipContent: string;
  if (reason === 'marker_and_short_content' && contentLength !== undefined && threshold !== undefined) {
    tooltipContent = t('panel.templateReasonMarker', { contentLength, threshold });
  } else if (reason === 'file_empty') {
    tooltipContent = t('panel.templateReasonEmpty');
  } else {
    tooltipContent = t('panel.templateFile');
  }

  return (
    <Tooltip content={tooltipContent} placement="right">
      <span className="inline-flex items-center flex-shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
      </span>
    </Tooltip>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import type { ContextCarryoverEstimate } from '@ant/shared';
import { useStore } from '@/domain/store';
import { useAsyncResource } from '@/presentation/components/common/async';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import { ContextLensPanel } from './ContextLensPanel';

interface FeatureContextGaugeProps {
  projectId: string;
  featureName: string;
}

/**
 * Carry-over memory gauge (Context Lens E2-4, F2).
 *
 * Semantics — deliberately DIFFERENT from the TurnTokenRing next to the
 * chat input: the ring is the CURRENT LLM call's prompt occupancy
 * (per-call); this gauge is the distilled memory that will transfer to
 * the NEXT job (cross-job), measured against FEATURE_CONTEXT_THRESHOLD.
 * The tooltip spells this out (mirrors `turnTokenGauge.semanticsNote`).
 *
 * Data: `featureLog.contextEstimate` (AsyncFields). Refreshed on feature
 * switch (useFeatureLogSync) and on terminal job SSE (chatSseHandler) —
 * no polling. Non-ready states render nothing: this is a passive ambient
 * indicator inside the 40px header, not a fetch surface.
 *
 * Click toggles the Context panel (band bodies + pin).
 */
export function FeatureContextGauge({ projectId, featureName }: FeatureContextGaugeProps) {
  const { t } = useTranslation('chat');
  const estimate = useAsyncResource<ContextCarryoverEstimate>((s) => s.contextEstimate);
  const loadContextLens = useStore((s) => s.loadContextLens);

  const [panelOpen, setPanelOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [panelOpen]);

  // Identity change closes the panel (stale bands must not linger).
  useEffect(() => {
    setPanelOpen(false);
  }, [projectId, featureName]);

  if (estimate.status !== 'ready') return null;
  const { estimatedTokens, capTokens } = estimate.data;
  const pct = capTokens > 0 ? Math.min(100, Math.round((estimatedTokens / capTokens) * 100)) : 0;

  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    if (next) void loadContextLens(projectId, featureName);
  };

  return (
    <div ref={hostRef} className="relative flex items-center" style={{ flexShrink: 0 }}>
      <Tooltip
        content={
          <div className="max-w-[240px] text-xs" style={{ color: 'var(--text-2)' }}>
            <div className="font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
              {t('contextLens.gaugeTooltipTitle')}
            </div>
            <div className="tabular-nums mb-1">
              {t('contextLens.gaugeTooltipBody', {
                tokens: formatTokens(estimatedTokens),
                cap: formatTokens(capTokens),
              })}
            </div>
            <div style={{ color: 'var(--text-3)' }}>{t('contextLens.gaugeSemantics')}</div>
          </div>
        }
        placement="bottom"
      >
        <button
          type="button"
          onClick={togglePanel}
          aria-label={t('contextLens.gaugeAria')}
          aria-expanded={panelOpen}
          className="flex items-center gap-1.5 hover:bg-[color:var(--bg-hover)] transition-colors"
          style={{
            height: 22,
            padding: '0 8px',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border-1)',
            background: panelOpen ? 'var(--bg-hover)' : 'var(--bg-surface)',
            color: 'var(--text-2)',
          }}
        >
          <Layers size={11} strokeWidth={2.2} style={{ color: 'var(--violet-600)' }} aria-hidden="true" />
          <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 600 }}>
            {formatTokens(estimatedTokens)}
          </span>
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 3,
              borderRadius: 2,
              background: 'var(--border-1)',
              overflow: 'hidden',
              display: 'inline-block',
            }}
          >
            <span
              style={{
                display: 'block',
                width: `${pct}%`,
                height: '100%',
                borderRadius: 2,
                background: 'var(--gradient-aurora)',
                transition: 'width var(--dur-fast) var(--ease-smooth)',
              }}
            />
          </span>
        </button>
      </Tooltip>

      {panelOpen && (
        <ContextLensPanel
          projectId={projectId}
          featureName={featureName}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}

/** 3120 → "3.1k", 980 → "980". */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

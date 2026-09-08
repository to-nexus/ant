/**
 * The authored directive, with every `{{…}}` occurrence shown as the words it
 * means. Read-only and derived — the textarea above stays the single buffer
 * holding the real YAML bytes; this only makes an already-written directive
 * legible. Renders nothing when the text carries no token, so a plain
 * directive costs no space.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineDef } from '@ant/shared';
import { FieldHint } from '../../ConfigEditor/aurora';
import { HintBadge } from '../../common/HintBadge';
import { resolveStepIdentity, type IdentityAgentSummary } from '../stepIdentity';
import { hasTokens, segmentTemplate } from '../templateTokens';
import { TokenPill } from './chips';

export function TemplatePreview({ text, def, agents }: { text: string; def: PipelineDef; agents: IdentityAgentSummary[] | undefined }) {
  const { t } = useTranslation('pipelines');
  const segments = useMemo(() => segmentTemplate(text), [text]);
  const stepIds = useMemo(() => new Set(def.steps.map((st) => st.id)), [def.steps]);
  if (!hasTokens(segments)) return null;
  // A dangling step ref is as broken as a typo — the validator refuses both,
  // so one flag covers both for the warning below.
  const broken = segments.some((seg) => seg.kind === 'unknown' || (seg.kind === 'stepOutput' && !stepIds.has(seg.stepId)));

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }}>{t('step.templatePreview', 'Preview')}</span>
        <HintBadge isCompact label={t('step.templatePreview', 'Preview')} tooltip={t('step.templatePreviewHint', 'Each variable becomes its real value when the run is dispatched.')} />
      </div>
      <div
        style={{
          padding: '8px 10px',
          borderRadius: 'var(--r-md)',
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-1)',
          fontSize: 12,
          lineHeight: 1.9,
          color: 'var(--text-2)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {segments.map((seg, i) => {
          if (seg.kind === 'text') return <span key={i}>{seg.text}</span>;
          if (seg.kind === 'static') {
            return (
              <TokenPill key={i} tone="static" icon={seg.spec.icon} title={`${seg.raw}\n${t(seg.spec.hintKey, seg.spec.hintFallback)}`}>
                {t(seg.spec.faceKey, seg.spec.faceFallback)}
              </TokenPill>
            );
          }
          if (seg.kind === 'stepOutput') {
            const source = def.steps.find((st) => st.id === seg.stepId);
            const face = t(seg.spec.faceKey, seg.spec.faceFallback);
            if (!source) {
              return (
                <TokenPill key={i} tone="unknown" icon={seg.spec.icon} title={`${seg.raw}\n${t('step.tokenUnknownStep', 'Points at a step that does not exist')}`}>
                  {`${seg.stepId} · ${face}`}
                </TokenPill>
              );
            }
            const name = resolveStepIdentity(source, agents, t).primary;
            return (
              <TokenPill key={i} tone="stepOutput" icon={seg.spec.icon} title={`${seg.raw}\n${t(seg.spec.hintKey, seg.spec.hintFallback)}`}>
                {`${name} · ${face}`}
              </TokenPill>
            );
          }
          return (
            <TokenPill key={i} tone="unknown" title={`${seg.raw}\n${t('step.tokenUnknown', 'Unknown variable — this will not save')}`}>
              {seg.name || seg.raw}
            </TokenPill>
          );
        })}
      </div>
      {broken && <FieldHint tone="warn">{t('step.tokenUnknown', 'Unknown variable — this will not save')}</FieldHint>}
    </div>
  );
}

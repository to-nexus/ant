/**
 * The advisory lifecycle of the selected definition, behind a HEADER badge:
 * open (amber — fix it, or acknowledge it with a reason), acknowledged (the
 * reason, removable), stale (an acknowledgement whose finding no longer
 * fires — cleanup). Never blocking: these are findings a person weighs, and
 * the badge count is the OPEN count, so zero is a reachable goal.
 *
 * Live items come from the shared resolver over the draft; `saved` items are
 * what the server answered on the last read or save and the FE catalog could
 * not see. A popover, not a strip — a strip that appears and grows resizes
 * the canvas twice.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import type { PipelineAcknowledgement, PipelineAdvisory, PipelineAdvisoryCode } from '@ant/shared';
import { Badge, Button, Textarea } from '../aurora';
import { Tooltip } from '../common/Tooltip';

export interface AdvisoryStripItem extends PipelineAdvisory {
  id: string;
  source: 'live' | 'saved';
  /** Present on acknowledged items. */
  reason?: string;
}

export interface AdvisoryView {
  open: AdvisoryStripItem[];
  acknowledged: AdvisoryStripItem[];
  stale: PipelineAcknowledgement[];
}

export const EMPTY_ADVISORY_VIEW: AdvisoryView = { open: [], acknowledged: [], stale: [] };

export interface AdvisoryActions {
  onSelectStep?: (stepId: string) => void;
  /** Absent while the definition is not editable — the controls hide. */
  onAcknowledge?: (code: PipelineAdvisoryCode, step: string, reason: string) => void;
  onUnacknowledge?: (code: PipelineAdvisoryCode, step: string) => void;
}

const rowText: React.CSSProperties = { fontSize: 12, lineHeight: 1.55, color: 'var(--text-2)', overflowWrap: 'anywhere', textAlign: 'left' };

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--text-3)', marginTop: 4 }}>{children}</div>;
}

/** Inline reason form — the GateDecisionForm shape: a textarea and confirm/back. */
function AcknowledgeForm({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const { t } = useTranslation('pipelines');
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('advisory.ackReasonPlaceholder', 'Why this shape is right for this flow — saved with the definition')}
        rows={2}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="xs" variant="primary" disabled={reason.trim().length === 0} onClick={() => onConfirm(reason)}>
          {t('advisory.ackConfirm', 'Acknowledge')}
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>
          {t('advisory.ackCancel', 'Back')}
        </Button>
      </div>
    </div>
  );
}

function OpenRow({ item, actions }: { item: AdvisoryStripItem; actions: AdvisoryActions }) {
  const { t } = useTranslation('pipelines');
  const [acking, setAcking] = useState(false);
  const clickable = !!item.stepId && !!actions.onSelectStep;
  const canAck = !!item.stepId && !!actions.onAcknowledge;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {item.source === 'saved' && (
          <Badge size="sm" tone="warning" title={t('advisory.savedHint', 'Returned by the server on the last read or save')}>
            {t('advisory.saved', 'Server')}
          </Badge>
        )}
        <button
          type="button"
          disabled={!clickable}
          onClick={() => item.stepId && actions.onSelectStep?.(item.stepId)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: clickable ? 'pointer' : 'default', flex: 1, ...rowText }}
        >
          {item.message}
        </button>
      </div>
      {canAck && !acking && (
        <div>
          <Button size="xs" variant="ghost" onClick={() => setAcking(true)}>
            {t('advisory.ackAction', 'Acknowledge as by-design…')}
          </Button>
        </div>
      )}
      {acking && (
        <AcknowledgeForm
          onConfirm={(reason) => {
            actions.onAcknowledge?.(item.code, item.stepId!, reason);
            setAcking(false);
          }}
          onCancel={() => setAcking(false)}
        />
      )}
    </div>
  );
}

export function AdvisoryList({ view, actions }: { view: AdvisoryView; actions: AdvisoryActions }) {
  const { t } = useTranslation('pipelines');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 340, maxHeight: 360, overflowY: 'auto', textAlign: 'left' }}>
      {view.open.length > 0 && (
        <>
          <GroupHeading>{t('advisory.open', 'Open — fix, or acknowledge with a reason')}</GroupHeading>
          {view.open.map((item) => (
            <OpenRow key={item.id} item={item} actions={actions} />
          ))}
        </>
      )}
      {view.acknowledged.length > 0 && (
        <>
          <GroupHeading>{t('advisory.acknowledged', 'Acknowledged as by-design')}</GroupHeading>
          {view.acknowledged.map((item) => (
            <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ ...rowText, color: 'var(--text-3)' }}>{item.message}</span>
              <span style={{ ...rowText, color: 'var(--text-1)' }}>
                <CheckCircle2 size={11} style={{ verticalAlign: -1, marginRight: 4, color: 'var(--emerald-500)' }} />
                {item.reason}
              </span>
              {actions.onUnacknowledge && item.stepId && (
                <div>
                  <Button size="xs" variant="ghost" onClick={() => actions.onUnacknowledge?.(item.code, item.stepId!)}>
                    {t('advisory.unack', 'Reopen')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {view.stale.length > 0 && (
        <>
          <GroupHeading>{t('advisory.stale', 'No longer fires — remove the acknowledgement')}</GroupHeading>
          {view.stale.map((a) => (
            <div key={`${a.code}:${a.step}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ ...rowText, color: 'var(--text-3)', flex: 1 }}>
                <code style={{ fontSize: 11 }}>{a.code}</code> · {a.step} — {a.reason}
              </span>
              {actions.onUnacknowledge && (
                <Button size="xs" variant="ghost" onClick={() => actions.onUnacknowledge?.(a.code, a.step)}>
                  {t('advisory.removeStale', 'Remove')}
                </Button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Header badge — `⚠ n` open, or `✓ n` when everything is acknowledged. Renders nothing when there is nothing. */
export function AdvisoryBadge({ view, actions }: { view: AdvisoryView; actions: AdvisoryActions }) {
  const { t } = useTranslation('pipelines');
  const total = view.open.length + view.acknowledged.length + view.stale.length;
  if (total === 0) return null;
  const openOnly = view.open.length > 0;
  return (
    <Tooltip
      content={<AdvisoryList view={view} actions={actions} />}
      placement="bottom"
      surface={openOnly ? 'var(--intent-amber-bg)' : undefined}
      borderColor={openOnly ? 'var(--amber-500)' : undefined}
    >
      <Badge
        tone={openOnly ? 'warning' : 'neutral'}
        size="sm"
        style={{ flexShrink: 0, cursor: 'pointer' }}
        title={
          openOnly
            ? t('advisory.title', '{{n}} open advisories', { n: view.open.length })
            : t('advisory.titleAcknowledged', '{{n}} acknowledged advisories', { n: view.acknowledged.length + view.stale.length })
        }
      >
        {openOnly ? <TriangleAlert size={10} style={{ marginRight: 3 }} /> : <CheckCircle2 size={10} style={{ marginRight: 3 }} />}
        {openOnly ? view.open.length : view.acknowledged.length + view.stale.length}
      </Badge>
    </Tooltip>
  );
}

/** Header badge for catalog-binding findings — these hard-fail enable, so they are red, not amber. */
export function BlockingFindingsBadge({ findings }: { findings: string[] }) {
  const { t } = useTranslation('pipelines');
  if (findings.length === 0) return null;
  return (
    <Tooltip
      content={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 320, textAlign: 'left' }}>
          <span style={{ ...rowText, color: 'var(--text-3)' }}>{t('advisory.blockingHint', 'Publishing is refused until these resolve against your agent catalog.')}</span>
          {findings.map((f) => (
            <span key={f} style={rowText}>
              {f}
            </span>
          ))}
        </div>
      }
      placement="bottom"
    >
      <Badge tone="error" size="sm" style={{ flexShrink: 0, cursor: 'pointer' }} title={t('advisory.blocking', '{{n}} blocking', { n: findings.length })}>
        <TriangleAlert size={10} style={{ marginRight: 3 }} />
        {t('advisory.blocking', '{{n}} blocking', { n: findings.length })}
      </Badge>
    </Tooltip>
  );
}

/**
 * ApproverRunPanel — the approver's ENTIRE surface (A5-3): a right slideover
 * inside the Pipelines tab, self-contained on run data. An approver never
 * enters the owner's project, chat, or definition (user-scope defs are not
 * even readable to them), so the panel is timeline-based, not canvas-based:
 * gate prompt + upstream step outputs/artifacts + progress + the decision
 * buttons, and a footer naming how the decision is recorded.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, X } from 'lucide-react';
import { useStore } from '@/domain/store';
import { ApiError } from '@/infrastructure/http/api/client';
import { Badge, Button } from '../aurora';
import { RunTimeline } from './ActivationRunHistory';
import { GateDecisionForm } from './GateDecisionForm';
import { gateDecisionLabel, isApprovedDecision } from './runStepPresentation';

export function ApproverRunPanel() {
  const { t } = useTranslation('pipelines');
  const panel = useStore((s) => s.approverPanel);
  const run = useStore((s) => s.approverPanelRun);
  const approvals = useStore((s) => s.pipelineApprovals);
  const currentUser = useStore((s) => s.userEmail as string | null | undefined);
  const close = useStore((s) => s.closeApproverPanel);
  const openApproverPanel = useStore((s) => s.openApproverPanel);
  const resolve = useStore((s) => s.resolvePipelineApprovalById);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!panel) return null;

  const stillPending = approvals.some((a) => a.gateId === panel.gateId);
  const gateStep = run?.steps.find((s) => s.stepId === panel.stepId);
  const decision = gateStep?.gate?.decision;

  const decide = async (verdict: 'approve' | 'reject', withNote?: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await resolve(panel.gateId, verdict, withNote);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const who = e.decidedBy;
        setNotice(
          who
            ? t('inbox.alreadyDecidedBy', 'Already decided by {{who}}.', { who })
            : t('inbox.alreadyDecided', 'This gate was already decided.'),
        );
      } else if (e instanceof ApiError && e.status === 404) {
        setNotice(t('inbox.authorityRevoked', 'Your approval authority for this gate was revoked.'));
      } else {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(false);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        maxWidth: '85%',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border-1)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {/* Header — run identity, never project surfaces. */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={14} style={{ color: 'var(--amber-500)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {panel.pipelineName}
          </span>
          <Badge tone="warning" size="sm">{t('approverPanel.roleBadge', 'Approval authority only')}</Badge>
          <button
            aria-label={t('approverPanel.close', 'Close')}
            onClick={close}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 2 }}
          >
            <X size={14} />
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          {panel.ownerUserId && t('inbox.ownerLine', "{{who}}'s activation", { who: panel.ownerUserId })}
          {' · '}
          {panel.projectId}
          {run && (
            <>
              {' · '}
              {t('approverPanel.started', 'started {{when}}', { when: new Date(run.startedAt).toLocaleString() })}
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Gate card — the decision, or its result once landed. */}
        <div
          style={{
            margin: 12,
            padding: '10px 12px',
            border: '1px dashed var(--amber-500)',
            borderRadius: 'var(--r-md)',
            background: 'var(--intent-amber-bg)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber-500)', marginBottom: 4 }}>
            {panel.kind === 'tool'
              ? t('approverPanel.toolHeading', 'Tool approval · {{step}}', { step: panel.stepId })
              : t('approverPanel.gateHeading', 'Approval gate · {{step}}', { step: panel.stepId })}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-1)', whiteSpace: 'pre-wrap', marginBottom: 8 }}>{panel.prompt}</div>
          {panel.timeoutAt && !decision && (
            <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginBottom: 8 }}>
              {panel.onTimeout === 'approve'
                ? t('inbox.timeoutApprove', 'Auto-approves {{when}}', { when: new Date(panel.timeoutAt).toLocaleString() })
                : panel.onTimeout === 'reject'
                  ? t('inbox.timeoutReject', 'Auto-rejects {{when}}', { when: new Date(panel.timeoutAt).toLocaleString() })
                  : t('inbox.timeout', 'Auto-decides {{when}}', { when: new Date(panel.timeoutAt).toLocaleString() })}
            </div>
          )}
          {notice && <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8 }}>{notice}</div>}
          {decision ? (
            <div style={{ fontSize: 12, fontWeight: 600, color: isApprovedDecision(decision) ? 'var(--status-done-fg)' : 'var(--status-error-fg)' }}>
              {gateDecisionLabel(t, decision, gateStep?.gate?.decidedBy)}
              {gateStep?.gate?.decisionNote && (
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-2)', marginTop: 3, fontStyle: 'italic' }}>
                  “{gateStep.gate.decisionNote}”
                </div>
              )}
            </div>
          ) : stillPending ? (
            <GateDecisionForm busy={busy} size="sm" onDecide={decide} />
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{t('approverPanel.resolvedElsewhere', 'This gate is no longer waiting for you.')}</div>
          )}
        </div>

        {/* Step timeline — the decision context (upstream outputs, artifacts, progress). */}
        <div style={{ padding: '0 14px 12px' }}>
          {run ? (
            <RunTimeline
              steps={run.steps}
              live={run.status === 'running' || run.status === 'awaiting_human'}
              jobLink={false}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{t('approverPanel.loading', 'Loading run context…')}</div>
              <div>
                <Button size="xs" variant="secondary" onClick={() => openApproverPanel(panel)}>
                  {t('approverPanel.retry', 'Retry')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer — audit identity. */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-1)' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{panel.runId}</div>
        {currentUser && (
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>
            {t('approverPanel.auditLine', 'Your decision is recorded on the run history as {{who}}.', { who: currentUser })}
          </div>
        )}
      </div>
    </div>
  );
}

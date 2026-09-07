/**
 * ApprovalInbox — pending gates AND clarify waits pinned at the top of the
 * rail, in two groups: `Approval requests` (rows where the caller is a GATE
 * APPROVER on another member's activation — `role: 'approver'`, on top) and
 * `My pipelines` (the caller's own activations). Gate rows funnel through the
 * same choice-resolved authority as a chat-card click; clarify rows post the
 * answer to the pipelines clarify route. Reject expands an inline optional
 * note (the owner reads it to decide the next move). SSE `approvalResolved` /
 * `clarifyAnswered` fold every surface; 409/404 fold the row and name why.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircleQuestion, ShieldCheck, Wrench } from 'lucide-react';
import type { PipelinePendingApproval } from '@ant/shared';
import { useStore } from '@/domain/store';
import { ApiError } from '@/infrastructure/http/api/client';
import { Button } from '../aurora';
import { RailGroup } from '../shared/rail';

export function ApprovalInbox() {
  const { t } = useTranslation('pipelines');
  const approvals = useStore((s) => s.pipelineApprovals);
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  if (approvals.length === 0) return null;

  const asApprover = approvals.filter((a) => a.role === 'approver');
  const mine = approvals.filter((a) => a.role !== 'approver');

  return (
    <RailGroup
      icon={ShieldCheck}
      label={t('inbox.title', 'Waiting for you')}
      pill={
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--amber-500, #f59e0b)',
            color: 'var(--text-on-brand, #fff)',
          }}
        >
          {approvals.length}
        </span>
      }
      count={approvals.length}
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      toggleLabel={collapsed ? t('rail.expand', 'Expand') : t('rail.collapse', 'Collapse')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0 4px' }}>
        {notice && <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{notice}</div>}
        {asApprover.length > 0 && mine.length > 0 && (
          <GroupLabel label={t('inbox.groupApprover', 'Approval requests')} />
        )}
        {asApprover.map((a) => (
          <ApprovalRow key={a.gateId} approval={a} onNotice={setNotice} />
        ))}
        {asApprover.length > 0 && mine.length > 0 && (
          <GroupLabel label={t('inbox.groupMine', 'My pipelines')} />
        )}
        {mine.map((a) => (
          <ApprovalRow key={a.gateId} approval={a} onNotice={setNotice} />
        ))}
      </div>
    </RailGroup>
  );
}

function GroupLabel({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>
      {label}
    </div>
  );
}

function ApprovalRow({
  approval: a,
  onNotice,
}: {
  approval: PipelinePendingApproval;
  onNotice: (msg: string | null) => void;
}) {
  const { t } = useTranslation('pipelines');
  const resolve = useStore((s) => s.resolvePipelineApprovalById);
  const answerClarify = useStore((s) => s.answerPipelineClarifyById);
  const openApproverPanel = useStore((s) => s.openApproverPanel);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'approve' | 'reject', withNote?: string) => {
    if (busy) return;
    setBusy(true);
    onNotice(null);
    try {
      await resolve(a.gateId, decision, withNote);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const who = e.decidedBy;
        onNotice(
          who
            ? t('inbox.alreadyDecidedBy', 'Already decided by {{who}}.', { who })
            : t('inbox.alreadyDecided', 'This gate was already decided.'),
        );
      } else if (e instanceof ApiError && e.status === 404) {
        onNotice(t('inbox.authorityRevoked', 'Your approval authority for this gate was revoked.'));
      } else {
        onNotice(e instanceof Error ? e.message : String(e));
        setBusy(false);
        return; // network-ish failure: keep the row actionable
      }
    }
    setBusy(false);
    setRejecting(false);
  };

  return (
    <div
      style={{
        border: '1px dashed var(--amber-500, #f59e0b)',
        borderRadius: 'var(--r-md)',
        background: 'color-mix(in srgb, var(--amber-500, #f59e0b) 6%, var(--bg-surface))',
        padding: '8px 10px',
      }}
    >
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
        {a.kind === 'clarify' && <MessageCircleQuestion size={11} style={{ color: 'var(--amber-500, #f59e0b)', flexShrink: 0 }} />}
        {a.kind === 'tool' && <Wrench size={11} style={{ color: 'var(--amber-500, #f59e0b)', flexShrink: 0 }} aria-label={t('inbox.toolGate', 'Tool approval')} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.pipelineName}</span>
        {/* Inbox is account-wide — the project label keeps a "foreign" gate legible. */}
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-3)', flexShrink: 0 }}>{a.projectId}</span>
      </div>
      {a.role === 'approver' && a.ownerUserId && (
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginBottom: 2 }}>
          {t('inbox.ownerLine', "{{who}}'s activation", { who: a.ownerUserId })}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {a.prompt}
      </div>
      {a.timeoutAt && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>
          {t('inbox.timeout', 'Auto-decides {{when}}', { when: new Date(a.timeoutAt).toLocaleString() })}
        </div>
      )}
      {a.kind === 'clarify' ? (
        <ClarifyAnswerForm approval={a} onSubmit={answerClarify} />
      ) : rejecting ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('inbox.rejectNotePlaceholder', 'Reason (optional) — the owner uses it to decide the next move')}
            rows={1}
            style={{
              width: '100%',
              fontSize: 11.5,
              padding: '6px 8px',
              borderRadius: 'var(--r-sm, 6px)',
              border: '1px solid var(--border-1)',
              background: 'var(--bg-surface)',
              color: 'var(--text-1)',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="xs" variant="danger" disabled={busy} onClick={() => void decide('reject', note)}>
              {t('inbox.rejectConfirm', 'Confirm reject')}
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
              {t('inbox.rejectCancel', 'Back')}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          {a.role === 'approver' && (
            <Button size="xs" variant="secondary" onClick={() => openApproverPanel(a)}>
              {t('inbox.details', 'Details')}
            </Button>
          )}
          <Button size="xs" variant="primary" disabled={busy} onClick={() => void decide('approve')}>
            {t('inbox.approve', 'Approve')}
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
            {t('inbox.reject', 'Reject')}
          </Button>
        </div>
      )}
    </div>
  );
}

function ClarifyAnswerForm({
  approval,
  onSubmit,
}: {
  approval: PipelinePendingApproval;
  onSubmit: (clarifyId: string, runId: string, stepId: string, answer: string) => Promise<void>;
}) {
  const { t } = useTranslation('pipelines');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(approval.gateId, approval.runId, approval.stepId, answer.trim());
    } catch {
      setBusy(false);
      return;
    }
    setBusy(false);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder={t('inbox.clarifyPlaceholder', 'Type your answer…')}
        rows={2}
        style={{
          width: '100%',
          fontSize: 11.5,
          padding: '6px 8px',
          borderRadius: 'var(--r-sm, 6px)',
          border: '1px solid var(--border-1)',
          background: 'var(--bg-surface)',
          color: 'var(--text-1)',
          resize: 'vertical',
        }}
      />
      <div>
        <Button size="xs" variant="primary" disabled={!answer.trim() || busy} onClick={() => void submit()}>
          {t('inbox.clarifySubmit', 'Answer & resume')}
        </Button>
      </div>
    </div>
  );
}

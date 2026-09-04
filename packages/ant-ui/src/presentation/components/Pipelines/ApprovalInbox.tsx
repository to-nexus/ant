/**
 * ApprovalInbox — pending gates AND clarify waits pinned at the top of the
 * rail. Gate rows funnel through the same choice-resolved authority as a
 * chat-card click; clarify rows post the answer to the pipelines clarify
 * route (the coordinator's status guard is the double-submit authority).
 * SSE `approvalResolved` / `clarifyAnswered` fold every surface.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircleQuestion, ShieldCheck, Wrench } from 'lucide-react';
import type { PipelinePendingApproval } from '@ant/shared';
import { useStore } from '@/domain/store';
import { Button } from '../aurora';

export function ApprovalInbox() {
  const { t } = useTranslation('pipelines');
  const approvals = useStore((s) => s.pipelineApprovals);
  const resolve = useStore((s) => s.resolvePipelineApprovalById);
  const answerClarify = useStore((s) => s.answerPipelineClarifyById);

  if (approvals.length === 0) return null;

  return (
    <div style={{ padding: '10px 10px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <ShieldCheck size={12} style={{ color: 'var(--amber-500, #f59e0b)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {t('inbox.title', 'Waiting for you')}
        </span>
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
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {approvals.map((a) => (
          <div
            key={a.gateId}
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
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="xs" variant="primary" onClick={() => void resolve(a.gateId, 'approve')}>
                  {t('inbox.approve', 'Approve')}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => void resolve(a.gateId, 'reject')}>
                  {t('inbox.reject', 'Reject')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
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

/**
 * ApprovalInbox — pending gates pinned at the top of the rail. Resolving
 * here funnels through the same choice-resolved authority as a chat-card
 * click; the SSE `approvalResolved` event folds every surface.
 */

import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { useStore } from '@/domain/store';
import { Button } from '../aurora';

export function ApprovalInbox() {
  const { t } = useTranslation('pipelines');
  const approvals = useStore((s) => s.pipelineApprovals);
  const resolve = useStore((s) => s.resolvePipelineApprovalById);

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
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="xs" variant="primary" onClick={() => void resolve(a.gateId, 'approve')}>
                {t('inbox.approve', 'Approve')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => void resolve(a.gateId, 'reject')}>
                {t('inbox.reject', 'Reject')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

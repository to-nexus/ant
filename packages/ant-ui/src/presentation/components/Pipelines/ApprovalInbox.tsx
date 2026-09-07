/**
 * ApprovalInbox — pending gates, paused tool calls AND clarify waits pinned
 * at the top of the rail, in two groups: `Approval requests` (rows where the
 * caller is a GATE APPROVER on another member's activation — `role:
 * 'approver'`, on top) and `My pipelines` (the caller's own activations).
 * Gate rows funnel through the same choice-resolved authority as a chat-card
 * click; clarify rows post the answer to the pipelines clarify route. A
 * clarify answer is TEXT — a file arrives as the artifacts path it was
 * uploaded to, which the form can pick. SSE `approvalResolved` /
 * `clarifyAnswered` fold every surface; 409/404 fold the row and name why.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, MessageCircleQuestion, ShieldCheck, Wrench } from 'lucide-react';
import type { PipelinePendingApproval } from '@ant/shared';
import { useStore } from '@/domain/store';
import { useArtifactPickerTree } from '@/application/hooks/ui/useArtifactPickerTree';
import { ApiError } from '@/infrastructure/http/api/client';
import { Badge, Button, Textarea } from '../aurora';
import { FieldHint } from '../ConfigEditor/aurora';
import { FileTreePicker } from '../common/FileTreePicker';
import { RailGroup } from '../shared/rail';
import { GateDecisionForm } from './GateDecisionForm';

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
      pill={<Badge tone="warning" size="sm">{approvals.length}</Badge>}
      count={approvals.length}
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      toggleLabel={collapsed ? t('rail.expand', 'Expand') : t('rail.collapse', 'Collapse')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0 4px' }}>
        {notice && <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{notice}</div>}
        {asApprover.length > 0 && mine.length > 0 && <GroupLabel label={t('inbox.groupApprover', 'Approval requests')} />}
        {asApprover.map((a) => (
          <ApprovalRow key={a.gateId} approval={a} onNotice={setNotice} />
        ))}
        {asApprover.length > 0 && mine.length > 0 && <GroupLabel label={t('inbox.groupMine', 'My pipelines')} />}
        {mine.map((a) => (
          <ApprovalRow key={a.gateId} approval={a} onNotice={setNotice} />
        ))}
      </div>
    </RailGroup>
  );
}

function GroupLabel({ label }: { label: string }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>{label}</div>;
}

function ApprovalRow({ approval: a, onNotice }: { approval: PipelinePendingApproval; onNotice: (msg: string | null) => void }) {
  const { t } = useTranslation('pipelines');
  const resolve = useStore((s) => s.resolvePipelineApprovalById);
  const answerClarify = useStore((s) => s.answerPipelineClarifyById);
  const openApproverPanel = useStore((s) => s.openApproverPanel);
  const selectPipeline = useStore((s) => s.selectPipeline);
  const setPipelinePanelView = useStore((s) => s.setPipelinePanelView);
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
        onNotice(who ? t('inbox.alreadyDecidedBy', 'Already decided by {{who}}.', { who }) : t('inbox.alreadyDecided', 'This gate was already decided.'));
      } else if (e instanceof ApiError && e.status === 404) {
        onNotice(t('inbox.authorityRevoked', 'Your approval authority for this gate was revoked.'));
      } else {
        onNotice(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(false);
  };

  // The owner's path to the run is the pipeline's execution view; an approver
  // (no project access) gets the self-contained run panel instead.
  const openContext = a.role === 'approver'
    ? () => openApproverPanel(a)
    : () => {
        void selectPipeline(a.pipelineId);
        setPipelinePanelView('execution');
      };

  return (
    <div style={{ border: '1px dashed var(--amber-500)', borderRadius: 'var(--r-md)', background: 'var(--intent-amber-bg)', padding: '8px 10px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
        {a.kind === 'clarify' && <MessageCircleQuestion size={11} style={{ color: 'var(--amber-500)', flexShrink: 0 }} aria-label={t('inbox.clarifyKind', 'Question from a step')} />}
        {a.kind === 'tool' && <Wrench size={11} style={{ color: 'var(--amber-500)', flexShrink: 0 }} aria-label={t('inbox.toolGate', 'Tool approval')} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.pipelineName}</span>
        {/* Inbox is account-wide — the project label keeps a "foreign" gate legible. */}
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-3)', flexShrink: 0 }}>{a.projectId}</span>
      </div>
      {a.role === 'approver' && a.ownerUserId && (
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginBottom: 2 }}>{t('inbox.ownerLine', "{{who}}'s activation", { who: a.ownerUserId })}</div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.prompt}</div>
      {a.timeoutAt && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>
          {a.onTimeout === 'approve'
            ? t('inbox.timeoutApprove', 'Auto-approves {{when}}', { when: new Date(a.timeoutAt).toLocaleString() })
            : a.onTimeout === 'reject'
              ? t('inbox.timeoutReject', 'Auto-rejects {{when}}', { when: new Date(a.timeoutAt).toLocaleString() })
              : t('inbox.timeout', 'Auto-decides {{when}}', { when: new Date(a.timeoutAt).toLocaleString() })}
        </div>
      )}
      {a.kind === 'clarify' ? (
        <ClarifyAnswerForm approval={a} onSubmit={answerClarify} onOpenContext={openContext} />
      ) : (
        <GateDecisionForm
          busy={busy}
          onDecide={decide}
          leading={
            <Button size="xs" variant="secondary" onClick={openContext}>
              {a.role === 'approver' ? t('inbox.details', 'Details') : t('inbox.openExecution', 'Open run')}
            </Button>
          }
        />
      )}
    </div>
  );
}

function ClarifyAnswerForm({
  approval,
  onSubmit,
  onOpenContext,
}: {
  approval: PipelinePendingApproval;
  onSubmit: (clarifyId: string, runId: string, stepId: string, answer: string) => Promise<void>;
  onOpenContext: () => void;
}) {
  const { t } = useTranslation('pipelines');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Browse offers the artifacts tree of the project the run is bound to — the
  // file panel is project-scoped, so only when that project is selected.
  const selectedProject = useStore((s) => s.selectedProject);
  const projectType = useStore((s) => s.projectType);
  const pickerTree = useArtifactPickerTree({ definitionMounts: false });
  const canBrowse = selectedProject === approval.projectId && projectType === 'universal' && pickerTree.length > 0;

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
      <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t('inbox.clarifyPlaceholder', 'Type your answer…')} rows={2} />
      <FieldHint tone="muted">{t('inbox.clarifyFileHint', 'A file cannot travel in the answer — upload it to the project\'s artifacts and answer with its path.')}</FieldHint>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="xs" variant="primary" disabled={!answer.trim() || busy} onClick={() => void submit()}>
          {t('inbox.clarifySubmit', 'Answer & resume')}
        </Button>
        {canBrowse && (
          <Button size="xs" variant="ghost" onClick={() => setPickerOpen(true)}>
            <FolderOpen size={11} /> {t('inbox.clarifyBrowse', 'Insert a file path')}
          </Button>
        )}
        <Button size="xs" variant="ghost" onClick={onOpenContext}>
          {approval.role === 'approver' ? t('inbox.details', 'Details') : t('inbox.openExecution', 'Open run')}
        </Button>
      </div>
      {pickerOpen && (
        <FileTreePicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={t('inbox.clarifyBrowseTitle', 'Insert artifact paths — {{project}}', { project: approval.projectId })}
          eyebrow={t('step.browseEyebrow', 'CONTEXT')}
          fileTree={pickerTree}
          initialSelected={[]}
          onConfirm={(paths) => {
            setAnswer((cur) => [cur.trimEnd(), ...paths].filter(Boolean).join('\n'));
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

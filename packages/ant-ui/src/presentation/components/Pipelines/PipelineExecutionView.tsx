/**
 * PipelineExecutionView — the full-screen execution surface: NO wiring canvas
 * by default. One expandable section per activation (project), sorted mine
 * first; expanding a LIVE own activation reveals the on-demand progress
 * monitor (read-only canvas + run-status overlay) above the run history.
 * Other members' activations are status + history only — run detail and the
 * runUpdate SSE are activator-scoped, and so are the controls (B7).
 *
 * The pinned footer replaces the old project dropdown: it acts on the
 * CURRENTLY SELECTED project (projectSlice) — a decision ladder walks
 * no-project / non-universal / already-active-here / bound-elsewhere /
 * pipeline-disabled / activatable.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Pencil, Play, PowerOff, ShieldCheck, User, Zap } from 'lucide-react';
import { isApprovalStep, type PipelineActivationView, type PipelineDef, type PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { Badge, Button } from '../aurora';
import { StatusPill } from '../ConfigEditor/aurora';
import { PipelineCanvas } from './canvas/PipelineCanvas';
import { describeCron } from './cronDescribe';
import { ActivationRunHistory } from './ActivationRunHistory';
import { ApproversEditor, type ApproverGateInfo } from './ApproversEditor';

export interface PipelineExecutionViewProps {
  def: PipelineDef;
  draftIsNew: boolean;
  pipelineId: string | null;
  entry: PipelineListEntry | null;
}

export function PipelineExecutionView({ def, draftIsNew, pipelineId, entry }: PipelineExecutionViewProps) {
  const { t, i18n } = useTranslation('pipelines');
  const activatableProjects = useStore((s) => s.pipelineActivatableProjects);
  const activationError = useStore((s) => s.pipelineActivationError);
  const selectedProject = useStore((s) => s.selectedProject);
  const projectType = useStore((s) => s.projectType);
  const accountAgents = useStore((s) => s.accountAgents);
  const activePipelineByProject = useStore((s) => s.activePipelineByProject);
  const loadActivatableProjects = useStore((s) => s.loadActivatableProjects);
  const activatePipelineTo = useStore((s) => s.activatePipelineTo);
  const deactivatePipelineById = useStore((s) => s.deactivatePipelineById);
  const runPipelineNowById = useStore((s) => s.runPipelineNowById);

  const [busy, setBusy] = useState(false);
  const [runNowNote, setRunNowNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activateOpen, setActivateOpen] = useState(false);
  const [draftApprovers, setDraftApprovers] = useState<Record<string, string[]>>({});
  const isTeam = useStore(selectIsTeamActive);

  useEffect(() => {
    void loadActivatableProjects();
  }, [loadActivatableProjects]);

  // Approval-step rows drive the per-gate approver form (S1). Zero gates =
  // no approver UI at all; non-team orgs keep the one-click flow.
  const gateInfos: ApproverGateInfo[] = useMemo(
    () => def.steps.filter(isApprovalStep).map((s) => ({ id: s.id, prompt: s.prompt })),
    [def],
  );

  const activations = entry?.activations ?? [];
  const enabled = entry?.enabled ?? false;
  const cronSummary = def.on?.schedule
    ? describeCron(def.on.schedule.cron, def.on.schedule.tz, t, i18n.language)
    : def.on?.runCompleted
      ? t('trigger.chainedSummary', 'After "{{id}}"', { id: def.on.runCompleted.pipelineId })
      : t('trigger.manualOnly', 'Manual only');

  const projectNameOf = useMemo(() => {
    const names = new Map(activatableProjects.map((p) => [p.id, p.name]));
    return (projectId: string) => names.get(projectId);
  }, [activatableProjects]);

  // Mine first (current project first among them), then others.
  const sorted = useMemo(
    () =>
      [...activations].sort((a, b) => {
        const rank = (v: PipelineActivationView) =>
          v.mine && v.projectId === selectedProject ? 0 : v.mine ? 1 : 2;
        return rank(a) - rank(b) || a.projectId.localeCompare(b.projectId);
      }),
    [activations, selectedProject],
  );

  if (draftIsNew || !pipelineId) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, textAlign: 'center', lineHeight: 1.7, padding: 24 }}>
        {t('execution.saveFirst', 'Save the pipeline first — activation binds a saved definition to a project.')}
      </div>
    );
  }

  // Footer decision ladder against the CURRENT project.
  const activeHere = activations.find((a) => a.projectId === selectedProject);
  const boundElsewhere =
    !!selectedProject &&
    !activeHere &&
    ((activatableProjects.find((p) => p.id === selectedProject)?.activePipelineId ?? activePipelineByProject[selectedProject]?.pipelineId ?? null) !== null);
  let footerHint: string | null = null;
  let footerAction: 'activate' | 'badge' | null = null;
  if (!selectedProject) {
    footerHint = t('execution.selectProjectFirst', 'Select a project first to activate this pipeline there.');
  } else if (activeHere) {
    footerAction = 'badge';
  } else if (projectType !== 'universal') {
    footerHint = t('execution.notUniversal', 'Pipelines activate on Workspace (universal) projects only.');
  } else if (boundElsewhere) {
    footerHint = t('execution.boundToOther', 'This project is bound to another pipeline.');
  } else if (!enabled) {
    footerHint = t('execution.enableFirstShort', 'Enable the pipeline in Pipeline settings (Wiring view) to activate it here.');
  } else {
    footerAction = 'activate';
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
            {t('execution.activationsTitle', 'Activations')}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            {t('execution.activationsCount', '{{n}} project(s)', { n: activations.length })}
          </span>
        </div>

        {(activationError || runNowNote) && (
          <div style={{ fontSize: 12, color: activationError ? 'var(--red-500)' : 'var(--text-2)' }}>
            {activationError ?? runNowNote}
          </div>
        )}

        {sorted.length === 0 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 12.5, textAlign: 'center', lineHeight: 1.7 }}>
            {t('execution.noActivations', 'Not activated anywhere yet.')}
          </div>
        )}

        {sorted.map((a) => (
          <ActivationSection
            key={`${a.projectId}:${a.activatedBy}`}
            view={a}
            def={def}
            accountAgents={accountAgents}
            cronSummary={cronSummary}
            projectName={projectNameOf(a.projectId)}
            isCurrentProject={a.projectId === selectedProject}
            expanded={expanded === a.projectId}
            onToggle={() => setExpanded((cur) => (cur === a.projectId ? null : a.projectId))}
            busy={busy}
            onRunNow={async () => {
              setBusy(true);
              setRunNowNote(null);
              const err = await runPipelineNowById(pipelineId, a.projectId);
              setRunNowNote(err ?? t('editor.runNowAccepted', 'Run accepted — it appears below shortly.'));
              setBusy(false);
            }}
            onDeactivate={async () => {
              setBusy(true);
              await deactivatePipelineById(pipelineId, a.projectId);
              setBusy(false);
            }}
          />
        ))}
      </div>

      {/* Pinned footer — activation acts on the CURRENT project. */}
      <div style={{ position: 'relative' }}>
        {activateOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              right: 12,
              marginBottom: 8,
              width: 420,
              maxWidth: 'calc(100% - 24px)',
              maxHeight: 380,
              overflowY: 'auto',
              zIndex: 20,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--r-md)',
              boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.16))',
              padding: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Zap size={12} style={{ color: 'var(--violet-500)' }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
                {t('approvers.activateTitle', 'Activate in this project — {{project}}', {
                  project: projectNameOf(selectedProject!) ?? selectedProject,
                })}
              </span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>
              {t('approvers.sectionTitle', 'Gate approvers (per gate)')}
            </div>
            <ApproversEditor gates={gateInfos} value={draftApprovers} onChange={setDraftApprovers} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setActivateOpen(false)}>
                {t('approvers.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  if (!selectedProject) return;
                  setBusy(true);
                  const ok = await activatePipelineTo(pipelineId, selectedProject, draftApprovers);
                  setBusy(false);
                  if (ok) {
                    setActivateOpen(false);
                    setDraftApprovers({});
                  }
                }}
              >
                <Zap size={13} /> {t('execution.activateHere', 'Activate in this project')}
              </Button>
            </div>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderTop: '1px solid var(--border-1)',
            background: 'var(--bg-surface)',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {footerAction === 'badge'
              ? (projectNameOf(selectedProject!) ?? selectedProject)
              : footerHint ?? (projectNameOf(selectedProject!) ?? selectedProject)}
          </span>
          {footerAction === 'badge' ? (
            <Badge tone="success" dot title={activeHere && !activeHere.mine ? activeHere.activatedBy : undefined}>
              {activeHere && !activeHere.mine
                ? t('execution.activeHereBy', 'Active here — by {{who}}', { who: activeHere.activatedBy })
                : t('execution.activeHere', 'Active in this project')}
            </Badge>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={footerAction !== 'activate' || busy}
              title={footerHint ?? undefined}
              onClick={async () => {
                if (!selectedProject) return;
                // Team org + gates → the per-gate approver popover (S1);
                // otherwise the original one-click activation.
                if (isTeam && gateInfos.length > 0) {
                  setDraftApprovers({});
                  setActivateOpen((v) => !v);
                  return;
                }
                setBusy(true);
                await activatePipelineTo(pipelineId, selectedProject);
                setBusy(false);
              }}
            >
              <Zap size={13} /> {t('execution.activateHere', 'Activate in this project')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivationSection({
  view,
  def,
  accountAgents,
  cronSummary,
  projectName,
  isCurrentProject,
  expanded,
  onToggle,
  busy,
  onRunNow,
  onDeactivate,
}: {
  view: PipelineActivationView;
  def: PipelineDef;
  accountAgents: Array<{ id: string; name: string; jobs: Array<{ id: string; name: string }> }>;
  cronSummary: string;
  projectName: string | undefined;
  isCurrentProject: boolean;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  onRunNow: () => void;
  onDeactivate: () => void;
}) {
  const { t } = useTranslation('pipelines');
  const runDetail = useStore((s) => s.pipelineRunDetail);
  const loadPipelineRunDetail = useStore((s) => s.loadPipelineRunDetail);
  // Roster edits are a ChangedBar draft (saved with the pipeline), so the
  // pencil only opens/closes the editor — closing is not a discard.
  const approversDraft = useStore((s) => s.pipelineApproversDraft[view.projectId]);
  const setPipelineApproversDraft = useStore((s) => s.setPipelineApproversDraft);
  const [editingApprovers, setEditingApprovers] = useState(false);

  const gateInfos: ApproverGateInfo[] = useMemo(
    () => def.steps.filter(isApprovalStep).map((s) => ({ id: s.id, prompt: s.prompt })),
    [def],
  );
  const approverNames = useMemo(
    () => [...new Set(Object.values(view.approvers ?? {}).flat())],
    [view.approvers],
  );

  const stateProps =
    view.state === 'broken'
      ? { state: 'error' as const, label: t('execution.stateBroken', 'Broken') }
      : view.state === 'running'
        ? { state: 'checking' as const, label: t('execution.stateRunning', 'Working') }
        : view.state === 'awaiting_human'
          ? { state: 'warning' as const, label: t('execution.stateAwaiting', 'Awaiting approval') }
          : { state: 'connected' as const, label: t('execution.stateWaiting', 'Waiting') };
  const live = view.state === 'running' || view.state === 'awaiting_human';
  // On-demand progress monitor: my live run only — run detail + runUpdate SSE
  // are activator-scoped, so other members' progress stays at pill granularity.
  const showProgress = expanded && view.mine && live && !!view.currentRunId;

  useEffect(() => {
    if (showProgress && view.currentRunId) void loadPipelineRunDetail(view.currentRunId, view.projectId);
  }, [showProgress, view.currentRunId, view.projectId, loadPipelineRunDetail]);

  return (
    <div style={{ border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)', background: 'var(--bg-surface)' }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', flexWrap: 'wrap', cursor: 'pointer' }}
      >
        {expanded ? <ChevronDown size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} /> : <ChevronRight size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
        <span
          title={view.projectId}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--text-1)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...(projectName ? {} : { fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }),
          }}
        >
          {projectName ?? view.projectId}
        </span>
        <StatusPill state={stateProps.state} label={stateProps.label} />
        {isCurrentProject && (
          <Badge tone="brand" size="sm">
            {t('execution.thisProject', 'This project')}
          </Badge>
        )}
        <Badge tone="neutral" size="sm" title={view.mine ? undefined : view.activatedBy}>
          <User size={9} style={{ marginRight: 3 }} />
          {view.mine ? t('execution.activatedByYou', 'you') : view.activatedBy}
        </Badge>
        {/* Approver-union chip — org-visible transparency (S4); pencil = A5-2 form in PUT mode. */}
        {approverNames.length > 0 && (
          <Badge tone="warning" size="sm" title={approverNames.join(', ')}>
            <ShieldCheck size={9} style={{ marginRight: 3 }} />
            {approverNames.slice(0, 3).join(', ')}
            {approverNames.length > 3 && ` +${approverNames.length - 3}`}
          </Badge>
        )}
        {view.mine && gateInfos.length > 0 && (
          <span onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="xs"
              title={t('approvers.edit', 'Edit gate approvers')}
              onClick={() => setEditingApprovers((v) => !v)}
            >
              <Pencil size={11} />
            </Button>
          </span>
        )}
        {view.nextFireAt && !live && (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {t('execution.nextFire', 'Next fire: {{when}}', { when: new Date(view.nextFireAt).toLocaleString() })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {view.mine && view.state !== 'broken' && (
          <span onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="xs" disabled={busy || live} onClick={onRunNow}>
              <Play size={12} /> {t('editor.runNow', 'Run now')}
            </Button>
          </span>
        )}
        {view.mine && (
          <span onClick={(e) => e.stopPropagation()}>
            <Button variant="secondary" size="xs" disabled={busy} onClick={onDeactivate}>
              <PowerOff size={12} /> {t('execution.deactivate', 'Deactivate')}
            </Button>
          </span>
        )}
      </div>
      {editingApprovers && (
        <div style={{ borderTop: '1px solid var(--border-1)', padding: '10px 12px', background: 'var(--bg-surface-2)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>
            {t('approvers.sectionTitle', 'Gate approvers (per gate)')}
          </div>
          <ApproversEditor
            gates={gateInfos}
            value={approversDraft ?? view.approvers ?? {}}
            onChange={(next) => setPipelineApproversDraft(view.projectId, next)}
          />
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
            {t('approvers.editHint', 'Changes save with the pipeline (Save above).')}
          </div>
        </div>
      )}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-1)' }}>
          {showProgress && runDetail && runDetail.runId === view.currentRunId && (
            <div style={{ height: 320, borderBottom: '1px solid var(--border-1)', position: 'relative' }}>
              <PipelineCanvas
                def={def}
                customAgents={accountAgents}
                cronSummary={cronSummary}
                run={runDetail}
                approversByGate={view.approvers}
                selectedNodeId={null}
                onSelectNode={() => {}}
              />
            </div>
          )}
          {/* Per-gate roster table — the observer's map (S4), read-only. */}
          {view.approvers && Object.keys(view.approvers).length > 0 && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {Object.entries(view.approvers).map(([gateId, list]) => (
                <div key={gateId} style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-3)', flexShrink: 0 }}>{gateId}</span>
                  <span style={{ color: 'var(--text-2)', overflowWrap: 'anywhere' }}>→ {list.join(', ')}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ padding: '4px 10px' }}>
            <ActivationRunHistory
              pipelineId={view.pipelineId}
              projectId={view.projectId}
              userId={view.mine ? undefined : view.activatedBy}
              mine={view.mine}
            />
          </div>
        </div>
      )}
    </div>
  );
}

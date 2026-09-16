/**
 * PipelineExecutionView — the full-screen execution surface: NO wiring canvas
 * by default. One expandable section per activation (project), sorted mine
 * first; expanding a LIVE own activation reveals the live-run rows (one per
 * run — the only cancel point of this view) and the on-demand progress monitor
 * (the ONE read-only canvas with per-node run chips) above the run history.
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
import { ChevronDown, ChevronRight, Inbox, Pencil, Play, PowerOff, ShieldCheck, User, XCircle, Zap } from 'lucide-react';
import { isApprovalStep, resolveRunConcurrency, type PipelineActivationView, type PipelineDef, type PipelineListEntry, type PipelineLiveRun } from '@ant/shared';
import { useStore } from '@/domain/store';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { activationRunsKey } from '@/domain/store/slices/pipelineSlice';
import { cancelPipelineRun } from '@/infrastructure/http/api/pipelines';
import { Badge, Button } from '../aurora';
import { StatusPill } from '../ConfigEditor/aurora';
import { PipelineCanvas } from './canvas/PipelineCanvas';
import { describeTrigger } from './cronDescribe';
import { ActivationRunHistory } from './ActivationRunHistory';
import { ApproversEditor, type ApproverGateInfo } from './ApproversEditor';
import { FIRED_BY_ICON, FIRED_BY_LABEL, runHue, runLabel, runTintFg } from './runIdentity';

export interface PipelineExecutionViewProps {
  /** The SAVED definition — execution never reads unsaved design edits. */
  def: PipelineDef;
  draftIsNew: boolean;
  pipelineId: string | null;
  entry: PipelineListEntry | null;
  /** The design view holds edits the server has not seen. */
  unsavedChanges?: boolean;
}

export function PipelineExecutionView({ def, draftIsNew, pipelineId, entry, unsavedChanges = false }: PipelineExecutionViewProps) {
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
  const enablePipelineById = useStore((s) => s.enablePipelineById);
  const loadActivationRuns = useStore((s) => s.loadActivationRuns);

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
  const cronSummary = describeTrigger(def, t, i18n.language);

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
  let footerAction: 'activate' | 'badge' | 'publish' | null = null;
  if (!selectedProject) {
    footerHint = t('execution.selectProjectFirst', 'Select a project first to activate this pipeline there.');
  } else if (activeHere) {
    footerAction = 'badge';
  } else if (projectType !== 'universal') {
    footerHint = t('execution.notUniversal', 'Pipelines activate on Workspace (universal) projects only.');
  } else if (boundElsewhere) {
    footerHint = t('execution.boundToOther', 'This project is bound to another pipeline.');
  } else if (!enabled) {
    // Publishing is the missing step — offer it here instead of pointing at another view.
    footerAction = 'publish';
    footerHint = unsavedChanges
      ? t('availability.saveFirst', 'Save your changes before publishing.')
      : t('execution.enableFirstShort', 'Publish the pipeline to activate it here.');
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

        {unsavedChanges && (
          <Badge tone="warning" size="sm" style={{ alignSelf: 'flex-start' }}>
            {t('execution.unsavedChanges', 'Unsaved design changes — execution follows the saved definition')}
          </Badge>
        )}

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
            gateInfos={gateInfos}
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
              setBusy(false);
              if (err) {
                setRunNowNote(err);
                return;
              }
              // The run lands in THIS section's history — open it and fetch,
              // instead of a note promising it will appear somewhere below.
              setExpanded(a.projectId);
              void loadActivationRuns(pipelineId, a.projectId);
              setRunNowNote(
                def.on?.fetch
                  ? t('execution.pollNowAccepted', 'Poll requested — new items start runs below as they are claimed.')
                  : t('execution.runNowAccepted', 'Run started — follow it in the history below.'),
              );
              window.setTimeout(() => setRunNowNote((cur) => (cur === null ? cur : null)), 4000);
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
              boxShadow: 'var(--shadow-lg)',
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
          ) : footerAction === 'publish' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || unsavedChanges}
              title={footerHint ?? undefined}
              onClick={async () => {
                setBusy(true);
                await enablePipelineById(pipelineId);
                setBusy(false);
              }}
            >
              <Zap size={13} /> {t('availability.publish', 'Publish')}
            </Button>
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
  gateInfos,
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
  gateInfos: ApproverGateInfo[];
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
  const liveRuns: PipelineLiveRun[] = view.liveRuns ?? [];
  const concurrency = resolveRunConcurrency(def);
  // A fetch activation's button polls — the poll judges room itself, so the cap never disables it.
  const isFetch = !!def.on?.fetch;
  const atCap = !isFetch && liveRuns.length >= concurrency;
  // Run selection is per activation and SHARED between the live-run rows, the
  // canvas chips and the history timeline — one selection, three views.
  const runsKey = activationRunsKey(view.pipelineId, view.projectId, view.mine ? undefined : view.activatedBy);
  const selectedRunId = useStore((s) => s.pipelineSelectedRunByActivation[runsKey]);
  const selectActivationRun = useStore((s) => s.selectActivationRun);
  // Run details keyed per run — another section's history click cannot evict them.
  const runDetails = useStore((s) => s.pipelineRunDetails);
  const loadPipelineRunDetail = useStore((s) => s.loadPipelineRunDetail);
  // Roster edits are a ChangedBar draft (saved with the pipeline), so the
  // pencil only opens/closes the editor — closing is not a discard.
  const approversDraft = useStore((s) => s.pipelineApproversDraft[view.projectId]);
  const setPipelineApproversDraft = useStore((s) => s.setPipelineApproversDraft);
  const [editingApprovers, setEditingApprovers] = useState(false);

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
          ? { state: 'warning' as const, label: t('execution.stateAwaiting', 'Awaiting input') }
          : { state: 'connected' as const, label: t('execution.stateWaiting', 'Waiting') };
  const live = liveRuns.length > 0;
  // On-demand progress monitor: my live runs only — run detail + runUpdate SSE
  // are activator-scoped, so other members' progress stays at pill granularity.
  const showProgress = expanded && view.mine && live;

  const liveRunIds = liveRuns.map((r) => r.runId).join('|');
  useEffect(() => {
    if (!showProgress) return;
    for (const runId of liveRunIds.split('|')) {
      if (runId && !runDetails[runId]) void loadPipelineRunDetail(runId, view.projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- details are read once per live-set change, not re-fetched per detail fold
  }, [showProgress, liveRunIds, view.projectId, loadPipelineRunDetail]);

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
        {live && (
          <Badge tone="brand" size="sm" title={liveRuns.map(runLabel).join('\n')}>
            {t('execution.liveCount', '{{n}} live', { n: liveRuns.length })}
          </Badge>
        )}
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
            {isFetch
              ? t('execution.nextPoll', 'Next poll: {{when}}', { when: new Date(view.nextFireAt).toLocaleString() })
              : t('execution.nextFire', 'Next fire: {{when}}', { when: new Date(view.nextFireAt).toLocaleString() })}
          </span>
        )}
        {isFetch && view.lastPoll && (
          <span
            style={{ fontSize: 11, color: view.lastPoll.error ? 'var(--red-500)' : 'var(--text-3)' }}
            title={view.lastPoll.error ?? new Date(view.lastPoll.polledAt).toLocaleString()}
          >
            {view.lastPoll.error
              ? t('execution.lastPollError', 'Last poll failed: {{error}}', { error: view.lastPoll.error })
              : t('execution.lastPoll', 'Last poll: {{seen}} seen · {{unclaimed}} waiting · {{started}} started', {
                  seen: view.lastPoll.seen,
                  unclaimed: view.lastPoll.unclaimed,
                  started: view.lastPoll.enqueued,
                })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {view.mine && view.state !== 'broken' && (
          <span onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy || atCap}
              title={atCap ? t('execution.runNowAtCap', 'This activation is at its cap of {{n}} live run(s) — Run now opens up when one finishes.', { n: concurrency }) : undefined}
              onClick={onRunNow}
            >
              {isFetch ? <Inbox size={12} /> : <Play size={12} />} {isFetch ? t('editor.pollNow', 'Poll now') : t('editor.runNow', 'Run now')}
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
          {showProgress && (
            <>
              {/* One row per live run, newest first — the ONE cancel point of this view. */}
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {t('execution.liveRunsTitle', 'Live runs')}
                </div>
                {liveRuns.map((run) => (
                  <LiveRunRow
                    key={run.runId}
                    run={run}
                    selected={selectedRunId === run.runId}
                    onSelect={() => selectActivationRun(runsKey, selectedRunId === run.runId ? null : run.runId, view.projectId)}
                    onCancel={() => void cancelPipelineRun(run.runId)}
                  />
                ))}
              </div>
              <div style={{ height: 320, borderBottom: '1px solid var(--border-1)', position: 'relative' }}>
                <PipelineCanvas
                  def={def}
                  customAgents={accountAgents}
                  cronSummary={cronSummary}
                  liveRuns={liveRuns}
                  runDetails={runDetails}
                  selectedRunId={selectedRunId ?? null}
                  onSelectRun={(runId) => selectActivationRun(runsKey, runId, view.projectId)}
                  approversByGate={view.approvers}
                  selectedNodeId={null}
                  onSelectNode={() => {}}
                />
              </div>
            </>
          )}
          {/* Per-gate roster table — the observer's map (S4), read-only. */}
          {view.approvers && Object.keys(view.approvers).length > 0 && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {Object.entries(view.approvers).map(([gateId, list]) => (
                <div key={gateId} style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>{gateId}</span>
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

/** One live run: hue accent (its identity everywhere), trigger, label, state, started, cancel. */
function LiveRunRow({ run, selected, onSelect, onCancel }: { run: PipelineLiveRun; selected: boolean; onSelect: () => void; onCancel: () => void }) {
  const { t } = useTranslation('pipelines');
  const hue = runHue(run.runId);
  const FiredIcon = FIRED_BY_ICON[run.firedBy];
  const fired = FIRED_BY_LABEL[run.firedBy];
  const awaiting = run.status === 'awaiting_human';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 8px',
        borderRadius: 'var(--r-md)',
        border: `1px solid ${selected ? runTintFg(hue) : 'var(--border-1)'}`,
        borderLeft: `3px solid ${runTintFg(hue)}`,
        background: selected ? `color-mix(in srgb, ${runTintFg(hue)} 8%, var(--bg-surface))` : 'var(--bg-surface)',
        cursor: 'pointer',
        fontSize: 11,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-2)', flexShrink: 0 }}>
        <FiredIcon size={11} />
        {t(fired.key, fired.fallback)}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{runLabel(run)}</span>
      <StatusPill state={awaiting ? 'warning' : 'checking'} label={awaiting ? t('runs.awaiting', 'Awaiting input') : t('runs.running', 'Running')} />
      <span style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{new Date(run.startedAt).toLocaleString()}</span>
      <div style={{ flex: 1 }} />
      <span onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="xs" title={t('runs.cancel', 'Cancel run')} onClick={onCancel}>
          <XCircle size={12} /> {t('runs.cancel', 'Cancel run')}
        </Button>
      </span>
    </div>
  );
}

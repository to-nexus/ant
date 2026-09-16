/**
 * PipelineWorkspace — the right-hand surface of the pipelines tab: header →
 * the view body, and nothing between them. Wiring = canvas + inspector slot (a
 * selected node opens StepInspector, else PipelineSettingsPanel); Execution =
 * per-project activations.
 *
 * The header owns saving, advisories and errors; the canvas owns its own notice
 * overlay. Nothing conditional sits in this column, so the canvas box is
 * invariant — an edit, an advisory or a save failure never resizes it or
 * re-fits the graph. This file still COMPUTES the gate (it holds the three
 * drafts and cron validity); only the presentation moved.
 *
 * There is no edit mode. `editable` is derived from the BE availability gate
 * — a new draft, or a writable pipeline that is disabled — and a locked
 * canvas explains itself with a banner. All editor surfaces write ONE draft
 * (dirty-buffer doctrine); Save is gated by the shared validator + the server
 * cron preview only when the DEFINITION is dirty.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolvePipelineAdvisories, validatePipelineDef, type CustomAgentSummary, type PipelineAdvisory, type PipelineAdvisoryResolution, type PipelineDef, type PipelineListEntry, type PipelineLiveRun } from '@ant/shared';

const NO_LIVE_RUNS: PipelineLiveRun[] = [];
import { useStore } from '@/domain/store';
import { activationRunsKey, selectPipelineDirty } from '@/domain/store/slices/pipelineSlice';
import { PipelineCanvas } from './canvas/PipelineCanvas';
import { describeTrigger } from './cronDescribe';
import { StepInspector } from './StepInspector';
import { PipelineSettingsPanel } from './PipelineSettingsPanel';
import { PipelineHeader } from './PipelineHeader';
import { PipelineExecutionView } from './PipelineExecutionView';
import { EMPTY_ADVISORY_VIEW, type AdvisoryActions, type AdvisoryStripItem, type AdvisoryView } from './AdvisoryStrip';
import { CanvasNotice, type CanvasNoticeKind } from './CanvasNotice';
import { TRIGGER_NODE_ID, addBranchAfter, insertStepAfter, makeGateStep, makeJobStep } from './draft';

const noop = () => {};

export function PipelineWorkspace() {
  const { t, i18n } = useTranslation('pipelines');
  const draft = useStore((s) => s.pipelineDraft);
  const saved = useStore((s) => s.pipelineSavedDef);
  const draftIsNew = useStore((s) => s.pipelineDraftIsNew);
  const selectedId = useStore((s) => s.selectedPipelineId);
  const saveError = useStore((s) => s.pipelineSaveError);
  const saving = useStore((s) => s.pipelineSaving);
  const editorsDraft = useStore((s) => s.pipelineEditorsDraft);
  const approversDraft = useStore((s) => s.pipelineApproversDraft);
  const view = useStore((s) => s.pipelinePanelView);
  const selectedNodeId = useStore((s) => s.selectedPipelineNodeId);
  // Design-view run overlay: the live runs of THIS pipeline's activation on the
  // selected project — derived, never a separately held slot; the selection is
  // the same per-activation one the execution view uses.
  const selectedProject = useStore((s) => s.selectedProject);
  const runDetails = useStore((s) => s.pipelineRunDetails);
  const selectedRunByActivation = useStore((s) => s.pipelineSelectedRunByActivation);
  const selectActivationRun = useStore((s) => s.selectActivationRun);
  const pipelines = useStore((s) => s.pipelines);
  const accountAgents = useStore((s) => s.accountAgents) as CustomAgentSummary[];
  const serverJudgement = useStore((s) => s.pipelineServerJudgement);
  const setPipelineDraft = useStore((s) => s.setPipelineDraft);
  const acknowledgePipelineAdvisory = useStore((s) => s.acknowledgePipelineAdvisory);
  const removePipelineAcknowledgement = useStore((s) => s.removePipelineAcknowledgement);
  const savePipelineAll = useStore((s) => s.savePipelineAll);
  const discardPipelineAll = useStore((s) => s.discardPipelineAll);
  const setPipelinePanelView = useStore((s) => s.setPipelinePanelView);
  const selectPipelineNode = useStore((s) => s.selectPipelineNode);

  const [cronOk, setCronOk] = useState(true);

  const entry: PipelineListEntry | undefined = pipelines.find((p: PipelineListEntry) => p.id === selectedId);
  const isSaved = !draftIsNew && !!selectedId;
  const enabled = isSaved ? entry?.enabled ?? false : false;
  const readonly = isSaved ? entry?.readonly ?? false : false;
  // The BE gate, verbatim: PUT/promote are refused while enabled or not yours.
  const editable = draftIsNew || (!readonly && !enabled);

  // Selector over the subscribed slices (a fresh object per call must not be a store selector).
  const dirty = useMemo(
    () =>
      selectPipelineDirty({
        pipelines,
        selectedPipelineId: selectedId,
        pipelineDraft: draft,
        pipelineSavedDef: saved,
        pipelineEditorsDraft: editorsDraft,
        pipelineApproversDraft: approversDraft,
      }),
    [pipelines, selectedId, draft, saved, editorsDraft, approversDraft],
  );
  const validationErrors = useMemo(() => (draft ? validatePipelineDef(draft) : []), [draft]);
  // The advisory lifecycle, live over the draft (the same shared resolver the
  // server runs) — plus the server's open items the FE catalog could not see.
  const resolution = useMemo<PipelineAdvisoryResolution>(
    () => (draft ? resolvePipelineAdvisories(draft, accountAgents) : { open: [], acknowledged: [], stale: [] }),
    [draft, accountAgents],
  );
  const advisoryView = useMemo<AdvisoryView>(() => {
    const keyOf = (a: PipelineAdvisory) => `${a.code}:${a.stepId ?? ''}`;
    const open: AdvisoryStripItem[] = resolution.open.map((a) => ({ ...a, id: keyOf(a), source: 'live' as const }));
    const acknowledged: AdvisoryStripItem[] = resolution.acknowledged.map((a) => ({ ...a, id: keyOf(a), source: 'live' as const }));
    const known = new Set([...open, ...acknowledged].map((a) => a.id));
    const saved: AdvisoryStripItem[] = (serverJudgement.advisories?.open ?? [])
      .filter((a) => !known.has(keyOf(a)))
      .map((a) => ({ ...a, id: `saved:${keyOf(a)}`, source: 'saved' as const }));
    return { open: [...open, ...saved], acknowledged, stale: resolution.stale };
  }, [resolution, serverJudgement]);
  // Amber dots and inspector hints follow OPEN items only; acknowledged ones show muted under their field.
  const advisoryStepIds = useMemo(() => new Set(advisoryView.open.flatMap((a) => (a.stepId ? [a.stepId] : []))), [advisoryView]);
  const stepAdvisories = useMemo(() => [...resolution.open, ...resolution.acknowledged], [resolution]);
  const definitionValid = validationErrors.length === 0 && cronOk && (draft?.steps.length ?? 0) > 0;
  const canSave = !!dirty && (!dirty.definition || definitionValid);
  const saveBlockedReason =
    dirty && !canSave
      ? validationErrors[0] ??
        (!cronOk
          ? t('editor.badCron', 'Fix the schedule to save.')
          : draft && draft.steps.length === 0
            ? t('editor.needSteps', 'Add at least one step.')
            : undefined)
      : undefined;

  if (!draft) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.7 }}>
        {t('editor.pickOne', 'Select a pipeline on the left,\nor create a new one.')}
      </div>
    );
  }

  const patch = (next: PipelineDef) => {
    if (!editable) return;
    setPipelineDraft(next);
  };
  // Acknowledging is a definition edit — the same editability gate as any field.
  const advisoryActions: AdvisoryActions = editable
    ? { onSelectStep: selectPipelineNode, onAcknowledge: acknowledgePipelineAdvisory, onUnacknowledge: removePipelineAcknowledgement }
    : {};

  const cronSummary = describeTrigger(draft, t, i18n.language);
  const canvasNotice: CanvasNoticeKind | null =
    !editable && isSaved
      ? { kind: 'locked', readonlyOwner: readonly ? entry?.org?.owner ?? 'the organization' : undefined, onOpenExecution: () => setPipelinePanelView('execution') }
      : editable && draft.steps.length === 0
        ? { kind: 'empty' }
        : null;
  const overlayLiveRuns = entry?.activations.find((a) => a.mine && a.projectId === selectedProject)?.liveRuns ?? NO_LIVE_RUNS;
  const overlayKey = entry && selectedProject ? activationRunsKey(entry.id, selectedProject) : null;
  const overlaySelectedRunId = overlayKey ? selectedRunByActivation[overlayKey] ?? null : null;

  const handleAddAfter = (afterNodeId: string, kind: 'job' | 'gate', mode: 'insert' | 'branch') => {
    if (!editable) return;
    const step = kind === 'gate' ? makeGateStep(draft) : makeJobStep(draft);
    const next = mode === 'branch' ? addBranchAfter(draft, afterNodeId, step) : insertStepAfter(draft, afterNodeId, step);
    patch(next);
    selectPipelineNode(step.id);
  };

  const nodeExists = !!selectedNodeId && (selectedNodeId === TRIGGER_NODE_ID || draft.steps.some((s) => s.id === selectedNodeId));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* One header for the three drafts — on both views, so a roster edit in
          Execution and a wiring edit in Design save (or discard) together. */}
      <PipelineHeader
        draft={draft}
        entry={entry}
        draftIsNew={draftIsNew}
        readonly={readonly}
        enabled={enabled}
        definitionDirty={!!dirty?.definition}
        view={view}
        onViewChange={setPipelinePanelView}
        dirtyCount={dirty?.count ?? 0}
        isSaving={saving}
        canSave={canSave}
        saveBlockedReason={saveBlockedReason}
        onSave={() => void savePipelineAll()}
        onDiscard={discardPipelineAll}
        saveError={saveError}
        advisories={view === 'execution' ? EMPTY_ADVISORY_VIEW : advisoryView}
        advisoryActions={advisoryActions}
        catalogWarnings={view === 'execution' ? [] : serverJudgement.catalogWarnings}
      />

      {view === 'execution' ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          {/* Execution follows the SAVED definition — after publishing it is the
              activated one; unsaved design edits never leak into rosters,
              gate lists or the live progress canvas. */}
          <PipelineExecutionView def={saved ?? draft} draftIsNew={draftIsNew} pipelineId={selectedId} entry={entry ?? null} unsavedChanges={!!dirty?.definition} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* The canvas box: `relative` is the notice overlay's containing block. */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
            <PipelineCanvas
              def={draft}
              customAgents={accountAgents}
              cronSummary={cronSummary}
              liveRuns={overlayLiveRuns}
              runDetails={runDetails}
              selectedRunId={overlaySelectedRunId}
              onSelectRun={overlayKey && selectedProject ? (runId) => selectActivationRun(overlayKey, runId, selectedProject) : undefined}
              advisoryStepIds={advisoryStepIds}
              selectedNodeId={editable ? selectedNodeId : null}
              onSelectNode={editable ? selectPipelineNode : noop}
              onAddAfter={editable ? handleAddAfter : undefined}
              showLegend
            />
            <CanvasNotice notice={canvasNotice} />
          </div>
          {/* Inspector slot: a node while editable, otherwise the pipeline's own settings. */}
          {editable && nodeExists && selectedNodeId ? (
            <StepInspector
              def={draft}
              nodeId={selectedNodeId}
              onChange={patch}
              onClose={() => selectPipelineNode(null)}
              onCronValidity={setCronOk}
              advisories={stepAdvisories.filter((a) => a.stepId === selectedNodeId)}
              onStepRenamed={selectPipelineNode}
            />
          ) : (
            <PipelineSettingsPanel
              draft={draft}
              entry={entry}
              draftIsNew={draftIsNew}
              editable={editable}
              enabled={enabled}
              onPatch={patch}
            />
          )}
        </div>
      )}
    </div>
  );
}

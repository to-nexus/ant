/**
 * PipelineWorkspace — the right-hand surface of the pipelines tab: header
 * (orientation only) → ONE ChangedBar covering the three drafts (definition,
 * org editors, per-activation approvers) → error strip → the view body.
 * Wiring = canvas + inspector slot (a selected node opens StepInspector, else
 * PipelineSettingsPanel); Execution = per-project activations.
 *
 * There is no edit mode. `editable` is derived from the BE availability gate
 * — a new draft, or a writable pipeline that is disabled — and a locked
 * canvas explains itself with a banner. All editor surfaces write ONE draft
 * (dirty-buffer doctrine); Save is gated by the shared validator + the server
 * cron preview only when the DEFINITION is dirty.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { validatePipelineDef, type PipelineDef, type PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { selectPipelineDirty } from '@/domain/store/slices/pipelineSlice';
import { ChangedBar } from '../ConfigEditor/aurora';
import { PipelineCanvas } from './canvas/PipelineCanvas';
import { describeCron } from './cronDescribe';
import { StepInspector } from './StepInspector';
import { PipelineSettingsPanel } from './PipelineSettingsPanel';
import { PipelineHeader } from './PipelineHeader';
import { PipelineExecutionView } from './PipelineExecutionView';
import { TRIGGER_NODE_ID, insertStepAfter, makeGateStep, makeJobStep } from './draft';

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
  const runDetail = useStore((s) => s.pipelineRunDetail);
  const pipelines = useStore((s) => s.pipelines);
  const accountAgents = useStore((s) => s.accountAgents);
  const setPipelineDraft = useStore((s) => s.setPipelineDraft);
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

  const cronSummary = draft.on?.schedule
    ? describeCron(draft.on.schedule.cron, draft.on.schedule.tz, t, i18n.language)
    : draft.on?.runCompleted
      ? t('trigger.chainedSummary', 'After "{{id}}"', { id: draft.on.runCompleted.pipelineId || '…' })
      : t('trigger.manualOnly', 'Manual only');

  const handleAddAfter = (afterNodeId: string, kind: 'job' | 'gate') => {
    if (!editable) return;
    const step = kind === 'gate' ? makeGateStep(draft) : makeJobStep(draft);
    patch(insertStepAfter(draft, afterNodeId, step));
    selectPipelineNode(step.id);
  };

  const nodeExists = !!selectedNodeId && (selectedNodeId === TRIGGER_NODE_ID || draft.steps.some((s) => s.id === selectedNodeId));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <PipelineHeader
        draft={draft}
        entry={entry}
        draftIsNew={draftIsNew}
        readonly={readonly}
        enabled={enabled}
        view={view}
        onViewChange={setPipelinePanelView}
      />

      {/* ONE bar for the three drafts — on both views, so a roster edit in
          Execution and a wiring edit in Wiring save (or discard) together. */}
      {dirty && (
        <div style={{ padding: '10px 14px 0' }}>
          <ChangedBar
            hasChanges
            count={dirty.count}
            isSaving={saving}
            saveDisabled={!canSave}
            blockedReason={saveBlockedReason}
            onSave={() => void savePipelineAll()}
            onDiscard={discardPipelineAll}
          />
        </div>
      )}

      {/* Error strip — save/availability refusals (e.g. disable's 409 holder list). */}
      {saveError && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-surface)', fontSize: 12, color: 'var(--red-500)' }}>
          {saveError}
        </div>
      )}

      {view === 'execution' ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <PipelineExecutionView def={draft} draftIsNew={draftIsNew} pipelineId={selectedId} entry={entry ?? null} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {!editable && isSaved && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  fontSize: 12,
                  color: 'var(--text-3)',
                  background: 'var(--bg-surface-2)',
                  borderBottom: '1px solid var(--border-1)',
                }}
              >
                <Lock size={12} />
                {readonly
                  ? t('editor.readOnlyShared', 'Shared by {{owner}} — read-only for you.', { owner: entry?.org?.owner ?? 'the organization' })
                  : t('canvas.lockedEnabled', 'Wiring is locked while the pipeline is enabled — disable it in Pipeline settings to edit.')}
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <PipelineCanvas
                def={draft}
                customAgents={accountAgents}
                cronSummary={cronSummary}
                run={runDetail && runDetail.pipelineId === (selectedId ?? '') ? runDetail : null}
                selectedNodeId={editable ? selectedNodeId : null}
                onSelectNode={editable ? selectPipelineNode : noop}
                onAddAfter={editable ? handleAddAfter : undefined}
              />
              {editable && draft.steps.length === 0 && (
                <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px dashed var(--border-1)', whiteSpace: 'nowrap' }}>
                    {t('editor.emptyCanvas', 'Press + on the trigger node to add the first step.')}
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Inspector slot: a node while editable, otherwise the pipeline's own settings. */}
          {editable && nodeExists && selectedNodeId ? (
            <StepInspector def={draft} nodeId={selectedNodeId} onChange={patch} onClose={() => selectPipelineNode(null)} onCronValidity={setCronOk} />
          ) : (
            <PipelineSettingsPanel
              draft={draft}
              entry={entry}
              draftIsNew={draftIsNew}
              editable={editable}
              readonly={readonly}
              enabled={enabled}
              definitionDirty={!!dirty?.definition}
              onPatch={patch}
            />
          )}
        </div>
      )}
    </div>
  );
}

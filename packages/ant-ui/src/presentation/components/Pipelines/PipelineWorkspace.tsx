/**
 * PipelineWorkspace — the right-hand surface of the pipelines tab, split into
 * two views: Wiring (the definition canvas, with an explicit view/edit mode)
 * and Execution (full-screen per-project activations). Everything the user
 * acts on lives in ONE header row: name, edit-mode controls (Save / Discard /
 * Delete / Done), the availability Toggle (+ info hint), and the view toggle.
 *
 * Edit mode is a UI mode on top of the BE availability machine: entering it
 * requires a DISABLED, writable pipeline (the Edit button is disabled with a
 * tooltip while enabled, hidden while readonly); a NEW draft is forced-edit.
 * All editor surfaces edit ONE draft (dirty-buffer doctrine); save is gated
 * by the shared validator + the server cron preview (form-disable leg).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, PencilRuler, PlayCircle, Trash2 } from 'lucide-react';
import { validatePipelineDef, type PipelineDef, type PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { pipelineDraftIsDirty } from '@/domain/store/slices/pipelineSlice';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { Button, BoardViewModeToggle, Toggle } from '../aurora';
import { HintBadge } from '../common/HintBadge';
import { OrgAccessCard } from '../shared/org/OrgAccessCard';
import { PromoteZone } from '../shared/org/PromoteZone';
import { updatePipelineEditors } from '@/infrastructure/http/api/pipelines';
import { PipelineCanvas } from './canvas/PipelineCanvas';
import { StepInspector } from './StepInspector';
import { PipelineExecutionView } from './PipelineExecutionView';
import { TRIGGER_NODE_ID, insertStepAfter, makeGateStep, makeJobStep } from './draft';

type PanelView = 'editor' | 'execution';

/** Thin vertical separator between the header's control clusters. */
const HeaderDivider = () => (
  <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '2px 0', background: 'var(--border-1)' }} />
);

export function PipelineWorkspace() {
  const { t } = useTranslation('pipelines');
  const draft = useStore((s) => s.pipelineDraft);
  const saved = useStore((s) => s.pipelineSavedDef);
  const draftIsNew = useStore((s) => s.pipelineDraftIsNew);
  const selectedId = useStore((s) => s.selectedPipelineId);
  const saveError = useStore((s) => s.pipelineSaveError);
  const view = useStore((s) => s.pipelinePanelView);
  const wiringMode = useStore((s) => s.pipelineWiringMode);
  const selectedNodeId = useStore((s) => s.selectedPipelineNodeId);
  const runDetail = useStore((s) => s.pipelineRunDetail);
  const pipelines = useStore((s) => s.pipelines);
  const accountAgents = useStore((s) => s.accountAgents);
  const setPipelineDraft = useStore((s) => s.setPipelineDraft);
  const discardPipelineDraft = useStore((s) => s.discardPipelineDraft);
  const savePipelineDraft = useStore((s) => s.savePipelineDraft);
  const setPipelinePanelView = useStore((s) => s.setPipelinePanelView);
  const setPipelineWiringMode = useStore((s) => s.setPipelineWiringMode);
  const selectPipelineNode = useStore((s) => s.selectPipelineNode);
  const deletePipelineById = useStore((s) => s.deletePipelineById);
  const enablePipelineById = useStore((s) => s.enablePipelineById);
  const disablePipelineById = useStore((s) => s.disablePipelineById);
  const promotePipelineById = useStore((s) => s.promotePipelineById);
  const loadPipelines = useStore((s) => s.loadPipelines);
  const isTeamActive = useStore(selectIsTeamActive);
  const { showConfirm } = useAlertModalContext();

  const [cronOk, setCronOk] = useState(true);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  const entry: PipelineListEntry | undefined = pipelines.find((p: PipelineListEntry) => p.id === selectedId);
  const isSaved = !draftIsNew && !!selectedId;
  const enabled = isSaved ? entry?.enabled ?? false : false;
  const readonly = isSaved ? entry?.readonly ?? false : false;
  // The availability machine's edit gate: published or not-yours ⇒ read-only.
  const editLocked = enabled || readonly;
  // UI edit mode on top of the gate — a new draft is forced-edit.
  const editing = wiringMode === 'edit' || draftIsNew;
  const editable = editing && !editLocked;

  const dirty = pipelineDraftIsDirty(draft, saved);
  const validationErrors = useMemo(() => (draft ? validatePipelineDef(draft) : []), [draft]);
  const canSave = !!draft && editable && dirty && validationErrors.length === 0 && cronOk && draft.steps.length > 0;
  const saveBlockedReason = !canSave
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

  const cronSummary = `${draft.on.schedule.cron}${draft.on.schedule.tz ? ` · ${draft.on.schedule.tz}` : ''}`;

  const handleAddAfter = (afterNodeId: string, kind: 'job' | 'gate') => {
    if (!editable) return;
    const step = kind === 'gate' ? makeGateStep(draft) : makeJobStep(draft);
    patch(insertStepAfter(draft, afterNodeId, step));
    selectPipelineNode(step.id);
  };

  const exitEditMode = () => {
    if (dirty) {
      showConfirm(t('rail.discardConfirm', 'Discard unsaved changes?'), {
        onConfirm: () => {
          discardPipelineDraft();
          setPipelineWiringMode('view');
        },
      });
      return;
    }
    setPipelineWiringMode('view');
  };

  const confirmDelete = () => {
    showConfirm(
      t('danger.confirmMessage', 'Delete "{{name}}"? The definition is removed; run history stays with each activation.', { name: draft.name }),
      {
        title: t('danger.confirmTitle', 'Delete pipeline'),
        type: 'error',
        confirmText: t('danger.delete', 'Delete'),
        onConfirm: () => void deletePipelineById(selectedId!),
      },
    );
  };

  const availabilityDisabled = readonly || availabilityBusy || editing || (!enabled && dirty);
  const availabilityHint = readonly
    ? t('editor.readOnlyShared', 'Shared by {{owner}} — read-only for you.', { owner: entry?.org?.owner ?? 'the organization' })
    : editing
      ? t('availability.finishEditing', 'Finish editing (Done) before changing availability.')
      : !enabled && dirty
        ? t('availability.saveFirst', 'Save your changes before enabling.')
        : enabled
          ? t('availability.disable', 'Disable')
          : t('availability.enable', 'Enable');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header — the one control row: name · edit cluster · availability · view. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          borderBottom: '1px solid var(--border-1)',
          background: 'var(--bg-surface)',
          flexWrap: 'wrap',
        }}
      >
        {editable ? (
          <input
            value={draft.name}
            onChange={(e) => patch({ ...draft, name: e.target.value })}
            placeholder={t('editor.namePlaceholder', 'Pipeline name')}
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text-1)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              minWidth: 120,
              flex: '0 1 260px',
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text-1)',
              minWidth: 0,
              flex: '0 1 auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {draft.name}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {view === 'editor' && (
          <>
            {editing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {editable && dirty && saveBlockedReason && (
                  <span style={{ fontSize: 11, color: 'var(--red-500)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={saveBlockedReason}>
                    {saveBlockedReason}
                  </span>
                )}
                {editable && dirty && (
                  <Button variant="ghost" size="xs" onClick={discardPipelineDraft}>
                    {t('editor.discard', 'Discard')}
                  </Button>
                )}
                {editable && dirty && (
                  <Button variant="primary" size="xs" disabled={!canSave} onClick={() => void savePipelineDraft()}>
                    {t('editor.save', 'Save')}
                  </Button>
                )}
                {isSaved && !editLocked && (
                  <Button variant="ghost" size="xs" onClick={confirmDelete} title={t('danger.confirmTitle', 'Delete pipeline')}>
                    <Trash2 size={13} style={{ color: 'var(--red-500)' }} />
                  </Button>
                )}
                {isSaved && (
                  <Button variant="secondary" size="xs" onClick={exitEditMode}>
                    <Check size={13} /> {t('editor.done', 'Done')}
                  </Button>
                )}
              </div>
            ) : (
              !readonly &&
              isSaved && (
                <span title={enabled ? t('editor.editBlockedEnabled', 'Disable the pipeline (toggle) to edit its wiring.') : undefined}>
                  <Button variant="ghost" size="xs" disabled={enabled} onClick={() => setPipelineWiringMode('edit')}>
                    <Pencil size={13} /> {t('editor.edit', 'Edit')}
                  </Button>
                </span>
              )
            )}
            <HeaderDivider />
          </>
        )}

        {isSaved && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span title={availabilityHint} style={{ display: 'inline-flex' }}>
                <Toggle
                  size="sm"
                  checked={enabled}
                  disabled={availabilityDisabled}
                  aria-label={enabled ? t('availability.disable', 'Disable') : t('availability.enable', 'Enable')}
                  onChange={async (next) => {
                    setAvailabilityBusy(true);
                    try {
                      if (next) await enablePipelineById(selectedId!);
                      else await disablePipelineById(selectedId!);
                    } finally {
                      setAvailabilityBusy(false);
                    }
                  }}
                />
              </span>
              <HintBadge
                isCompact
                label={t('availability.hint.label', 'Availability')}
                tooltip={t(
                  'availability.hint.body',
                  'Enabled: projects can activate this pipeline and the wiring is locked. Disable to edit, delete, or promote — only possible while no project has it activated.',
                )}
              />
            </div>
            <HeaderDivider />
          </>
        )}

        <BoardViewModeToggle<PanelView>
          value={view}
          onChange={(v) => setPipelinePanelView(v)}
          options={[
            { id: 'editor', label: t('views.wiring', 'Wiring'), icon: PencilRuler },
            { id: 'execution', label: t('views.execution', 'Execution'), icon: PlayCircle },
          ]}
          ariaLabel={t('editor.viewMode', 'Pipeline view')}
        />
      </div>

      {/* Error strip — save/availability refusals (e.g. disable's 409 holder list). */}
      {saveError && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-surface)', fontSize: 12, color: 'var(--red-500)' }}>
          {saveError}
        </div>
      )}

      {/* Body */}
      {view === 'execution' ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <PipelineExecutionView def={draft} draftIsNew={draftIsNew} pipelineId={selectedId} entry={entry ?? null} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <PipelineCanvas
                def={draft}
                customAgents={accountAgents}
                cronSummary={cronSummary}
                run={runDetail && runDetail.pipelineId === (selectedId ?? '') ? runDetail : null}
                selectedNodeId={selectedNodeId}
                onSelectNode={selectPipelineNode}
                onAddAfter={editable ? handleAddAfter : undefined}
              />
              {editable && draft.steps.length === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{ fontSize: 12.5, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px dashed var(--border-1)', whiteSpace: 'nowrap' }}>
                    {t('editor.emptyCanvas', 'Press + on the trigger node to add the first step.')}
                  </span>
                </div>
              )}
            </div>
            {/* Inspector is an EDITOR tool — in view mode its inputs would
                silently no-op (patch gates on editable), so it never renders. */}
            {editable && selectedNodeId && (selectedNodeId === TRIGGER_NODE_ID || draft.steps.some((s) => s.id === selectedNodeId)) && (
              <StepInspector
                def={draft}
                nodeId={selectedNodeId}
                onChange={patch}
                onClose={() => selectPipelineNode(null)}
                onCronValidity={setCronOk}
              />
            )}
          </div>

          {/* Sharing & access — the agents-detail precedent: org cards above nothing else. */}
          {isSaved && (entry?.org?.canManageEditors || (isTeamActive && entry?.scope === 'user' && !enabled) || orgError) && (
            <div style={{ borderTop: '1px solid var(--border-1)', padding: '10px 14px', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '40%', overflowY: 'auto' }}>
              {entry?.org?.canManageEditors && (
                <OrgAccessCard
                  id="pipe-org-access"
                  ns="pipelines"
                  resourceId={selectedId!}
                  org={entry.org}
                  onSaveEditors={(editors) => updatePipelineEditors(selectedId!, editors)}
                  onSaved={loadPipelines}
                  onError={setOrgError}
                />
              )}

              {isTeamActive && entry?.scope === 'user' && !enabled && (
                <PromoteZone
                  id="pipe-promote"
                  ns="pipelines"
                  resourceName={entry?.name ?? selectedId!}
                  isPromoting={isPromoting}
                  onPromote={() => {
                    setIsPromoting(true);
                    promotePipelineById(selectedId!)
                      .catch((e) => setOrgError(e instanceof Error ? e.message : String(e)))
                      .finally(() => setIsPromoting(false));
                  }}
                />
              )}

              {orgError && <span style={{ fontSize: 12, color: 'var(--red-500)' }}>{orgError}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * PipelineWorkspace — the right-hand surface of the pipelines tab, split into
 * two views: Wiring (the definition canvas — editable only while the pipeline
 * is DISABLED and the caller may edit it) and Execution (activations incl.
 * org members' read-only rows, per-activation run history, live monitor).
 * All editor surfaces edit ONE draft (dirty-buffer doctrine); save is gated by
 * the shared validator + the server cron preview (form-disable leg).
 *
 * Availability state machine: enable = publish (activatable, read-only),
 * disable = reclaim for editing (only with zero activations — the server
 * refuses otherwise and lists the holders).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PencilRuler, PlayCircle, Lock, Power, PowerOff } from 'lucide-react';
import { validatePipelineDef, type PipelineDef, type PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { pipelineDraftIsDirty } from '@/domain/store/slices/pipelineSlice';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { Button, BoardViewModeToggle } from '../aurora';
import { DangerZone, SectionCard } from '../ConfigEditor/aurora';
import { OrgAccessCard } from '../shared/org/OrgAccessCard';
import { PromoteZone } from '../shared/org/PromoteZone';
import { updatePipelineEditors } from '@/infrastructure/http/api/pipelines';
import { PipelineCanvas } from './canvas/PipelineCanvas';
import { StepInspector } from './StepInspector';
import { PipelineExecutionView } from './PipelineExecutionView';
import { TRIGGER_NODE_ID, insertStepAfter, makeGateStep, makeJobStep } from './draft';

type PanelView = 'editor' | 'execution';

export function PipelineWorkspace() {
  const { t } = useTranslation('pipelines');
  const draft = useStore((s) => s.pipelineDraft);
  const saved = useStore((s) => s.pipelineSavedDef);
  const draftIsNew = useStore((s) => s.pipelineDraftIsNew);
  const selectedId = useStore((s) => s.selectedPipelineId);
  const saveError = useStore((s) => s.pipelineSaveError);
  const view = useStore((s) => s.pipelinePanelView);
  const selectedNodeId = useStore((s) => s.selectedPipelineNodeId);
  const runDetail = useStore((s) => s.pipelineRunDetail);
  const pipelines = useStore((s) => s.pipelines);
  const setPipelineDraft = useStore((s) => s.setPipelineDraft);
  const discardPipelineDraft = useStore((s) => s.discardPipelineDraft);
  const savePipelineDraft = useStore((s) => s.savePipelineDraft);
  const setPipelinePanelView = useStore((s) => s.setPipelinePanelView);
  const selectPipelineNode = useStore((s) => s.selectPipelineNode);
  const deletePipelineById = useStore((s) => s.deletePipelineById);
  const enablePipelineById = useStore((s) => s.enablePipelineById);
  const disablePipelineById = useStore((s) => s.disablePipelineById);
  const promotePipelineById = useStore((s) => s.promotePipelineById);
  const loadPipelines = useStore((s) => s.loadPipelines);
  const isTeamActive = useStore(selectIsTeamActive);

  const [cronOk, setCronOk] = useState(true);
  const [dangerArmed, setDangerArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  const entry: PipelineListEntry | undefined = pipelines.find((p: PipelineListEntry) => p.id === selectedId);
  const isSaved = !draftIsNew && !!selectedId;
  const enabled = isSaved ? entry?.enabled ?? false : false;
  const readonly = isSaved ? entry?.readonly ?? false : false;
  // The availability machine's edit gate: published or not-yours ⇒ read-only.
  const editLocked = enabled || readonly;

  const dirty = pipelineDraftIsDirty(draft, saved);
  const validationErrors = useMemo(() => (draft ? validatePipelineDef(draft) : []), [draft]);
  const canSave = !!draft && !editLocked && dirty && validationErrors.length === 0 && cronOk && draft.steps.length > 0;

  if (!draft) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.7 }}>
        {t('editor.pickOne', 'Select a pipeline on the left,\nor create a new one.')}
      </div>
    );
  }

  const patch = (next: PipelineDef) => {
    if (editLocked) return;
    setPipelineDraft(next);
  };

  const cronSummary = `${draft.on.schedule.cron}${draft.on.schedule.tz ? ` · ${draft.on.schedule.tz}` : ''}`;

  const handleAddAfter = (afterNodeId: string, kind: 'job' | 'gate') => {
    if (editLocked) return;
    const step = kind === 'gate' ? makeGateStep(draft) : makeJobStep(draft);
    patch(insertStepAfter(draft, afterNodeId, step));
    selectPipelineNode(step.id);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
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
        <input
          value={draft.name}
          onChange={(e) => patch({ ...draft, name: e.target.value })}
          placeholder={t('editor.namePlaceholder', 'Pipeline name')}
          readOnly={editLocked}
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-1)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            minWidth: 120,
            flex: '0 1 260px',
            ...(editLocked ? { opacity: 0.75, cursor: 'default' } : {}),
          }}
        />

        <div style={{ flex: 1 }} />

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

      {/* Read-only banner — published (enabled) or shared without edit rights. */}
      {editLocked && view === 'editor' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 14px',
            borderBottom: '1px solid var(--border-1)',
            background: 'color-mix(in srgb, var(--amber-500, #f59e0b) 8%, var(--bg-surface))',
            fontSize: 12,
            color: 'var(--text-2)',
          }}
        >
          <Lock size={12} />
          <span>
            {readonly
              ? t('editor.readOnlyShared', 'Shared by {{owner}} — read-only for you.', { owner: entry?.org?.owner ?? 'the organization' })
              : t('editor.readOnlyEnabled', 'Enabled — disable the pipeline below to edit the wiring.')}
          </span>
        </div>
      )}

      {/* Dirty / validation bar */}
      {(dirty || saveError) && view === 'editor' && !editLocked && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 14px',
            borderBottom: '1px solid var(--border-1)',
            background: 'color-mix(in srgb, var(--violet-500) 6%, var(--bg-surface))',
            fontSize: 12,
            flexWrap: 'wrap',
          }}
        >
          {dirty && (
            <>
              <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>
                {draftIsNew ? t('editor.unsavedNew', 'Not saved yet') : t('editor.unsaved', 'Unsaved changes')}
              </span>
              {validationErrors.length > 0 ? (
                <span style={{ color: 'var(--red-500)' }}>{validationErrors[0]}</span>
              ) : !cronOk ? (
                <span style={{ color: 'var(--red-500)' }}>{t('editor.badCron', 'Fix the schedule to save.')}</span>
              ) : draft.steps.length === 0 ? (
                <span style={{ color: 'var(--text-3)' }}>{t('editor.needSteps', 'Add at least one step.')}</span>
              ) : null}
              <div style={{ flex: 1 }} />
              <Button variant="ghost" size="xs" onClick={discardPipelineDraft}>
                {t('editor.discard', 'Discard')}
              </Button>
              <Button variant="primary" size="xs" disabled={!canSave} onClick={() => void savePipelineDraft()}>
                {t('editor.save', 'Save')}
              </Button>
            </>
          )}
          {saveError && <span style={{ color: 'var(--red-500)' }}>{saveError}</span>}
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
                cronSummary={cronSummary}
                run={runDetail && runDetail.pipelineId === (selectedId ?? '') ? runDetail : null}
                selectedNodeId={selectedNodeId}
                onSelectNode={selectPipelineNode}
                onAddAfter={editLocked ? undefined : handleAddAfter}
              />
              {draft.steps.length === 0 && (
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
            {selectedNodeId && (selectedNodeId === TRIGGER_NODE_ID || draft.steps.some((s) => s.id === selectedNodeId)) && (
              <StepInspector
                def={draft}
                nodeId={selectedNodeId}
                onChange={patch}
                onClose={() => selectPipelineNode(null)}
                onCronValidity={setCronOk}
              />
            )}
          </div>

          {/* Detail footer — saved pipelines only: availability, org access, promote, danger. */}
          {isSaved && (
            <div style={{ borderTop: '1px solid var(--border-1)', padding: '10px 14px', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '45%', overflowY: 'auto' }}>
              {!readonly && (
                <SectionCard
                  id="pipe-availability"
                  icon={enabled ? 'Power' : 'PowerOff'}
                  accent="cool"
                  title={enabled ? t('availability.enabledTitle', 'Enabled') : t('availability.disabledTitle', 'Disabled (draft)')}
                  description={
                    enabled
                      ? t('availability.enabledDesc', 'Activatable on projects. Disable to edit — only possible while no one has it activated.')
                      : t('availability.disabledDesc', 'Editable, but not activatable. Enable to let projects activate it.')
                  }
                  bodyMaxWidth={480}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button
                      size="sm"
                      type="button"
                      variant={enabled ? 'secondary' : 'primary'}
                      disabled={availabilityBusy || (!enabled && dirty)}
                      onClick={async () => {
                        setAvailabilityBusy(true);
                        try {
                          if (enabled) await disablePipelineById(selectedId!);
                          else await enablePipelineById(selectedId!);
                        } finally {
                          setAvailabilityBusy(false);
                        }
                      }}
                    >
                      {enabled ? (
                        <>
                          <PowerOff size={13} /> {t('availability.disable', 'Disable')}
                        </>
                      ) : (
                        <>
                          <Power size={13} /> {t('availability.enable', 'Enable')}
                        </>
                      )}
                    </Button>
                    {!enabled && dirty && (
                      <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                        {t('availability.saveFirst', 'Save your changes before enabling.')}
                      </span>
                    )}
                  </div>
                </SectionCard>
              )}

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

              {!editLocked && (
                <DangerZone
                  title={t('danger.title', 'Delete pipeline')}
                  description={t('danger.desc', 'Removes the definition. Run history stays with each activation.')}
                  buttonText={dangerArmed ? t('danger.confirm', 'Really delete?') : t('danger.delete', 'Delete')}
                  loadingText={t('danger.deleting', 'Deleting…')}
                  isLoading={deleting}
                  onAction={async () => {
                    if (!dangerArmed) {
                      setDangerArmed(true);
                      setTimeout(() => setDangerArmed(false), 4000);
                      return;
                    }
                    setDeleting(true);
                    try {
                      await deletePipelineById(selectedId!);
                    } finally {
                      setDeleting(false);
                      setDangerArmed(false);
                    }
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

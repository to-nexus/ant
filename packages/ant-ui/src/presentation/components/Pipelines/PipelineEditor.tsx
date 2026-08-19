/**
 * PipelineEditor — everything a pipeline needs on one screen: header (name,
 * enabled, Run now, Editor|Runs switch, save/discard), n8n-style canvas with
 * an inspector drawer, run history, danger zone. All surfaces edit ONE draft
 * (dirty-buffer doctrine); save is gated by the shared validator + the
 * server cron preview (form-disable leg).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, ListChecks, PencilRuler } from 'lucide-react';
import { validatePipelineDef, type PipelineDef } from '@ant/shared';
import { useStore } from '@/domain/store';
import { pipelineDraftIsDirty } from '@/domain/store/slices/pipelineSlice';
import { Toggle, Button, BoardViewModeToggle } from '../aurora';
import { DangerZone } from '../ConfigEditor/aurora';
import { PipelineCanvas } from './canvas/PipelineCanvas';
import { StepInspector } from './StepInspector';
import { PipelineRuns } from './PipelineRuns';
import { TRIGGER_NODE_ID, insertStepAfter, makeGateStep, makeJobStep } from './draft';

export function PipelineEditor() {
  const { t } = useTranslation('pipelines');
  const draft = useStore((s) => s.pipelineDraft);
  const saved = useStore((s) => s.pipelineSavedDef);
  const draftIsNew = useStore((s) => s.pipelineDraftIsNew);
  const selectedId = useStore((s) => s.selectedPipelineId);
  const saveError = useStore((s) => s.pipelineSaveError);
  const view = useStore((s) => s.pipelineEditorView);
  const selectedNodeId = useStore((s) => s.selectedPipelineNodeId);
  const runDetail = useStore((s) => s.pipelineRunDetail);
  const setPipelineDraft = useStore((s) => s.setPipelineDraft);
  const discardPipelineDraft = useStore((s) => s.discardPipelineDraft);
  const savePipelineDraft = useStore((s) => s.savePipelineDraft);
  const setPipelineEditorView = useStore((s) => s.setPipelineEditorView);
  const selectPipelineNode = useStore((s) => s.selectPipelineNode);
  const runPipelineNowById = useStore((s) => s.runPipelineNowById);
  const deletePipelineById = useStore((s) => s.deletePipelineById);

  const [cronOk, setCronOk] = useState(true);
  const [dangerArmed, setDangerArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [runNowNote, setRunNowNote] = useState<string | null>(null);

  const dirty = pipelineDraftIsDirty(draft, saved);
  const validationErrors = useMemo(() => (draft ? validatePipelineDef(draft) : []), [draft]);
  const canSave = !!draft && dirty && validationErrors.length === 0 && cronOk && draft.steps.length > 0;

  if (!draft) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.7 }}>
        {t('editor.pickOne', 'Select a pipeline on the left,\nor create a new one.')}
      </div>
    );
  }

  const patch = (next: PipelineDef) => setPipelineDraft(next);

  const cronSummary = `${draft.on.schedule.cron}${draft.on.schedule.tz ? ` · ${draft.on.schedule.tz}` : ''}`;

  const handleAddAfter = (afterNodeId: string, kind: 'job' | 'gate') => {
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)' }}>
          <Toggle
            checked={draft.enabled}
            onChange={(enabled) => patch({ ...draft, enabled })}
            size="sm"
            aria-label={t('editor.enabled', 'Enabled')}
          />
          {draft.enabled ? t('editor.on', 'On') : t('editor.off', 'Off')}
        </span>

        <div style={{ flex: 1 }} />

        {!draftIsNew && selectedId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const err = await runPipelineNowById(selectedId);
              setRunNowNote(err ?? t('editor.runNowAccepted', 'Fired — watch Runs.'));
              setTimeout(() => setRunNowNote(null), 4000);
            }}
          >
            <Play size={13} /> {t('editor.runNow', 'Run now')}
          </Button>
        )}
        <BoardViewModeToggle
          value={view === 'runs' ? 'workflow' : 'kanban'}
          onChange={(v) => setPipelineEditorView(v === 'workflow' ? 'runs' : 'editor')}
          options={[
            { id: 'kanban', label: t('editor.viewEditor', 'Editor'), icon: PencilRuler },
            { id: 'workflow', label: t('editor.viewRuns', 'Runs'), icon: ListChecks },
          ]}
          ariaLabel={t('editor.viewMode', 'Editor view')}
        />
      </div>

      {/* Dirty / validation bar */}
      {(dirty || saveError || runNowNote) && view === 'editor' && (
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
          {runNowNote && <span style={{ color: 'var(--text-2)' }}>{runNowNote}</span>}
        </div>
      )}

      {/* Body */}
      {view === 'runs' && selectedId ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <PipelineRuns pipelineId={selectedId} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <PipelineCanvas
              def={draft}
              cronSummary={cronSummary}
              run={runDetail && runDetail.pipelineId === (selectedId ?? '') ? runDetail : null}
              selectedNodeId={selectedNodeId}
              onSelectNode={selectPipelineNode}
              onAddAfter={handleAddAfter}
            />
            {draft.steps.length === 0 && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                <span style={{ fontSize: 12.5, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px dashed var(--border-1)' }}>
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
      )}

      {/* Danger zone — editor view, saved pipelines only */}
      {view === 'editor' && !draftIsNew && selectedId && (
        <div style={{ borderTop: '1px solid var(--border-1)', padding: '10px 14px', background: 'var(--bg-surface)' }}>
          <DangerZone
            title={t('danger.title', 'Delete pipeline')}
            description={t('danger.desc', 'Removes the definition and its run history. Live runs are cancelled.')}
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
                await deletePipelineById(selectedId);
              } finally {
                setDeleting(false);
                setDangerArmed(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

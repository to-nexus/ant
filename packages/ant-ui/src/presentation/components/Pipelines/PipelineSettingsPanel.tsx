/**
 * PipelineSettingsPanel — the inspector slot's content when no node is
 * selected: everything about the pipeline that is not wiring. Identity (name),
 * Availability (the BE state machine's toggle), Organization access (editors —
 * writable even while enabled, per the BE), Promote and Delete (both refused
 * while enabled — the cards say so in place instead of hiding). A NEW draft
 * shows Identity only: the other cards need a saved id.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineDef, PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { Toggle } from '../aurora';
import { AuroraInput, DangerZone, FieldLabel, SectionCard } from '../ConfigEditor/aurora';
import { OrgAccessCard } from '../shared/org/OrgAccessCard';
import { PromoteZone } from '../shared/org/PromoteZone';
import { InspectorShell } from './InspectorShell';

export interface PipelineSettingsPanelProps {
  draft: PipelineDef;
  entry: PipelineListEntry | undefined;
  draftIsNew: boolean;
  editable: boolean;
  readonly: boolean;
  enabled: boolean;
  definitionDirty: boolean;
  onPatch: (next: PipelineDef) => void;
}

export function PipelineSettingsPanel({ draft, entry, draftIsNew, editable, readonly, enabled, definitionDirty, onPatch }: PipelineSettingsPanelProps) {
  const { t } = useTranslation('pipelines');
  const selectedId = useStore((s) => s.selectedPipelineId);
  const editorsDraft = useStore((s) => s.pipelineEditorsDraft);
  const setPipelineEditorsDraft = useStore((s) => s.setPipelineEditorsDraft);
  const enablePipelineById = useStore((s) => s.enablePipelineById);
  const disablePipelineById = useStore((s) => s.disablePipelineById);
  const promotePipelineById = useStore((s) => s.promotePipelineById);
  const deletePipelineById = useStore((s) => s.deletePipelineById);
  const isTeamActive = useStore(selectIsTeamActive);

  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [dangerArmed, setDangerArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // The arm never survives a selection change — a second click must mean THIS pipeline.
  useEffect(() => {
    setDangerArmed(false);
    setPromoteError(null);
  }, [selectedId]);

  const availabilityDisabled = readonly || availabilityBusy || (!enabled && definitionDirty);
  const availabilityHint = readonly
    ? t('editor.readOnlyShared', 'Shared by {{owner}} — read-only for you.', { owner: entry?.org?.owner ?? 'the organization' })
    : !enabled && definitionDirty
      ? t('availability.saveFirst', 'Save your changes before enabling.')
      : null;

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!dangerArmed) {
      setDangerArmed(true);
      return;
    }
    setIsDeleting(true);
    try {
      await deletePipelineById(selectedId);
    } finally {
      setIsDeleting(false);
      setDangerArmed(false);
    }
  };

  return (
    <InspectorShell title={t('settings.title', 'Pipeline settings')}>
      <SectionCard
        id="pipe-identity"
        icon="Waypoints"
        accent="aurora"
        title={t('settings.identityTitle', 'Identity')}
        description={t('settings.identityDesc', 'The name shown in the rail, the inbox, and every run.')}
      >
        <div>
          <FieldLabel>{t('settings.name', 'Name')}</FieldLabel>
          <AuroraInput
            value={draft.name}
            disabled={!editable}
            placeholder={t('editor.namePlaceholder', 'Pipeline name')}
            onChange={(name) => onPatch({ ...draft, name })}
          />
        </div>
        {draftIsNew && (
          <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
            {t('settings.saveToUnlock', 'Save the pipeline to unlock availability, sharing, and deletion.')}
          </p>
        )}
      </SectionCard>

      {!draftIsNew && selectedId && (
        <>
          <SectionCard
            id="pipe-availability"
            icon="Power"
            accent="cool"
            title={t('settings.availabilityTitle', 'Availability')}
            description={t(
              'availability.hint.body',
              'Enabled: projects can activate this pipeline and the wiring is locked. Disable to edit, delete, or promote — only possible while no project has it activated.',
            )}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--text-1)', fontWeight: 600 }}>
                <Toggle
                  size="sm"
                  checked={enabled}
                  disabled={availabilityDisabled}
                  aria-label={enabled ? t('availability.disable', 'Disable') : t('availability.enable', 'Enable')}
                  onChange={async (next) => {
                    setAvailabilityBusy(true);
                    try {
                      if (next) await enablePipelineById(selectedId);
                      else await disablePipelineById(selectedId);
                    } finally {
                      setAvailabilityBusy(false);
                    }
                  }}
                />
                {enabled ? t('rail.enabled', 'Enabled') : t('rail.draft', 'Disabled')}
              </label>
              {availabilityHint && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{availabilityHint}</span>}
            </div>
          </SectionCard>

          {entry?.org?.canManageEditors && (
            <OrgAccessCard
              id="pipe-org-access"
              ns="pipelines"
              resourceId={selectedId}
              org={entry.org}
              value={editorsDraft ?? entry.org.editors ?? []}
              onChange={setPipelineEditorsDraft}
            />
          )}

          {isTeamActive && entry?.scope === 'user' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PromoteZone
                id="pipe-promote"
                ns="pipelines"
                resourceName={entry?.name ?? selectedId}
                isPromoting={isPromoting}
                disabled={enabled}
                disabledReason={t('availability.disableFirstPromote', 'Disable the pipeline before promoting it.')}
                onPromote={() => {
                  setIsPromoting(true);
                  setPromoteError(null);
                  promotePipelineById(selectedId)
                    .catch((e) => setPromoteError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setIsPromoting(false));
                }}
              />
              {promoteError && <span style={{ fontSize: 12, color: 'var(--red-500)' }}>{promoteError}</span>}
            </div>
          )}

          {!readonly && (
            <DangerZone
              title={t('danger.title', 'Delete this pipeline')}
              description={`${t('danger.desc', 'Removes the definition. Run history stays with each activation.')}${
                enabled ? ` ${t('availability.disableFirstDelete', 'Disable the pipeline before deleting it.')}` : ''
              }`}
              buttonText={dangerArmed ? t('danger.confirm', 'Click again to confirm') : t('danger.button', 'Delete pipeline')}
              loadingText={t('danger.deleting', 'Deleting…')}
              isLoading={isDeleting}
              disabled={enabled}
              onAction={() => void handleDelete()}
            />
          )}
        </>
      )}
    </InspectorShell>
  );
}

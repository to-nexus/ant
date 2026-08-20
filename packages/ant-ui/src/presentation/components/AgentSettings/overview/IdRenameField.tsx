/**
 * The id row shared by the agent and job definition cards.
 *
 * agentId and jobId are directory names, so changing either is a structural
 * move (the definition dir plus the container data keyed by it) — it cannot
 * ride the draft/ChangedBar path, which the write funnel refuses with
 * `id ≡ dirname`. Both therefore get the SAME click-twice action, and editing
 * `id:` in the YAML view is caught here with a pointer back to it instead of a
 * 400 at save time. One component so the two levels cannot drift.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/presentation/components/aurora';
import { AuroraInput, FieldHint, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';
import { isValidCustomId } from '@ant/shared';

/** Width of the id input + Apply pair — a control measure, never a prose one. */
const CONTROL_WIDTH = 420;

export function IdRenameField({
  label,
  hint,
  currentId,
  /** `id` as parsed from the card's YAML buffer — drift means the raw view edited it. */
  yamlId,
  dirtyCount,
  readonly,
  disabled,
  /** Resolves once the move landed (or threw) — the shell owns reselection. */
  onRename,
}: {
  label: string;
  hint: string;
  currentId: string;
  yamlId: string;
  dirtyCount: number;
  readonly: boolean;
  disabled: boolean;
  onRename: (newId: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [nextId, setNextId] = useState(currentId);
  const [armed, setArmed] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    setNextId(currentId);
    setArmed(false);
  }, [currentId]);

  const yamlIdDrifted = yamlId !== currentId;
  const idChanged = nextId !== currentId;
  const canRename = !disabled && idChanged && isValidCustomId(nextId) && !yamlIdDrifted && dirtyCount === 0;

  const submitRename = async () => {
    if (!canRename) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setRenaming(true);
    try {
      await onRename(nextId);
    } finally {
      setRenaming(false);
    }
  };

  return (
    // The 420 cap belongs to the input + Apply ROW only: prose wrapped at a
    // control's width becomes a second, narrower text column inside the card.
    <div>
      <div style={{ maxWidth: CONTROL_WIDTH }}>
        <FieldLabel>{label}</FieldLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AuroraInput
              value={nextId}
              mono
              disabled={disabled || renaming}
              hasError={nextId.length > 0 && !isValidCustomId(nextId)}
              onChange={(v) => {
                setNextId(v);
                setArmed(false);
              }}
            />
          </div>
          {!readonly && (
            <Button size="sm" disabled={!canRename || renaming} onClick={() => void submitRename()}>
              {renaming
                ? t('agentDef.idRenaming', 'Moving…')
                : armed
                  ? t('danger.confirm', 'Click again to confirm')
                  : t('agentDef.idApply', 'Apply')}
            </Button>
          )}
        </div>
      </div>
      <FieldHint spacing="above">{hint}</FieldHint>
      {nextId.length > 0 && !isValidCustomId(nextId) && (
        <FieldHint spacing="above" style={{ color: 'var(--status-error-fg, var(--text-2))' }}>
          {t('agentDef.idInvalid', 'Ids are lowercase kebab-case: a-z, 0-9 and single hyphens between them.')}
        </FieldHint>
      )}
      {yamlIdDrifted && (
        <p
          className="text-xs rounded-md px-2 py-1"
          style={{
            margin: '8px 0 0',
            background: 'var(--status-error-bg, var(--bg-surface-2))',
            color: 'var(--status-error-fg, var(--text-2))',
          }}
        >
          {t(
            'agentDef.idYamlDrift',
            'The id in the YAML view no longer matches the directory — saving would be refused. Undo it there and use Apply instead.',
          )}
        </p>
      )}
      {idChanged && dirtyCount > 0 && !yamlIdDrifted && (
        <FieldHint spacing="above">
          {t('agentDef.idDirtyBlocked', 'Save or discard your pending changes first — the move reloads this file.')}
        </FieldHint>
      )}
    </div>
  );
}

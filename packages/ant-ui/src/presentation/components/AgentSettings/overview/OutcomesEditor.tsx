/**
 * Outcomes editor — the structured surface for one intent's declared decision
 * vocabulary (`infer.md` frontmatter `outcomes: [..]`). A turn under a
 * judgment intent ends with `<verdict>one-of-these</verdict>`, and pipeline
 * `on: verdict:<name>` edges route on it; a producing intent declares none,
 * because its result is the file it wrote.
 *
 * Entries are scalar kebab ids, so this is a chip row rather than the
 * full-width rows StopHooksEditor uses for its kind+value pairs.
 *
 * The list is STAGED locally and written back only when it is committable
 * (empty, or MIN..MAX). Writing a one-entry list would make the file fail the
 * shared grammar, which disables this very form — locking the author out of
 * the control they would need to fix it. So an under-count list lives here,
 * loudly, and the file on disk stays valid.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';
import { AuroraInput, CONTROL_MEASURE, FieldHint, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';
import {
  CUSTOM_ID_HINT,
  INTENT_OUTCOMES_MAX,
  INTENT_OUTCOMES_MIN,
  clarifyExitOutcomes,
  isValidCustomId,
} from '@ant/shared';

/** Committable = what the shared grammar accepts: no vocabulary at all, or a real one. */
function isCommittable(list: string[]): boolean {
  return list.length === 0 || (list.length >= INTENT_OUTCOMES_MIN && list.length <= INTENT_OUTCOMES_MAX);
}

export function OutcomesEditor({
  outcomes,
  disabled,
  onChange,
}: {
  outcomes: string[] | undefined;
  disabled: boolean;
  onChange: (next: string[] | undefined) => void;
}) {
  const { t } = useTranslation('agents');
  const [staged, setStaged] = useState<string[]>(outcomes ?? []);
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // The file is the SSOT: an edit landing from the raw view (or a different
  // intent mounting into the same card) re-seeds the staged list.
  const declared = (outcomes ?? []).join(' ');
  useEffect(() => {
    setStaged(outcomes ?? []);
    setDraft('');
    setAddError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declared]);

  const commit = (next: string[]) => {
    setStaged(next);
    if (isCommittable(next)) onChange(next.length === 0 ? undefined : next);
  };

  const add = () => {
    const id = draft.trim();
    if (id === '') return;
    if (!isValidCustomId(id)) {
      setAddError(t('intent.outcomesIdInvalid', 'Outcome ids are {{hint}}.', { hint: CUSTOM_ID_HINT }));
      return;
    }
    if (staged.includes(id)) {
      setAddError(t('intent.outcomesDuplicate', '"{{id}}" is already declared.', { id }));
      return;
    }
    if (clarifyExitOutcomes([id]).length > 0) {
      setAddError(
        t(
          'intent.outcomesClarifyExit',
          '"{{id}}" names the clarify exit, not a conclusion the work reached — let the turn end through clarify when it cannot start.',
          { id },
        ),
      );
      return;
    }
    setDraft('');
    setAddError(null);
    commit([...staged, id]);
  };

  const atCap = staged.length >= INTENT_OUTCOMES_MAX;
  const underCount = !isCommittable(staged);
  // Pre-existing ids the BE save gate would refuse — the loader tolerates them,
  // so a file can arrive carrying one.
  const refused = new Set(clarifyExitOutcomes(staged));

  return (
    <div>
      <FieldLabel>{t('intent.outcomesTitle', 'Outcomes')}</FieldLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: CONTROL_MEASURE }}>
        {staged.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {staged.map((id) => {
              const bad = refused.has(id);
              return (
                <span
                  key={id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 'var(--r-pill)',
                    border: `1px solid ${bad ? 'var(--status-error-fg)' : 'var(--violet-300)'}`,
                    background: bad ? 'var(--status-error-bg)' : 'var(--select-fill-violet)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      padding: '3px 4px 3px 10px',
                      color: bad ? 'var(--status-error-fg)' : 'var(--select-fg)',
                    }}
                  >
                    {id}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => commit(staged.filter((o) => o !== id))}
                    aria-label={t('intent.outcomesRemove', 'Remove {{id}}', { id })}
                    title={t('intent.outcomesRemove', 'Remove {{id}}', { id })}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0 7px 0 3px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-4)',
                      cursor: disabled ? 'default' : 'pointer',
                    }}
                  >
                    <X size={11} strokeWidth={2.6} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {!atCap && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: '1 1 0', minWidth: 0 }}>
              <AuroraInput
                value={draft}
                disabled={disabled}
                mono
                hasError={addError != null}
                placeholder={t('intent.outcomesPlaceholder', 'e.g. needs-review')}
                onChange={(v) => {
                  setDraft(v);
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    add();
                  } else if (e.key === 'Escape') {
                    setDraft('');
                    setAddError(null);
                  }
                }}
              />
            </div>
            <Button size="sm" variant="ghost" disabled={disabled || draft.trim() === ''} onClick={add}>
              <Plus size={12} strokeWidth={2.4} />
              {t('intent.outcomesAdd', 'Add')}
            </Button>
          </div>
        )}

        {addError && <FieldHint tone="error">{addError}</FieldHint>}
        {underCount && (
          <FieldHint tone="error">
            {t('intent.outcomesUnderCount', {
              defaultValue:
                'A vocabulary needs {{min}}-{{max}} outcomes: one verdict has to win, so a single option is not a decision. Not saved until you add another (or remove this one to declare none).',
              min: INTENT_OUTCOMES_MIN,
              max: INTENT_OUTCOMES_MAX,
            })}
          </FieldHint>
        )}
        {atCap && (
          <FieldHint tone="muted">
            {t('intent.outcomesAtCap', 'At the cap of {{max}} outcomes.', { max: INTENT_OUTCOMES_MAX })}
          </FieldHint>
        )}
        <FieldHint tone="muted">
          {t(
            'intent.outcomesHint',
            'Only a judgment intent declares outcomes: the turn ends by naming one, and pipeline steps branch on it. Leave empty for an intent that produces something, where the result is the file it writes.',
          )}
        </FieldHint>
      </div>
    </div>
  );
}

/**
 * Intent detail card — the single editing surface for one intent of the
 * selected job: its id and its matching criteria (the agent reads the
 * description verbatim off its rendered Intent Catalog). Prompt bindings live in the Prompts section below
 * (single surface); deleting happens in this screen's Danger Zone. Edits flow
 * through `useDefinitionDocs`, so the shell's ChangedBar saves them into
 * jobs/{jobId}/intents.yaml with the comment-preserving funnel.
 *
 * The id is editable here for the same reason it is on the agent and job
 * screens — one axis, one rule. It is cheaper than those two though: an intent
 * owns no directory, so the rename is a catalog edit that Discard undoes.
 * Bindings travel with the entry; `@intent:` mentions already typed into past
 * turns reference the old id, exactly as an agent/job rename leaves old refs.
 *
 * A freshly added intent arrives here with an empty description — the textarea
 * takes focus and the save gate stays closed until the criteria are authored,
 * so no placeholder prose can ever reach the classifier.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Textarea } from '@/presentation/components/aurora';
import { AuroraInput, FieldLabel, SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import { CUSTOM_ID_PATTERN, GENERAL_INTENT } from '@ant/shared';
import type { OverviewCtx } from './sections';

export function IntentDetailCard({
  ctx,
  id,
  intentId,
  onBackToJob,
  onRenameId,
}: {
  ctx: OverviewCtx;
  id: string;
  intentId: string;
  onBackToJob: () => void;
  /** Applies the catalog edit and reselects under the new id. */
  onRenameId: (newId: string) => void;
}) {
  const { t } = useTranslation('agents');
  const { docs } = ctx;
  const entry = docs.intents.find((e) => e.id === intentId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const empty = entry != null && entry.description.trim().length === 0;
  const [nextId, setNextId] = useState(intentId);
  const disabled = ctx.readonly || docs.intentsDoc?.parseError != null;

  useEffect(() => {
    if (empty) textareaRef.current?.focus();
  }, [empty, intentId]);

  useEffect(() => {
    setNextId(intentId);
  }, [intentId]);

  const idWellFormed = CUSTOM_ID_PATTERN.test(nextId) && nextId !== GENERAL_INTENT;
  const idTaken = nextId !== intentId && docs.intents.some((e) => e.id === nextId);
  const canRename = !disabled && nextId !== intentId && idWellFormed && !idTaken;

  if (!docs.loaded) return null;
  if (!entry) {
    // Raw-edit race: the intent vanished from intents.yaml while selected.
    return (
      <SectionCard
        id={id}
        icon="Target"
        accent="sunset"
        title={intentId}
        description={t('intent.notFound', 'This intent no longer exists in the catalog.')}
      >
        <Button size="sm" variant="ghost" onClick={onBackToJob}>
          {t('intent.backToJob', 'Back to the job')}
        </Button>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      id={id}
      icon="Target"
      accent="sunset"
      title={t('intent.criteriaTitle', 'Matching criteria')}
      description={t(
        'intent.criteriaDesc',
        'Describe when this intent applies — the agent reads this text verbatim in its Intent Catalog to decide which prompts to load, and it is what an @intent: mention selects.',
      )}
      bodyMaxWidth={560}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <FieldLabel>{t('intent.id', 'Intent id')}</FieldLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 420 }}>
            <div style={{ flex: 1 }}>
              <AuroraInput
                value={nextId}
                mono
                disabled={disabled}
                hasError={nextId.length > 0 && (!idWellFormed || idTaken)}
                onChange={setNextId}
              />
            </div>
            {!ctx.readonly && (
              <Button size="sm" disabled={!canRename} onClick={() => onRenameId(nextId)}>
                {t('agentDef.idApply', 'Apply')}
              </Button>
            )}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
            {t(
              'intent.idHint',
              'Ids are lowercase kebab-case. Renaming rewrites the catalog entry (bindings travel with it) — confirm it with Save above; @intent: mentions already sent keep referring to the old id.',
            )}
          </p>
          {nextId.length > 0 && idTaken && (
            <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--status-error-fg, var(--text-2))' }}>
              {t('intent.idTaken', 'This job already has an intent with that id.')}
            </p>
          )}
        </div>

        <Textarea
          ref={textareaRef}
          value={entry.description}
          disabled={ctx.readonly || docs.intentsDoc?.parseError != null}
          onChange={(e) => docs.updateIntent(entry.id, { description: e.target.value })}
          placeholder={t('overview.intentDescription', 'Matching criterion (rendered verbatim as a catalog row)')}
          rows={3}
        />

        {docs.intentErrors.length > 0 && (
          <div
            style={{
              fontSize: 11.5,
              borderRadius: 'var(--r-md)',
              padding: '6px 10px',
              background: 'var(--status-error-bg, var(--bg-surface-2))',
              color: 'var(--status-error-fg, var(--text-2))',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {docs.intentErrors.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

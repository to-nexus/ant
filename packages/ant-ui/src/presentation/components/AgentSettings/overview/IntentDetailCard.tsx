/**
 * Intent criteria card — the single editing surface for one intent's
 * `intents/{id}/infer.md`, and NOTHING ELSE about the intent: the inference
 * criterion (the file's prose body, which the agent reads verbatim off its
 * rendered Intent Catalog) and the clarify frontmatter flag. Those are what the
 * file declares. The id is the DIRECTORY name, so it belongs to the intent's
 * identity card above — renaming a file's card must never rename its container.
 * Hooks live in the sibling card (hooks.yaml), the active-turn prose in the
 * prompt card (prompt.md); deleting in this screen's Danger Zone. Edits flow
 * through `useDefinitionDocs`, so the shell's ChangedBar saves them.
 *
 * This is a DefinitionCard over exactly THIS intent's infer.md — the raw view
 * shows the file verbatim (frontmatter included), so a frontmatter error
 * disables only this form (the sibling cards keep working) with the raw
 * editor available to fix the file in place.
 *
 * A freshly added intent arrives here as a PHANTOM draft with an empty
 * criterion — the textarea takes focus and the save gate stays closed until
 * the criterion is authored, so no placeholder prose ever reaches the catalog
 * and no directory is created before it is real.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Textarea } from '@/presentation/components/aurora';
import { AuroraSelect, FieldHint, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';
import { DefinitionCard } from './DefinitionCard';
import { INFER_CRITERION_MAX } from './definitionDocs';
import { inferDocKey } from './useDefinitionDocs';
import type { OverviewCtx } from './sections';

/**
 * Collapsed floor for the criterion textarea: 4 lines of its own metrics
 * (14px × 1.6 line-height + 12px padding top and bottom). The previous 150
 * left a typical 3–4 line criterion sitting above ~1.5 blank lines, which
 * reads as a mis-sized box rather than as room to type.
 */
const MIN_CRITERION_HEIGHT = Math.round(24 + 4 * 14 * 1.6);

export function IntentDetailCard({
  ctx,
  id,
  intentId,
  onBackToJob,
}: {
  ctx: OverviewCtx;
  id: string;
  intentId: string;
  onBackToJob: () => void;
}) {
  const { t } = useTranslation('agents');
  const { docs } = ctx;
  const doc = docs.inferDocs[intentId] ?? null;
  const entry = docs.intents.find((e) => e.id === intentId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const empty = entry != null && entry.infer.trim().length === 0;
  const disabled = ctx.readonly || doc?.parseError != null;

  useEffect(() => {
    if (empty) textareaRef.current?.focus();
  }, [empty, intentId]);

  // The criterion is markdown prose an author hard-wraps at their own column,
  // so a fixed row count clips it mid-line. Size to the RENDERED height,
  // clamped so a criterion near the 1000-char cap scrolls instead of stretching
  // the card. Measured on mount too (the raw ⇄ form toggle remounts the field)
  // and on resize, since the wrap depends on the card's width.
  const fit = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_CRITERION_HEIGHT), 420)}px`;
  }, []);
  const attachTextarea = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
      fit(el);
    },
    [fit],
  );
  useEffect(() => {
    fit(textareaRef.current);
    const onResize = () => fit(textareaRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit, entry?.infer, intentId]);

  if (!docs.loaded) return null;

  const clarifyValue = entry?.clarify === undefined ? 'inherit' : entry.clarify ? 'on' : 'off';

  return (
    <DefinitionCard
      id={id}
      icon="Target"
      accent="sunset"
      title={t('intent.criteriaTitle', 'Matching criteria')}
      description={t(
        'intent.criteriaDesc',
        'Prose describing when this intent applies — the agent reads it verbatim in its Intent Catalog every turn, and it is what an @intent: mention selects. The Raw view shows the file with its optional clarify frontmatter.',
      )}
      doc={doc}
      readonly={ctx.readonly}
      onRawChange={(text) => docs.setRaw(inferDocKey(intentId), text)}
      rawLabel={t('overview.viewRaw', 'Raw')}
      parseErrorLabel={t('overview.inferParseError', 'Frontmatter error — the form is disabled and saving is blocked')}
    >
      {!entry || !doc ? (
        // Raw-edit race or a broken file: the intent is not derivable. The
        // DefinitionCard frame stays up, so the parse banner and the YAML
        // view remain available to repair the file in place.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FieldHint>{t('intent.notFound', 'This intent no longer exists in the catalog.')}</FieldHint>
          <div>
            <Button size="sm" variant="ghost" onClick={onBackToJob}>
              {t('intent.backToJob', 'Back to the job')}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Textarea
              ref={attachTextarea}
              value={entry.infer}
              disabled={disabled}
              onChange={(e) => docs.updateIntent(intentId, { infer: e.target.value })}
              placeholder={t('overview.intentInfer', 'When does this intent apply? (rendered verbatim as a catalog entry)')}
              rows={6}
              style={{ lineHeight: 1.6, resize: 'none', overflowY: 'auto' }}
            />
            <span style={{ fontSize: 10.5, color: 'var(--text-4)', alignSelf: 'flex-end' }}>
              {t('intent.criteriaChars', '{{count}}/{{max}}', {
                count: entry.infer.length,
                max: INFER_CRITERION_MAX,
              })}
            </span>
          </div>

          <div>
            <FieldLabel>{t('intent.flagsTitle', 'Behavior flags')}</FieldLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 420 }}>
                <span style={{ fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>
                  {t('intent.clarifyLabel', 'Clarify questions')}
                </span>
                <div style={{ width: 200 }}>
                  <AuroraSelect
                    value={clarifyValue}
                    disabled={disabled}
                    options={[
                      { value: 'inherit', label: t('intent.clarifyInherit', 'Inherit (job/agent default)') },
                      { value: 'on', label: t('intent.clarifyOn', 'Allowed') },
                      { value: 'off', label: t('intent.clarifyOff', 'Autonomous (never ask)') },
                    ]}
                    onChange={(v) =>
                      docs.updateIntent(intentId, {
                        clarify: v === 'inherit' ? undefined : v === 'on',
                      })
                    }
                  />
                </div>
              </div>
              <FieldHint tone="muted">
                {t(
                  'intent.clarifyHint',
                  'Autonomous turns never ask a blocking question and proceed with sensible defaults.',
                )}
              </FieldHint>
            </div>
          </div>

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
      )}
    </DefinitionCard>
  );
}

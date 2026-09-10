/**
 * Hooks card — the intent screen's dedicated section for the intent's
 * completion contract, owning `intents/{id}/hooks.yaml` outright as a
 * DefinitionCard (its own form ⇄ raw window, one raw window per file). It is
 * deliberately independent of the sibling infer.md's health: a broken
 * criterion file must not lock hook editing, and vice versa. v1 has one event
 * (`stop` — verified when the turn stops), which the copy explains rather than
 * the section name.
 */

import { useTranslation } from 'react-i18next';
import { AuroraSelect, CONTROL_MEASURE, FIELD_MEASURE, FieldHint } from '@/presentation/components/ConfigEditor/aurora';
import { StopHooksEditor } from './StopHooksEditor';
import { DefinitionCard } from './DefinitionCard';
import { hooksDocKey } from './useDefinitionDocs';
import type { OverviewCtx } from './sections';

export function IntentHooksCard({
  ctx,
  id,
  intentId,
}: {
  ctx: OverviewCtx;
  id: string;
  intentId: string;
}) {
  const { t } = useTranslation('agents');
  const { docs } = ctx;
  const doc = docs.hooksDocs[intentId] ?? null;
  const entry = docs.intents.find((e) => e.id === intentId);
  const disabled = ctx.readonly || doc?.parseError != null;
  const stop = entry?.hooks?.stop ?? [];
  const arm = entry?.hooks?.arm;

  if (!docs.loaded) return null;

  return (
    <DefinitionCard
      id={id}
      icon="CircleCheckBig"
      accent="cool"
      title={t('intent.hooksCardTitle', 'Hooks')}
      description={t(
        'intent.hooksCardDesc',
        "The completion contract verified when the turn stops (the stop event) — from actual tool results, never the model's claims. Stored in this intent's hooks.yaml; an empty list deletes the file.",
      )}
      doc={doc}
      readonly={ctx.readonly}
      onRawChange={(text) => docs.setRaw(hooksDocKey(intentId), text)}
    >
      <StopHooksEditor
        hooks={stop}
        disabled={disabled}
        effectiveBuiltins={docs.main.toolsBuiltin ?? ctx.builtinToolPreset}
        presetBuiltins={ctx.builtinToolPreset}
        extensionServers={ctx.extensionServers}
        onChange={(next) =>
          docs.updateIntent(intentId, { hooks: next.length > 0 ? { stop: next, ...(arm && { arm }) } : undefined })
        }
      />
      {stop.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: CONTROL_MEASURE }}>
            <span style={{ fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>
              {t('intent.hooksArmLabel', 'Owed when')}
            </span>
            <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: FIELD_MEASURE }}>
              <AuroraSelect
                value={arm ?? 'always'}
                disabled={disabled}
                options={[
                  { value: 'always', label: t('intent.hooksArmAlways', 'Every turn (a deliverable)') },
                  { value: 'on-write', label: t('intent.hooksArmOnWrite', 'Only once the turn writes something') },
                ]}
                onChange={(v) =>
                  docs.updateIntent(intentId, { hooks: { stop, arm: v === 'on-write' ? 'on-write' : 'always' } })
                }
              />
            </div>
          </div>
          <FieldHint tone="muted">
            {t(
              'intent.hooksArmHint',
              'A deliverable intent owes its artifact on every turn. An intent that also answers questions or audits should owe it only when the turn actually wrote something — a turn that only reads ends clean.',
            )}
          </FieldHint>
        </div>
      )}
    </DefinitionCard>
  );
}

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
      bodyMaxWidth={560}
    >
      <StopHooksEditor
        hooks={entry?.hooks?.stop ?? []}
        disabled={disabled}
        effectiveBuiltins={docs.main.toolsBuiltin ?? ctx.builtinToolPreset}
        presetBuiltins={ctx.builtinToolPreset}
        mcpServerNames={ctx.mcpServerNames}
        onChange={(stop) =>
          docs.updateIntent(intentId, { hooks: stop.length > 0 ? { stop } : undefined })
        }
      />
    </DefinitionCard>
  );
}

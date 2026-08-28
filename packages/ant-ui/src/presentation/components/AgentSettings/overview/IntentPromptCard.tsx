/**
 * Prompt card — the intent screen's section for `intents/{id}/prompt.md`, the
 * prose the runtime inlines into the system prompt while this intent is
 * active. Plain markdown, so there is no form ⇄ raw split and no parse banner
 * — but it IS markdown, so it gets the same raw ⇄ preview reading toggle as
 * every other prompt surface (shared `proseSurface`; the toggle was the one
 * thing this card was missing). Emptying it deletes the file on save
 * (absence = "no prompt"), mirroring hooks.yaml. Saving rides the shell's
 * single ChangedBar like every other definition doc.
 */

import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import { ProseBody, ProseModeToggle, useProseMode } from '../prompts/proseSurface';
import { promptDocKey } from './useDefinitionDocs';
import type { OverviewCtx } from './sections';

export function IntentPromptCard({
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
  const doc = docs.promptDocs[intentId] ?? null;
  const [mode, setMode] = useProseMode(intentId);

  if (!docs.loaded) return null;

  return (
    <SectionCard
      id={id}
      icon="BookOpen"
      accent="cool"
      title={t('intent.promptTitle', 'Prompt')}
      description={t(
        'intent.promptDesc',
        'Prose added to the system prompt while this intent is active. Leave empty to keep none — an emptied file is deleted on save.',
      )}
      headerAction={<ProseModeToggle mode={mode} onChange={setMode} />}
    >
      <div className="flex flex-col gap-1.5">
        {doc?.dirty && (
          <span className="text-xs font-mono" style={{ color: 'var(--text-4)' }}>
            {t('overview.unsaved', 'unsaved changes')} •
          </span>
        )}
        <ProseBody
          value={doc?.raw ?? ''}
          mode={mode}
          readonly={ctx.readonly}
          onChange={(text) => docs.setRaw(promptDocKey(intentId), text)}
        />
      </div>
    </SectionCard>
  );
}

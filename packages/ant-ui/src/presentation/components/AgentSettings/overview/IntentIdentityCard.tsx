/**
 * Intent card — the intent LEVEL's identity surface, owning the
 * `jobs/{jobId}/intents/{intentId}/` DIRECTORY (the row the file tree opens
 * this screen from).
 *
 * Rename policy, one rule for all three levels: an id IS a directory name, so
 * renaming belongs to the card that owns the level's CONTAINER, never to a card
 * that owns a file inside it. agent.yaml and job.yaml declare their level's
 * identity, so those cards carry name + id; an intent has no declaring file, so
 * its identity gets this card and the sibling infer.md card is left with only
 * what the FILE says — the matching criteria and its frontmatter flag.
 *
 * A PHANTOM intent (added but never saved) has no directory yet, so there is
 * nothing to move: the card explains that instead of offering a rename.
 */

import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import { IdRenameField } from './IdRenameField';
import type { OverviewCtx } from './sections';

export function IntentIdentityCard({
  ctx,
  id,
  jobId,
  intentId,
  onRenameId,
}: {
  ctx: OverviewCtx;
  id: string;
  jobId: string;
  intentId: string;
  /** Structural move (pure directory rename) — the shell owns reselection. */
  onRenameId: (newId: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const { docs } = ctx;

  if (!docs.loaded) return null;

  return (
    <SectionCard
      id={id}
      icon="Target"
      accent="sunset"
      title={t('intent.identityTitle', 'Intent')}
      description={t('intent.identityDesc', 'This intent is the directory jobs/{{jobId}}/intents/{{intentId}}/ — its id is that name. The files inside it are the cards below.', {
        jobId,
        intentId,
      })}
    >
      {docs.isPhantomIntent(intentId) ? (
        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
          {t(
            'intent.phantomHint',
            'New intent — nothing is on disk yet. Author the matching criteria and Save to create intents/{{id}}/.',
            { id: intentId },
          )}
        </p>
      ) : (
        <IdRenameField
          label={t('intent.id', 'Intent id')}
          hint={t(
            'intent.idHint',
            'The id is the intent directory name (intents/{id}/). Changing it moves the directory; @intent: mentions already sent keep referring to the old id.',
          )}
          currentId={intentId}
          // No file declares an intent id, so there is no yaml to drift from.
          yamlId={intentId}
          dirtyCount={docs.dirtyCount}
          readonly={ctx.readonly}
          disabled={ctx.readonly}
          onRename={onRenameId}
        />
      )}
    </SectionCard>
  );
}

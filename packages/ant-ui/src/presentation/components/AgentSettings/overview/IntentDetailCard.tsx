/**
 * Intent detail card — the single editing surface for one intent of the
 * selected job, reduced to the one field an intent owns: its matching
 * criteria (the classifier reads the description verbatim). The intent id
 * lives in the breadcrumb; prompt bindings live in the Prompts section below
 * (single surface). Edits flow through `useDefinitionDocs.updateIntent`, so
 * the shell's ChangedBar saves them into jobs/{jobId}/intents.yaml with the
 * comment-preserving funnel (no bespoke save path).
 */

import { useTranslation } from 'react-i18next';
import { Button, Textarea } from '@/presentation/components/aurora';
import { SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import type { OverviewCtx } from './sections';

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
  const draft = ctx.docs.draft;
  const entry = draft?.intents.find((e) => e.id === intentId);

  if (!draft) return null;
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
        'Describe when this intent applies — the classifier reads this text verbatim.',
      )}
      bodyMaxWidth={560}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Textarea
          value={entry.description}
          disabled={ctx.readonly}
          onChange={(e) => ctx.docs.updateIntent(entry.id, { description: e.target.value })}
          placeholder={t('overview.intentDescription', 'Matching criterion (rendered verbatim as a catalog row)')}
          rows={3}
        />

        {ctx.docs.intentErrors.length > 0 && (
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
            {ctx.docs.intentErrors.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

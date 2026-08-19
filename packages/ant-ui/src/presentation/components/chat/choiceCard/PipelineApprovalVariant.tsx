import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout, THEMES } from './shared';

/**
 * Pipeline approval gate card — a scheduled run is suspended on a human
 * decision. Approve/Reject resolves through the standard choice-resolved
 * funnel (`persistToBackend` → POST /chat/choice-resolved); the BE branch
 * advances the pipeline gate only after the NX-winning resolve, so this card,
 * the pipelines-tab inbox, and the timeout arm can never double-apply.
 */
export function PipelineApprovalVariant({ presented, resolved }: VariantProps) {
  const { t } = useTranslation('pipelines');
  const state = useChoiceCardState({ presented, resolved });

  const payload = (presented.payload ?? {}) as Record<string, any>;
  const pipelineName = payload.pipelineName as string | undefined;
  const stepId = payload.stepId as string | undefined;
  const timeoutAt = payload.timeoutAt as string | undefined;
  const onTimeout = payload.onTimeout as string | undefined;

  const decide = async (choice: 'approve' | 'reject') => {
    if (state.isSelected || state.isLoading) return;
    state.setIsLoading(true);
    const label = choice === 'approve' ? t('card.approved', 'Approved') : t('card.rejected', 'Rejected');
    state.setLocalSelectedChoice(choice);
    state.setLocalResolvedLabel(label);
    try {
      await state.persistToBackend(choice, label);
    } finally {
      state.setIsLoading(false);
    }
  };

  const subtitleParts = [
    pipelineName && stepId ? `${pipelineName} · ${stepId}` : pipelineName,
    timeoutAt
      ? t('card.timeoutHint', 'auto-{{action}} {{when}}', {
          action: onTimeout === 'approve' ? 'approves' : 'rejects',
          when: new Date(timeoutAt).toLocaleString(),
        })
      : undefined,
  ].filter(Boolean);

  return (
    <ChoiceCardShell
      theme="violet"
      icon={<ShieldCheck size={16} style={{ color: THEMES.violet.iconColor }} />}
      title={presented.prompt || t('card.title', 'Pipeline approval')}
      subtitle={subtitleParts.join(' — ') || undefined}
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
    >
      <TwoButtonLayout
        theme="violet"
        positiveLabel={t('card.approve', 'Approve')}
        negativeLabel={t('card.reject', 'Reject')}
        isLoading={state.isLoading}
        onPositive={() => void decide('approve')}
        onNegative={() => void decide('reject')}
      />
    </ChoiceCardShell>
  );
}

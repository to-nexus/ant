/**
 * Promote zone — the single entry point for moving a personal agent into the
 * active team organization. Rendered above the danger zone on the agent
 * detail, and only while a team org is active and the agent is user-scope.
 * Promotion is a MOVE (not a copy): the whole org can then see and run the
 * agent, and the promoter stays its owner.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/presentation/components/aurora';
import { SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

export function PromoteZone({
  id,
  agentName,
  isPromoting,
  onPromote,
}: {
  id: string;
  agentName: string;
  isPromoting: boolean;
  onPromote: () => void;
}) {
  const { t } = useTranslation('agents');
  const { showConfirm } = useAlertModalContext();

  const confirm = () => {
    showConfirm(
      t(
        'promote.confirmMessage',
        'Promote "{{name}}" to your organization? The agent moves out of your personal scope — every member can then see and run it, and you stay its owner.',
        { name: agentName },
      ),
      {
        title: t('promote.confirmTitle', 'Promote to organization'),
        onConfirm: onPromote,
      },
    );
  };

  return (
    <SectionCard
      id={id}
      icon="Building2"
      accent="cool"
      title={t('promote.title', 'Promote to organization')}
      description={t(
        'promote.desc',
        'Share this agent with your whole organization. It moves out of your personal scope; every member can see and run it, and you remain its owner.',
      )}
      bodyMaxWidth={480}
    >
      <div>
        <Button size="sm" type="button" disabled={isPromoting} onClick={confirm}>
          {isPromoting ? t('promote.promoting', 'Promoting…') : t('promote.button', 'Promote to organization')}
        </Button>
      </div>
    </SectionCard>
  );
}

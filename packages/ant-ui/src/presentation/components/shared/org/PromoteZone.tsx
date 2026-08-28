/**
 * Promote zone — the single entry point for moving a personal resource (agent
 * or pipeline) into the active team organization. Rendered above the danger
 * zone on the detail surface, only while a team org is active and the resource
 * is user-scope. Promotion is a MOVE (not a copy): the whole org can then see
 * and use the resource, and the promoter stays its owner.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/presentation/components/aurora';
import { SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

export function PromoteZone({
  id,
  ns = 'agents',
  resourceName,
  isPromoting,
  onPromote,
}: {
  id: string;
  /** i18n namespace carrying `promote.*` keys ('agents' | 'pipelines'). */
  ns?: string;
  resourceName: string;
  isPromoting: boolean;
  onPromote: () => void;
}) {
  const { t } = useTranslation(ns);
  const { showConfirm } = useAlertModalContext();

  const confirm = () => {
    showConfirm(
      t(
        'promote.confirmMessage',
        'Promote "{{name}}" to your organization? It moves out of your personal scope — every member can then see and use it, and you stay its owner.',
        { name: resourceName },
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
        'Share this with your whole organization. It moves out of your personal scope; every member can see and use it, and you remain its owner.',
      )}
    >
      <div>
        <Button size="sm" type="button" disabled={isPromoting} onClick={confirm}>
          {isPromoting ? t('promote.promoting', 'Promoting…') : t('promote.button', 'Promote to organization')}
        </Button>
      </div>
    </SectionCard>
  );
}

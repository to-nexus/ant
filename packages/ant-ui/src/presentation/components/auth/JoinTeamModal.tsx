/**
 * JoinTeamModal — navbar shortcut to the team-discovery surface.
 *
 * Chrome only: the search / join-request body lives in `TeamDiscovery`, which
 * the `c3o-discover` section of `OrgSettingsPanel` renders too, so the two
 * entry points cannot drift.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/presentation/components/common/Modal';
import { Button } from '@/presentation/components/aurora/Button';
import { TeamDiscovery } from '@/presentation/components/org/TeamDiscovery';

interface JoinTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function JoinTeamModal({ isOpen, onClose }: JoinTeamModalProps) {
  const { t } = useTranslation('nav');
  const resetRef = useRef<(() => void) | null>(null);
  const captureReset = useCallback((reset: () => void) => { resetRef.current = reset; }, []);

  if (!isOpen) return null;

  const close = () => {
    resetRef.current?.();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t('auth.joinTeamTitle', 'Join a team')}
      eyebrow={t('auth.joinTeam', 'Join team')}
      accent="aurora"
      size="md"
      footer={
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="sm" onClick={close}>
            {t('auth.close', 'Close')}
          </Button>
        </div>
      }
    >
      <TeamDiscovery onReset={captureReset} />
    </Modal>
  );
}

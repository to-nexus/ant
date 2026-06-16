/**
 * CreateTeamModal — team-switching FOUNDATION (placeholder).
 *
 * The org model already supports many memberships + active-org switch, but
 * team create/join/admin is deferred. This screen exists so the switcher has a
 * "Create team" destination; it collects a name and shows a "coming soon"
 * notice. No BE call yet (no create-team route this iteration).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/presentation/components/common/Modal';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora/AuroraInput';

interface CreateTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateTeamModal({ isOpen, onClose }: CreateTeamModalProps) {
  const { t } = useTranslation('nav');
  const [name, setName] = useState('');

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('auth.createTeamTitle', 'Create a team')}
      eyebrow={t('auth.createTeam', 'Create team')}
      accent="aurora"
      size="sm"
      footer={
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--text-2)' }}
        >
          {t('auth.close', 'Close')}
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
            {t('auth.teamNameLabel', 'Team name')}
          </div>
          <AuroraInput
            value={name}
            onChange={setName}
            placeholder={t('auth.teamNamePlaceholder', 'Acme Inc.')}
          />
        </div>
        <div
          className="rounded p-3 text-xs"
          style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)', color: 'var(--text-3)' }}
        >
          {t(
            'auth.createTeamComingSoon',
            'Team workspaces are coming soon. You can already switch between accounts here; team creation and member invites will arrive in a future release.',
          )}
        </div>
      </div>
    </Modal>
  );
}

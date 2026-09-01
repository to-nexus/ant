/**
 * CreateTeamModal v2 (Phase 1) — real team creation.
 *
 * Collects a name, previews the permanent slug live, calls
 * `POST /api/organizations`, and on success offers an explicit switch
 * (creation never silently changes the active org). Works identically on
 * self-hosted and managed cloud — OSS core, no slot.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/presentation/components/common/Modal';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora/AuroraInput';
import { IdentityOrb } from '@/presentation/components/ConfigEditor/aurora/IdentityOrb';
import { Button } from '@/presentation/components/aurora/Button';
import { createTeam } from '@/infrastructure/http/api/organizations';
import { switchActiveOrg } from '@/application/auth/switchActiveOrg';
import { orgErrorMessage } from '@/presentation/components/org/orgErrors';
import type { OrgSummaryView } from '@ant/shared';

interface CreateTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The org hub uses this to point its sections at the team just created. */
  onCreated?: (organization: OrgSummaryView) => void;
}

/** FE mirror of the BE slugify (preview only — the BE stays authoritative). */
function previewSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function CreateTeamModal({ isOpen, onClose, onCreated }: CreateTeamModalProps) {
  const { t } = useTranslation('nav');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<OrgSummaryView | null>(null);
  const [switching, setSwitching] = useState(false);

  const slug = useMemo(() => previewSlug(name), [name]);

  if (!isOpen) return null;

  const reset = () => {
    setName('');
    setError(null);
    setCreated(null);
    setCreating(false);
    setSwitching(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (creating || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { organization } = await createTeam(name.trim());
      setCreated(organization);
      onCreated?.(organization);
    } catch (err) {
      setError(orgErrorMessage(err, t));
    } finally {
      setCreating(false);
    }
  };

  const switchToTeam = async () => {
    if (!created || switching) return;
    setSwitching(true);
    try {
      await switchActiveOrg(created.id);
    } catch (err) {
      setSwitching(false);
      setError(orgErrorMessage(err, t));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={created ? t('auth.teamReadyTitle', 'Team created') : t('auth.createTeamTitle', 'Create a team')}
      eyebrow={t('auth.createTeam', 'Create team')}
      accent="aurora"
      size="md"
      footer={
        created ? (
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={close}>
              {t('auth.stayInAccount', 'Stay in current account')}
            </Button>
            <Button variant="primary" size="sm" glow loading={switching} onClick={switchToTeam}>
              {t('auth.switchToTeam', 'Switch to {{name}}', { name: created.name })}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={close}>
              {t('auth.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" size="sm" glow loading={creating} disabled={!name.trim()} onClick={submit}>
              {t('auth.createTeamAction', 'Create team')}
            </Button>
          </div>
        )
      }
    >
      {created ? (
        <div className="flex flex-col items-center gap-3 py-4 spring-in">
          <IdentityOrb initial={created.name[0]?.toUpperCase()} size={64} gradient="var(--gradient-cool)" pulse />
          <div className="text-sm text-center" style={{ color: 'var(--text-1)' }}>
            {t('auth.teamReadyBody', "Your team is ready. You're the owner.")}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{created.id}</div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
              {t('auth.teamNameLabel', 'Team name')}
            </div>
            <AuroraInput
              value={name}
              onChange={(v) => { setName(v); setError(null); }}
              placeholder={t('auth.teamNamePlaceholder', 'Acme Inc.')}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
          </div>
          {slug && (
            <div className="flex items-baseline gap-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <span style={{ color: 'var(--text-4)' }}>ant.dev/</span>
              <span style={{ color: 'var(--text-2)' }}>{slug}</span>
            </div>
          )}
          <div className="text-xs" style={{ color: 'var(--text-4)' }}>
            {t('auth.teamIdPermanent', 'This ID is permanent.')}
          </div>
          {error && (
            <div className="text-xs" style={{ color: 'var(--red-500, #ef4444)' }}>{error}</div>
          )}
        </div>
      )}
    </Modal>
  );
}

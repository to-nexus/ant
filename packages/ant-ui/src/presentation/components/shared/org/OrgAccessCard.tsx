/**
 * Org access card — visible only to callers who may manage an org resource's
 * editors (owner ∨ org admin/owner). Shows the recorded owner and a member
 * checklist; `onSaveEditors` writes the delegated editors list (agent and
 * pipeline mounts pass their own API call). The owner is implicit — always an
 * editor, never listed as a checkbox.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomAgentOrgPermissions } from '@ant/shared';
import { Button } from '@/presentation/components/aurora';
import { SectionCard, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';
import { fetchOrgMembers } from '@/infrastructure/http/api/org';

export function OrgAccessCard({
  id,
  ns = 'agents',
  resourceId,
  org,
  onSaveEditors,
  onSaved,
  onError,
}: {
  id: string;
  /** i18n namespace carrying `orgAccess.*` keys ('agents' | 'pipelines'). */
  ns?: string;
  resourceId: string;
  org: CustomAgentOrgPermissions;
  onSaveEditors: (editors: string[]) => Promise<unknown>;
  /** Refresh the list after the editors change (readonly flags may flip). */
  onSaved: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(ns);
  const [members, setMembers] = useState<Array<{ userId: string; isSelf: boolean }>>([]);
  const [editors, setEditors] = useState<string[]>(org.editors ?? []);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditors(org.editors ?? []);
  }, [org.editors, resourceId]);

  useEffect(() => {
    let cancelled = false;
    fetchOrgMembers()
      .then(({ members }) => !cancelled && setMembers(members))
      .catch(() => !cancelled && setMembers([]));
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  const candidates = useMemo(
    () => members.filter((m) => m.userId !== org.owner),
    [members, org.owner],
  );

  const dirty = useMemo(() => {
    const a = [...editors].sort().join('\n');
    const b = [...(org.editors ?? [])].sort().join('\n');
    return a !== b;
  }, [editors, org.editors]);

  const toggle = (userId: string) => {
    setEditors((prev) => (prev.includes(userId) ? prev.filter((e) => e !== userId) : [...prev, userId]));
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await onSaveEditors(editors);
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionCard
      id={id}
      icon="Building2"
      accent="cool"
      title={t('orgAccess.title', 'Organization access')}
      description={t(
        'orgAccess.desc',
        'Every member can see and use this. Editing is limited to the owner, org admins, and the editors you delegate here.',
      )}
      bodyMaxWidth={480}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <FieldLabel>{t('orgAccess.owner', 'Owner')}</FieldLabel>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
            {org.owner ?? t('orgAccess.ownerUnknown', 'unknown (managed by org admins)')}
          </span>
        </div>

        <div>
          <FieldLabel>{t('orgAccess.editors', 'Editors')}</FieldLabel>
          {candidates.length === 0 ? (
            <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
              {t('orgAccess.noMembers', 'No other members in this organization yet.')}
            </span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {candidates.map((m) => (
                <label
                  key={m.userId}
                  className="flex items-center gap-2 cursor-pointer"
                  style={{ fontSize: 12, color: 'var(--text-2)' }}
                >
                  <input
                    type="checkbox"
                    checked={editors.includes(m.userId)}
                    onChange={() => toggle(m.userId)}
                  />
                  <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                    {m.userId}
                    {m.isSelf ? ` ${t('orgAccess.self', '(you)')}` : ''}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {dirty && (
          <div>
            <Button size="sm" type="button" disabled={isSaving} onClick={() => void save()}>
              {isSaving ? t('orgAccess.saving', 'Saving…') : t('orgAccess.save', 'Save editors')}
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

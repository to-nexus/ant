/**
 * Org access card — visible only to callers who may manage an org resource's
 * editors (owner ∨ org admin/owner). Shows the recorded owner and a member
 * checklist. CONTROLLED: the host owns the editors draft and saves it through
 * its own ChangedBar (agents: `editorsDraft`; pipelines: `pipelineEditorsDraft`),
 * so the card never writes. The owner is implicit — always an editor, never
 * listed as a checkbox.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomAgentOrgPermissions } from '@ant/shared';
import { CONTROL_MEASURE, SectionCard, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';
import { fetchOrgMembers } from '@/infrastructure/http/api/org';

export function OrgAccessCard({
  id,
  ns = 'agents',
  resourceId,
  org,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  /** i18n namespace carrying `orgAccess.*` keys ('agents' | 'pipelines'). */
  ns?: string;
  resourceId: string;
  org: CustomAgentOrgPermissions;
  /** Current editors (the host's draft, falling back to `org.editors`). */
  value: string[];
  onChange: (editors: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(ns);
  const [members, setMembers] = useState<Array<{ userId: string; isSelf: boolean }>>([]);

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

  const toggle = (userId: string) => {
    onChange(value.includes(userId) ? value.filter((e) => e !== userId) : [...value, userId]);
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
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: CONTROL_MEASURE }}>
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
                  className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  style={{ fontSize: 12, color: 'var(--text-2)', opacity: disabled ? 0.6 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={value.includes(m.userId)}
                    disabled={disabled}
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
      </div>
    </SectionCard>
  );
}

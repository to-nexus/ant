import { useTranslation } from 'react-i18next';
import { Crown, ShieldCheck, User } from 'lucide-react';
import type { OrgMembershipRole } from '@ant/shared';

/**
 * Role badge — the single role→color/icon mapping (§0 design language):
 * owner = violet + Crown, admin = blue + ShieldCheck, member = neutral.
 */
export function RoleBadge({ role, size = 'md' }: { role: OrgMembershipRole; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('config');
  const spec =
    role === 'owner'
      ? { icon: Crown, color: 'var(--violet-400, #a78bfa)', bg: 'rgba(139, 92, 246, 0.14)', label: t('org.role.owner', 'Owner') }
      : role === 'admin'
        ? { icon: ShieldCheck, color: 'var(--blue-400, #60a5fa)', bg: 'rgba(59, 130, 246, 0.14)', label: t('org.role.admin', 'Admin') }
        : { icon: User, color: 'var(--text-3)', bg: 'var(--bg-surface-2)', label: t('org.role.member', 'Member') };
  const Icon = spec.icon;
  const pad = size === 'sm' ? '1px 6px' : '2px 8px';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full font-semibold"
      style={{ padding: pad, fontSize: size === 'sm' ? 10 : 11, color: spec.color, background: spec.bg }}
    >
      <Icon style={{ width: size === 'sm' ? 10 : 12, height: size === 'sm' ? 10 : 12 }} />
      {spec.label}
    </span>
  );
}

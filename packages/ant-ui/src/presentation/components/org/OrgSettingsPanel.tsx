/**
 * OrgSettingsPanel — team organization settings (Phase 1, §1 of the org plan).
 *
 * Static OSS panel (NOT a slot): rendered by MainContentArea for the
 * `orgSettings` tab. Reachable only when the active org kind is `team`
 * (the navbar entry point is kind-gated), so there is no dead-tab state.
 * AccountConfigEditor scaffold clone: TwoColLayout + TocNav + SectionCard,
 * per-field optimistic saves, destructive actions behind showConfirm.
 *
 * Role model: member sees General (read) / Members (read) / Danger (leave);
 * Invitations + Domains are admin+ only and hidden (not disabled) below that.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  selectActiveUserRole,
  selectIsOrgAdmin,
} from '@/domain/store/selectors';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import {
  TwoColLayout,
  TocNav,
  useActiveSection,
  SectionCard,
  StatusPill,
  IdentityOrb,
  AuroraInput,
  AuroraSelect,
} from '../ConfigEditor/aurora';
import { Button } from '../aurora/Button';
import { Badge } from '../aurora/Badge';
import { Avatar } from '../aurora/Avatar';
import { KebabMenu } from '../aurora/KebabMenu';
import { Copy, Check, Mail, ArrowRightLeft, UserMinus, Trash2 } from 'lucide-react';
import type { OrgInviteRole, OrgMemberView } from '@ant/shared';
import {
  renameOrg,
  deleteOrg,
  leaveOrg,
  removeOrgMember,
  setOrgMemberRole,
  transferOrgOwnership,
  createOrgInvite,
  revokeOrgInvite,
  claimOrgDomain,
  verifyOrgDomain,
  deleteOrgDomain,
} from '@/infrastructure/http/api/organizations';
import { RoleBadge } from './RoleBadge';
import { InviteLinkChip } from './InviteLinkChip';
import { orgErrorMessage } from './orgErrors';

const SECTION_IDS = ['c3o-general', 'c3o-members', 'c3o-invitations', 'c3o-domains', 'c3o-danger'] as const;

export function OrgSettingsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation('config');
  const { showError, showSuccess, showConfirm } = useAlertModalContext();

  const orgId = useStore((s) => s.userOrganization);
  const userId = useStore((s) => s.userId);
  const userEmail = useStore((s) => s.userEmail);
  const role = useStore(selectActiveUserRole) ?? 'member';
  const isAdmin = useStore(selectIsOrgAdmin);
  const isOwner = role === 'owner';
  const orgName = useStore(
    (s) => s.memberships.find((m) => m.organizationId === s.userOrganization)?.name ?? s.userOrganization,
  );

  const orgMembers = useStore((s) => s.orgMembers);
  const orgMembersStatus = useStore((s) => s.orgMembersStatus);
  const orgInvites = useStore((s) => s.orgInvites);
  const orgDomains = useStore((s) => s.orgDomains);
  const loadOrgMembers = useStore((s) => s.loadOrgMembers);
  const loadOrgInvites = useStore((s) => s.loadOrgInvites);
  const loadOrgDomains = useStore((s) => s.loadOrgDomains);
  const resetOrgResources = useStore((s) => s.resetOrgResources);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useActiveSection(
    SECTION_IDS as unknown as string[],
    scrollerRef,
  );

  useEffect(() => {
    if (!orgId) return;
    void loadOrgMembers(orgId);
    if (isAdmin) {
      void loadOrgInvites(orgId);
      void loadOrgDomains(orgId);
    }
    return () => resetOrgResources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, isAdmin]);

  const refetchAuth = useCallback(async () => {
    const { fetchAuthMeDetailed } = await import('@/infrastructure/http/api/auth');
    const result = await fetchAuthMeDetailed();
    if (result.kind === 'user') {
      useStore
        .getState()
        .setUser(
          result.user.email,
          result.user.organization,
          result.user.name,
          result.user.picture,
          result.user.userId,
          result.user.orgKind,
          result.memberships,
          result.user.approvalStatus,
          result.user.testAccountLevel,
        );
      useStore.getState().setJoinSurface(result.pendingInvites, result.domainJoinableOrgs);
    }
  }, []);

  // ── General ────────────────────────────────────────────────────────────

  const [nameDraft, setNameDraft] = useState(orgName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  useEffect(() => setNameDraft(orgName ?? ''), [orgName]);

  const saveName = async () => {
    if (!orgId || savingName || !nameDraft.trim() || nameDraft.trim() === orgName) return;
    setSavingName(true);
    try {
      await renameOrg(orgId, nameDraft.trim());
      await refetchAuth();
      showSuccess(t('org.general.renamed', 'Organization name updated.'));
    } catch (err) {
      setNameDraft(orgName ?? '');
      showError(orgErrorMessage(err, t));
    } finally {
      setSavingName(false);
    }
  };

  const copyOrgId = async () => {
    if (!orgId) return;
    try {
      await navigator.clipboard.writeText(orgId);
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1500);
    } catch { /* selectable text remains */ }
  };

  // ── Members ────────────────────────────────────────────────────────────

  const refreshMembers = useCallback(async () => {
    if (orgId) await loadOrgMembers(orgId);
  }, [orgId, loadOrgMembers]);

  const changeRole = (member: OrgMemberView, nextRole: 'admin' | 'member') => {
    if (!orgId || member.role === nextRole) return;
    showConfirm(
      t('org.members.confirmRole', 'Change {{email}} to {{role}}?', {
        email: member.email,
        role: nextRole,
      }),
      {
        title: t('org.members.changeRoleTitle', 'Change role'),
        onConfirm: async () => {
          try {
            await setOrgMemberRole(orgId, member.userId, nextRole);
            await refreshMembers();
          } catch (err) {
            showError(orgErrorMessage(err, t));
            await refreshMembers();
          }
        },
      },
    );
  };

  const transferTo = (member: OrgMemberView) => {
    if (!orgId) return;
    showConfirm(
      t(
        'org.members.confirmTransfer',
        'Transfer ownership to {{email}}? You will become an admin.',
        { email: member.email },
      ),
      {
        type: 'warning',
        title: t('org.members.transferTitle', 'Transfer ownership'),
        onConfirm: async () => {
          try {
            await transferOrgOwnership(orgId, member.userId);
            await refetchAuth();
            await refreshMembers();
            showSuccess(t('org.members.transferred', 'Ownership transferred.'));
          } catch (err) {
            showError(orgErrorMessage(err, t));
          }
        },
      },
    );
  };

  const removeMember = async (member: OrgMemberView) => {
    if (!orgId) return;
    try {
      await removeOrgMember(orgId, member.userId);
      await refreshMembers();
    } catch (err) {
      showError(orgErrorMessage(err, t));
      await refreshMembers();
    }
  };

  // ── Invitations ────────────────────────────────────────────────────────

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgInviteRole>('member');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [freshInviteToken, setFreshInviteToken] = useState<string | null>(null);

  const submitInvite = async () => {
    if (!orgId || creatingInvite || !inviteEmail.trim()) return;
    setCreatingInvite(true);
    setInviteError(null);
    try {
      const { invite } = await createOrgInvite(orgId, inviteEmail.trim(), inviteRole);
      setFreshInviteToken(invite.token);
      setInviteEmail('');
      try {
        await navigator.clipboard.writeText(
          `${window.location.origin}/app/?invite=${encodeURIComponent(invite.token)}`,
        );
        showSuccess(t('org.invites.copiedToast', 'Invite link copied to clipboard.'));
      } catch { /* chip copy still available */ }
      await loadOrgInvites(orgId);
    } catch (err) {
      setInviteError(orgErrorMessage(err, t));
    } finally {
      setCreatingInvite(false);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    if (!orgId) return;
    try {
      await revokeOrgInvite(orgId, inviteId);
      await loadOrgInvites(orgId);
    } catch (err) {
      showError(orgErrorMessage(err, t));
      await loadOrgInvites(orgId);
    }
  };

  // ── Domains ────────────────────────────────────────────────────────────

  const [domainDraft, setDomainDraft] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [verifyingDomain, setVerifyingDomain] = useState<string | null>(null);
  const emailHost = useMemo(() => userEmail?.split('@')[1]?.toLowerCase() ?? '', [userEmail]);
  const hostAlreadyClaimed = orgDomains.some((d) => d.domain === emailHost);

  const claimDomain = async (domain: string) => {
    if (!orgId || claiming || !domain.trim()) return;
    setClaiming(true);
    setDomainError(null);
    try {
      const { domain: claim } = await claimOrgDomain(orgId, domain.trim());
      setDomainDraft('');
      await loadOrgDomains(orgId);
      if (claim.status === 'verified') {
        showSuccess(t('org.domains.verifiedInstant', 'Domain verified — it matches your sign-in email.'));
      }
    } catch (err) {
      setDomainError(orgErrorMessage(err, t));
    } finally {
      setClaiming(false);
    }
  };

  const verifyDomain = async (domain: string) => {
    if (!orgId || verifyingDomain) return;
    setVerifyingDomain(domain);
    try {
      const res = await verifyOrgDomain(orgId, domain);
      await loadOrgDomains(orgId);
      if (res.verified) {
        showSuccess(t('org.domains.verified', 'Domain verified.'));
      } else {
        showError(t('org.domains.txtNotVisible', 'TXT record not visible yet — DNS changes can take a while to propagate.'));
      }
    } catch (err) {
      showError(orgErrorMessage(err, t));
    } finally {
      setVerifyingDomain(null);
    }
  };

  const removeDomain = async (domain: string) => {
    if (!orgId) return;
    try {
      await deleteOrgDomain(orgId, domain);
      await loadOrgDomains(orgId);
    } catch (err) {
      showError(orgErrorMessage(err, t));
      await loadOrgDomains(orgId);
    }
  };

  // ── Danger ─────────────────────────────────────────────────────────────

  const soleMember = orgMembers.length === 1;

  const handleLeave = () => {
    if (!orgId) return;
    showConfirm(
      t('org.danger.confirmLeave', 'Leave {{org}}? Your account switches back to Individual.', { org: orgName }),
      {
        type: 'warning',
        title: t('org.danger.leaveTitle', 'Leave organization'),
        onConfirm: async () => {
          try {
            await leaveOrg(orgId);
            window.location.reload();
          } catch (err) {
            showError(orgErrorMessage(err, t));
          }
        },
      },
    );
  };

  const handleDelete = () => {
    if (!orgId) return;
    showConfirm(
      t(
        'org.danger.confirmDelete',
        'Delete {{org}}? The organization is deactivated and its id stays reserved. Workspace files are preserved.',
        { org: orgName },
      ),
      {
        type: 'warning',
        title: t('org.danger.deleteTitle', 'Delete organization'),
        onConfirm: async () => {
          try {
            await deleteOrg(orgId);
            window.location.reload();
          } catch (err) {
            showError(orgErrorMessage(err, t));
          }
        },
      },
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const tocNode = (
    <TocNav
      items={[
        { id: 'c3o-general', label: t('org.tocGeneral', 'General'), icon: 'Building2' },
        { id: 'c3o-members', label: t('org.tocMembers', 'Members'), icon: 'Users' },
        ...(isAdmin
          ? [
              { id: 'c3o-invitations', label: t('org.tocInvitations', 'Invitations'), icon: 'Mail' as const },
              { id: 'c3o-domains', label: t('org.tocDomains', 'Domains'), icon: 'Globe' as const },
            ]
          : []),
        { id: 'c3o-danger', label: t('org.tocDanger', 'Danger'), icon: 'AlertTriangle' },
      ]}
      active={activeSection}
      onSelect={(id) => {
        setActiveSection(id);
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    />
  );

  const pendingInvitesList = orgInvites.filter((i) => i.status === 'pending' || i.status === 'expired');

  return (
    <div className="h-full flex flex-col spring-in" style={{ background: 'var(--bg-canvas)', overflow: 'hidden' }}>
      {/* Header band */}
      <div className="flex items-center gap-4 px-6 pt-6 pb-2 shrink-0">
        <IdentityOrb initial={orgName?.[0]?.toUpperCase()} size={56} gradient="var(--gradient-cool)" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-2xl, 22px)', color: 'var(--text-1)' }}>
              {orgName}
            </span>
            <RoleBadge role={role} />
            <Badge tone="info" size="sm">{t('org.kindTeam', 'Team')}</Badge>
          </div>
          <div style={{ color: 'var(--text-4)', fontSize: 12 }}>
            {t('org.headerMeta', '{{count}} member(s)', { count: orgMembers.length })}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border-1)' }}
          >
            {t('org.close', 'Close')}
          </button>
        )}
      </div>

      <div ref={scrollerRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <TwoColLayout toc={tocNode}>
          {/* General */}
          <SectionCard
            id="c3o-general"
            icon="Building2"
            title={t('org.general.title', 'General')}
            description={t('org.general.description', 'Organization identity. The id is permanent; the display name is yours to change.')}
            accent="violet-pink"
          >
            <div className="space-y-4">
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                  {t('org.general.nameLabel', 'Organization name')}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <AuroraInput value={nameDraft} onChange={setNameDraft} disabled={!isAdmin || savingName} />
                  </div>
                  {isAdmin && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={savingName}
                      disabled={!nameDraft.trim() || nameDraft.trim() === orgName}
                      onClick={saveName}
                    >
                      {t('org.general.save', 'Save')}
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                  {t('org.general.idLabel', 'Organization id')}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="px-2 py-1.5 rounded flex-1 truncate select-all"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}
                  >
                    {orgId}
                  </span>
                  <button onClick={copyOrgId} className="p-1.5 rounded" aria-label={t('org.general.copyId', 'Copy id')} style={{ color: idCopied ? 'var(--emerald-400, #34d399)' : 'var(--text-3)' }}>
                    {idCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <StatusPill state="configured" label={t('org.general.immutable', 'Immutable')} />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Members */}
          <SectionCard
            id="c3o-members"
            icon="Users"
            title={t('org.members.title', 'Members')}
            description={t('org.members.description', 'Everyone in this organization. Admins manage members; only the owner changes roles.')}
            accent="aurora"
          >
            {orgMembersStatus === 'loading' && orgMembers.length === 0 ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="rounded" style={{ height: 48, background: 'var(--bg-surface-2)', opacity: 0.5 }} />
                ))}
              </div>
            ) : (
              <div>
                {orgMembers.map((m) => {
                  const isSelf = m.userId === userId;
                  const kebabItems = [] as any[];
                  if (isOwner && !isSelf && m.role !== 'owner') {
                    kebabItems.push({
                      icon: ArrowRightLeft,
                      label: t('org.members.transferAction', 'Transfer ownership…'),
                      onClick: () => transferTo(m),
                    });
                  }
                  const canRemove = !isSelf && m.role !== 'owner' && (isOwner || (isAdmin && m.role === 'member'));
                  if (canRemove) {
                    kebabItems.push({
                      icon: UserMinus,
                      label: t('org.members.removeAction', 'Remove from organization'),
                      variant: 'danger' as const,
                      confirm: true,
                      confirmLabel: t('org.members.removeConfirm', 'Confirm remove'),
                      onClick: () => void removeMember(m),
                    });
                  }
                  return (
                    <div
                      key={m.userId}
                      className="flex items-center gap-3 py-2"
                      style={{ minHeight: 48, borderBottom: '1px solid var(--border-1)' }}
                    >
                      <Avatar src={m.picture} name={m.name || m.email} size={32} gradient="cool" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm truncate" style={{ color: 'var(--text-1)' }}>
                            {m.name || m.email.split('@')[0]}
                          </span>
                          {isSelf && (
                            <Badge tone="brand" size="sm">{t('org.members.you', 'You')}</Badge>
                          )}
                        </div>
                        <div className="truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                          {m.email}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                        {new Date(m.joinedAt).toLocaleDateString()}
                      </span>
                      {isOwner && !isSelf && m.role !== 'owner' ? (
                        <div style={{ width: 120 }}>
                          <AuroraSelect
                            value={m.role}
                            onChange={(v) => changeRole(m, v as 'admin' | 'member')}
                            options={[
                              { value: 'admin', label: t('org.role.admin', 'Admin') },
                              { value: 'member', label: t('org.role.member', 'Member') },
                            ]}
                          />
                        </div>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                      {kebabItems.length > 0 && <KebabMenu items={kebabItems} ariaLabel={t('org.members.actions', 'Member actions')} />}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Invitations (admin+) */}
          {isAdmin && (
            <SectionCard
              id="c3o-invitations"
              icon="Mail"
              title={t('org.invites.title', 'Invitations')}
              description={t('org.invites.description', "We don't send emails. Share the link yourself — invitees also see the invite when they sign in with this email.")}
              accent="pink-orange"
            >
              <div className="space-y-4">
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                      {t('org.invites.emailLabel', 'Email')}
                    </div>
                    <AuroraInput
                      value={inviteEmail}
                      onChange={(v) => { setInviteEmail(v); setInviteError(null); }}
                      placeholder="teammate@company.com"
                      type="email"
                      mono
                      onKeyDown={(e) => { if (e.key === 'Enter') void submitInvite(); }}
                    />
                  </div>
                  <div style={{ width: 130 }}>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                      {t('org.invites.roleLabel', 'Role')}
                    </div>
                    <AuroraSelect
                      value={inviteRole}
                      onChange={(v) => setInviteRole(v as OrgInviteRole)}
                      options={[
                        { value: 'member', label: t('org.role.member', 'Member') },
                        ...(isOwner ? [{ value: 'admin', label: t('org.role.admin', 'Admin') }] : []),
                      ]}
                    />
                  </div>
                  <Button variant="primary" size="sm" glow loading={creatingInvite} disabled={!inviteEmail.trim()} onClick={submitInvite}>
                    {t('org.invites.create', 'Create invite')}
                  </Button>
                </div>
                {inviteError && (
                  <div className="text-xs" style={{ color: 'var(--red-500, #ef4444)' }}>{inviteError}</div>
                )}
                {freshInviteToken && (
                  <div className="spring-in">
                    <InviteLinkChip token={freshInviteToken} />
                    <div className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>
                      {t('org.invites.linkCaption', 'This link expires in 14 days and only works for the invited email.')}
                    </div>
                  </div>
                )}

                {pendingInvitesList.length === 0 ? (
                  <div className="flex items-center gap-2 py-3" style={{ color: 'var(--text-4)', fontSize: 12 }}>
                    <Mail className="w-4 h-4" />
                    {t('org.invites.empty', 'No pending invites.')}
                  </div>
                ) : (
                  <div>
                    {pendingInvitesList.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center gap-3 py-2"
                        style={{ borderBottom: '1px solid var(--border-1)', opacity: inv.status === 'expired' ? 0.6 : 1 }}
                      >
                        <span
                          className="inline-block rounded-full shrink-0"
                          style={{ width: 6, height: 6, background: inv.status === 'expired' ? 'var(--text-4)' : 'var(--amber-400, #fbbf24)' }}
                        />
                        <span className="truncate flex-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>
                          {inv.email}
                        </span>
                        <RoleBadge role={inv.role} size="sm" />
                        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                          {inv.status === 'expired'
                            ? t('org.invites.expired', 'Expired')
                            : t('org.invites.expires', 'Expires {{date}}', { date: new Date(inv.expiresAt).toLocaleDateString() })}
                        </span>
                        <InviteLinkChip token={inv.token} />
                        <Button variant="ghost" size="xs" onClick={() => void revokeInvite(inv.id)}>
                          {t('org.invites.revoke', 'Revoke')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* Domains (admin+) */}
          {isAdmin && (
            <SectionCard
              id="c3o-domains"
              icon="Globe"
              title={t('org.domains.title', 'Email domains')}
              description={t('org.domains.description', 'People who sign in with a verified domain can join this team in one click.')}
              accent="cool"
            >
              <div className="space-y-4">
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                      {t('org.domains.claimLabel', 'Domain')}
                    </div>
                    <AuroraInput
                      value={domainDraft}
                      onChange={(v) => { setDomainDraft(v); setDomainError(null); }}
                      placeholder="company.com"
                      mono
                      onKeyDown={(e) => { if (e.key === 'Enter') void claimDomain(domainDraft); }}
                    />
                  </div>
                  <Button variant="primary" size="sm" loading={claiming} disabled={!domainDraft.trim()} onClick={() => void claimDomain(domainDraft)}>
                    {t('org.domains.claim', 'Claim domain')}
                  </Button>
                </div>
                {emailHost && !hostAlreadyClaimed && (
                  <button
                    onClick={() => void claimDomain(emailHost)}
                    className="text-xs px-2 py-1 rounded-full"
                    style={{ border: '1px dashed var(--border-2)', color: 'var(--text-3)' }}
                  >
                    {t('org.domains.suggestChip', 'Claim {{domain}} — matches your sign-in email, verifies instantly', { domain: emailHost })}
                  </button>
                )}
                {domainError && (
                  <div className="text-xs" style={{ color: 'var(--red-500, #ef4444)' }}>{domainError}</div>
                )}

                {orgDomains.map((d) => (
                  <div
                    key={d.domain}
                    className="rounded p-3 space-y-2"
                    style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-1)' }}>{d.domain}</span>
                      <StatusPill
                        state={d.status === 'verified' ? 'configured' : 'not-configured'}
                        label={
                          d.status === 'verified'
                            ? t('org.domains.statusVerified', 'Verified')
                            : d.status === 'rejected'
                              ? t('org.domains.statusRejected', 'Rejected')
                              : t('org.domains.statusPending', 'Pending')
                        }
                      />
                      <div className="flex-1" />
                      {isOwner && (
                        <KebabMenu
                          items={[{
                            icon: Trash2,
                            label: t('org.domains.deleteAction', 'Delete claim'),
                            variant: 'danger' as const,
                            confirm: true,
                            onClick: () => void removeDomain(d.domain),
                          }]}
                          ariaLabel={t('org.domains.actions', 'Domain actions')}
                        />
                      )}
                    </div>
                    {d.status === 'pending' && (
                      <div className="space-y-1 text-xs" style={{ color: 'var(--text-3)' }}>
                        <div>{t('org.domains.txtInstructions', 'Add this DNS TXT record, then verify:')}</div>
                        <div className="grid gap-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
                          <span style={{ color: 'var(--text-4)' }}>{t('org.domains.txtName', 'Name')}</span>
                          <code className="select-all" style={{ fontFamily: 'var(--font-mono)' }}>{d.txtRecordName}</code>
                          <span style={{ color: 'var(--text-4)' }}>{t('org.domains.txtValue', 'Value')}</span>
                          <code className="select-all break-all" style={{ fontFamily: 'var(--font-mono)' }}>{d.verificationToken}</code>
                        </div>
                        <Button variant="secondary" size="xs" loading={verifyingDomain === d.domain} onClick={() => void verifyDomain(d.domain)}>
                          {t('org.domains.verify', 'Verify')}
                        </Button>
                      </div>
                    )}
                    {d.status === 'verified' && (
                      <div className="text-xs" style={{ color: 'var(--text-4)' }}>
                        {d.verifiedBy === 'email'
                          ? t('org.domains.verifiedViaEmail', 'Verified via email match')
                          : d.verifiedBy === 'dns'
                            ? t('org.domains.verifiedViaDns', 'Verified via DNS')
                            : t('org.domains.verifiedByOperator', 'Verified by operator')}
                        {' · '}
                        {t('org.domains.joinHint', 'Sign-ins @{{domain}} can join with one click.', { domain: d.domain })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Danger */}
          <SectionCard
            id="c3o-danger"
            icon="AlertTriangle"
            title={t('org.danger.title', 'Danger zone')}
            accent="sunset"
          >
            <div className="space-y-3">
              {!isOwner && (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {t('org.danger.leaveHint', 'Leave this organization. Your account switches back to Individual.')}
                  </div>
                  <Button variant="danger" size="sm" onClick={handleLeave}>
                    {t('org.danger.leave', 'Leave organization')}
                  </Button>
                </div>
              )}
              {isOwner && !soleMember && (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {t('org.danger.ownerBlocked', 'Owners must transfer ownership before leaving or deleting.')}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => document.getElementById('c3o-members')?.scrollIntoView({ behavior: 'smooth' })}
                  >
                    {t('org.danger.goToMembers', 'Go to members')}
                  </Button>
                </div>
              )}
              {isOwner && soleMember && (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {t('org.danger.deleteHint', 'Deactivate this organization. The id stays reserved; workspace files are preserved.')}
                  </div>
                  <Button variant="danger" size="sm" onClick={handleDelete}>
                    {t('org.danger.delete', 'Delete organization')}
                  </Button>
                </div>
              )}
            </div>
          </SectionCard>
        </TwoColLayout>
      </div>
    </div>
  );
}

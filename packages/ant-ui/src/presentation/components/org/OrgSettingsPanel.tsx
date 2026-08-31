/**
 * OrgSettingsPanel — the organization hub for every cloud account.
 *
 * Static OSS panel (NOT a slot): rendered by MainContentArea for the
 * `orgSettings` tab, reachable from the navbar by ANY signed-in cloud account
 * — including one that belongs to no team, which lands on My teams (empty) +
 * Find a team rather than on a dead tab.
 * AccountConfigEditor scaffold clone: TwoColLayout + TocNav + SectionCard,
 * per-field optimistic saves, destructive actions behind showConfirm.
 *
 * The panel is scoped to `selectedOrgId`, NOT to the active org: `requireTeamRole`
 * resolves from the path orgId and the live membership row, so a team can be
 * inspected and left without switching into it first. Everything below the two
 * always-present sections is gated on a selection.
 *
 * Role model: member sees General (read) / Members (read) / Danger (leave);
 * Invitations, Join requests and Domains are admin+ only and hidden (not
 * disabled) below that — admin-ness is per SELECTED org.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  selectRoleForOrg,
  selectTeamMemberships,
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
import { Copy, Check, Mail, ArrowRightLeft, UserMinus, Trash2, X, Undo2, LogOut, ChevronRight } from 'lucide-react';
import type { OrgInviteRole, OrgMemberView } from '@ant/shared';
import {
  fetchOrg,
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
  updateOrgDomain,
  setOrgDiscoverable,
  approveJoinRequest,
  rejectJoinRequest,
  clearRemovedMember,
} from '@/infrastructure/http/api/organizations';
import { RoleBadge } from './RoleBadge';
import { InviteLinkChip } from './InviteLinkChip';
import { orgErrorMessage } from './orgErrors';
import { TeamDiscovery } from './TeamDiscovery';
import { switchOrg } from '@/infrastructure/http/api/auth';

const SECTION_IDS = [
  'c3o-teams',
  'c3o-discover',
  'c3o-general',
  'c3o-members',
  'c3o-requests',
  'c3o-invitations',
  'c3o-domains',
  'c3o-danger',
] as const;

export function OrgSettingsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation('config');
  const { showError, showSuccess, showConfirm } = useAlertModalContext();

  const activeOrgId = useStore((s) => s.userOrganization);
  const activeOrgKind = useStore((s) => s.userOrgKind);
  const teamMemberships = useStore(selectTeamMemberships);
  const userId = useStore((s) => s.userId);
  const userEmail = useStore((s) => s.userEmail);

  /**
   * The org this panel is acting on. Defaults to the active org when that is a
   * team; a personal-only account starts with no selection and sees the two
   * always-present sections only.
   */
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(
    activeOrgKind === 'team' ? (activeOrgId ?? null) : null,
  );

  // A membership that disappears underneath us (leave, admin removal, org
  // delete) must not leave the detail sections pointed at a dead org.
  useEffect(() => {
    if (selectedOrgId && !teamMemberships.some((m) => m.organizationId === selectedOrgId)) {
      setSelectedOrgId(null);
    }
  }, [teamMemberships, selectedOrgId]);

  const orgId = selectedOrgId;
  const role = useStore((s) => selectRoleForOrg(s, selectedOrgId)) ?? 'member';
  const isAdmin = role === 'owner' || role === 'admin';
  const isOwner = role === 'owner';
  const orgName = useStore(
    (s) => s.memberships.find((m) => m.organizationId === selectedOrgId)?.name ?? selectedOrgId ?? '',
  );

  const orgMembers = useStore((s) => s.orgMembers);
  const orgMembersStatus = useStore((s) => s.orgMembersStatus);
  const orgInvites = useStore((s) => s.orgInvites);
  const orgDomains = useStore((s) => s.orgDomains);
  const orgJoinRequests = useStore((s) => s.orgJoinRequests);
  const orgJoinRequestsStatus = useStore((s) => s.orgJoinRequestsStatus);
  const orgRemovedMembers = useStore((s) => s.orgRemovedMembers);
  const loadOrgMembers = useStore((s) => s.loadOrgMembers);
  const loadOrgInvites = useStore((s) => s.loadOrgInvites);
  const loadOrgDomains = useStore((s) => s.loadOrgDomains);
  const loadOrgJoinRequests = useStore((s) => s.loadOrgJoinRequests);
  const loadOrgRemovedMembers = useStore((s) => s.loadOrgRemovedMembers);
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
      void loadOrgJoinRequests(orgId);
      void loadOrgRemovedMembers(orgId);
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
      useStore.getState().setJoinSurface(result);
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

  // ── Discoverability ────────────────────────────────────────────────────

  // `discoverable` is not on the membership view, so the panel reads it from
  // the org record on mount and keeps its own optimistic copy afterwards.
  const [discoverable, setDiscoverable] = useState<boolean | null>(null);
  const [savingDiscoverable, setSavingDiscoverable] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    void (async () => {
      try {
        const { organization } = await fetchOrg(orgId);
        if (alive) setDiscoverable(organization.discoverable);
      } catch {
        if (alive) setDiscoverable(null);
      }
    })();
    return () => { alive = false; };
  }, [orgId]);

  const toggleDiscoverable = async (next: boolean) => {
    if (!orgId || savingDiscoverable) return;
    setSavingDiscoverable(true);
    const previous = discoverable;
    setDiscoverable(next);
    try {
      await setOrgDiscoverable(orgId, next);
    } catch (err) {
      setDiscoverable(previous);
      showError(orgErrorMessage(err, t));
    } finally {
      setSavingDiscoverable(false);
    }
  };

  // ── Join requests ──────────────────────────────────────────────────────

  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null);
  const [requestRoles, setRequestRoles] = useState<Record<string, OrgInviteRole>>({});

  const decideRequest = async (
    requestId: string,
    decision: 'approve' | 'reject',
  ) => {
    if (!orgId || decidingRequestId) return;
    setDecidingRequestId(requestId);
    try {
      if (decision === 'approve') {
        await approveJoinRequest(orgId, requestId, requestRoles[requestId]);
        await refreshMembers();
        await loadOrgRemovedMembers(orgId);
      } else {
        await rejectJoinRequest(orgId, requestId);
      }
      await loadOrgJoinRequests(orgId);
    } catch (err) {
      showError(orgErrorMessage(err, t));
      await loadOrgJoinRequests(orgId);
    } finally {
      setDecidingRequestId(null);
    }
  };

  // ── Removal rows (the domain-shortcut blocklist) ───────────────────────

  const allowAgain = (userIdToClear: string, email: string) => {
    if (!orgId) return;
    showConfirm(
      t(
        'org.removed.confirmAllow',
        'Let {{email}} join again through the email domain?',
        { email },
      ),
      {
        title: t('org.removed.allowTitle', 'Allow domain join'),
        onConfirm: async () => {
          try {
            await clearRemovedMember(orgId, userIdToClear);
            await loadOrgRemovedMembers(orgId);
          } catch (err) {
            showError(orgErrorMessage(err, t));
          }
        },
      },
    );
  };

  // ── Domains ────────────────────────────────────────────────────────────

  const [domainDraft, setDomainDraft] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [verifyingDomain, setVerifyingDomain] = useState<string | null>(null);
  const [savingDomainPolicy, setSavingDomainPolicy] = useState<string | null>(null);
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

  const saveDomainPolicy = async (
    domain: string,
    patch: { autoJoin?: boolean; autoJoinRole?: OrgInviteRole },
  ) => {
    if (!orgId || savingDomainPolicy) return;
    setSavingDomainPolicy(domain);
    try {
      await updateOrgDomain(orgId, domain, patch);
      await loadOrgDomains(orgId);
    } catch (err) {
      showError(orgErrorMessage(err, t));
      await loadOrgDomains(orgId);
    } finally {
      setSavingDomainPolicy(null);
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

  /**
   * Leaving reloads: the JWT still carries the old `org` claim, and
   * `removeMembership` reverts `currentOrganizationId` server-side, so the tab
   * must re-authenticate rather than keep a stale tenant.
   */
  const handleLeave = (targetOrgId?: string, targetName?: string) => {
    const id = targetOrgId ?? orgId;
    if (!id) return;
    showConfirm(
      t('org.danger.confirmLeave', 'Leave {{org}}? Your account switches back to Individual.', {
        org: targetName ?? orgName,
      }),
      {
        type: 'warning',
        title: t('org.danger.leaveTitle', 'Leave organization'),
        onConfirm: async () => {
          try {
            await leaveOrg(id);
            window.location.reload();
          } catch (err) {
            showError(orgErrorMessage(err, t));
          }
        },
      },
    );
  };

  const handleSwitch = async (targetOrgId: string) => {
    try {
      await switchOrg(targetOrgId);
      window.location.reload();
    } catch (err) {
      showError(orgErrorMessage(err, t));
    }
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

  const pendingJoinRequests = orgJoinRequests.filter((r) => r.status === 'pending');

  const tocNode = (
    <TocNav
      items={[
        {
          id: 'c3o-teams',
          label: t('org.tocTeams', 'My teams'),
          icon: 'Users' as const,
          ...(teamMemberships.length > 0 ? { count: teamMemberships.length } : {}),
        },
        { id: 'c3o-discover', label: t('org.tocDiscover', 'Find a team'), icon: 'Search' as const },
        // Everything below acts on the SELECTED org — absent until one is picked.
        ...(orgId
          ? [
              { id: 'c3o-general', label: t('org.tocGeneral', 'General'), icon: 'Building2' as const },
              { id: 'c3o-members', label: t('org.tocMembers', 'Members'), icon: 'Users' as const },
            ]
          : []),
        ...(orgId && isAdmin
          ? [
              {
                id: 'c3o-requests',
                label: t('org.requests.toc', 'Join requests'),
                icon: 'UserPlus' as const,
                ...(pendingJoinRequests.length > 0 ? { count: pendingJoinRequests.length } : {}),
              },
              { id: 'c3o-invitations', label: t('org.tocInvitations', 'Invitations'), icon: 'Mail' as const },
              { id: 'c3o-domains', label: t('org.tocDomains', 'Domains'), icon: 'Globe' as const },
            ]
          : []),
        ...(orgId
          ? [{ id: 'c3o-danger', label: t('org.tocDanger', 'Danger'), icon: 'AlertTriangle' as const }]
          : []),
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
      {/* Header band — identifies the SELECTED org, or the hub itself when none. */}
      <div className="flex items-center gap-4 px-6 pt-6 pb-2 shrink-0">
        <IdentityOrb
          initial={orgId ? orgName?.[0]?.toUpperCase() : undefined}
          size={56}
          gradient="var(--gradient-cool)"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-2xl, 22px)', color: 'var(--text-1)' }}>
              {orgId ? orgName : t('org.hubTitle', 'Organizations')}
            </span>
            {orgId && <RoleBadge role={role} />}
            {orgId && <Badge tone="info" size="sm">{t('org.kindTeam', 'Team')}</Badge>}
            {orgId && orgId === activeOrgId && (
              <Badge tone="success" size="sm">{t('org.badgeActive', 'Active')}</Badge>
            )}
          </div>
          <div style={{ color: 'var(--text-4)', fontSize: 12 }}>
            {orgId
              ? t('org.headerMeta', '{{count}} member(s)', { count: orgMembers.length })
              : t('org.hubSubtitle', 'Your teams, and how to join one.')}
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
          {/* My teams — always present. Individual is not a manageable org
              (ownerId is null), so only `team` memberships are listed. */}
          <SectionCard
            id="c3o-teams"
            icon="Users"
            title={t('org.teams.title', 'My teams')}
            description={t('org.teams.description', 'Teams you belong to. Select one to manage it — you do not have to switch into it first.')}
            accent="violet-pink"
          >
            {teamMemberships.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                {t('org.teams.empty', 'You are not a member of any team yet. Find one below, or ask an admin for an invite.')}
              </div>
            ) : (
              <div className="space-y-1">
                {teamMemberships.map((m) => {
                  const isSelected = m.organizationId === selectedOrgId;
                  const isActive = m.organizationId === activeOrgId;
                  return (
                    <div
                      key={m.organizationId}
                      className="flex items-center gap-3 px-2 py-2 rounded"
                      style={{
                        background: isSelected ? 'var(--bg-hover)' : 'transparent',
                        border: `1px solid ${isSelected ? 'var(--border-2)' : 'transparent'}`,
                      }}
                    >
                      <Avatar name={m.name} size={28} />
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setSelectedOrgId(m.organizationId)}
                      >
                        <span className="block truncate text-sm" style={{ color: 'var(--text-1)' }}>
                          {m.name}
                        </span>
                        <span
                          className="block truncate"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)' }}
                        >
                          {m.organizationId}
                        </span>
                      </button>
                      <RoleBadge role={m.role} />
                      {isActive && (
                        <Badge tone="success" size="sm">{t('org.badgeActive', 'Active')}</Badge>
                      )}
                      {!isSelected && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setSelectedOrgId(m.organizationId)}
                        >
                          {t('org.teams.select', 'Manage')}
                          <ChevronRight className="w-3 h-3" />
                        </Button>
                      )}
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void handleSwitch(m.organizationId)}
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          {t('org.teams.switch', 'Switch to')}
                        </Button>
                      )}
                      {/* An owner must transfer first — the BE 403s either way. */}
                      {m.role !== 'owner' && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleLeave(m.organizationId, m.name)}
                        >
                          <LogOut className="w-3 h-3" />
                          {t('org.teams.leave', 'Leave')}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Find a team — same component the navbar's Join-a-team modal renders. */}
          <SectionCard
            id="c3o-discover"
            icon="Search"
            title={t('org.discover.title', 'Find a team')}
            description={t('org.discover.description', 'Only teams that opted into discovery are listed. Searching finds a team; an admin still approves the request.')}
            accent="cool"
          >
            <TeamDiscovery listMaxHeight={360} />
          </SectionCard>

          {/* Everything below acts on the selected org. */}
          {orgId && (
          <>
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
              {isAdmin && (
                <div style={{ borderTop: '1px solid var(--border-1)', paddingTop: 12 }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs" style={{ color: 'var(--text-2)' }}>
                        {t('org.general.discoverableLabel', 'Discoverable in organization search')}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-4)' }}>
                        {t(
                          'org.general.discoverableHint',
                          'Exposes this name and id to signed-in accounts so they can send a join request. It grants nothing on its own — an admin still approves every request.',
                        )}
                      </div>
                    </div>
                    <div style={{ width: 110 }}>
                      <AuroraSelect
                        value={discoverable === true ? 'on' : 'off'}
                        onChange={(v) => void toggleDiscoverable(v === 'on')}
                        options={[
                          { value: 'off', label: t('org.general.discoverableOff', 'Hidden') },
                          { value: 'on', label: t('org.general.discoverableOn', 'Discoverable') },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              )}
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

            {/* Removal rows — an admin's removal (or a member's own exit) must
                survive the next login, so it also blocks the domain shortcut
                until cleared here. */}
            {isAdmin && orgRemovedMembers.length > 0 && (
              <div
                className="mt-4 p-3"
                style={{
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-1)',
                  borderRadius: 'var(--r-md)',
                }}
              >
                <div className="text-xs mb-1" style={{ color: 'var(--text-2)' }}>
                  {t('org.removed.title', 'Excluded from domain auto-join')}
                  {' '}
                  <span style={{ color: 'var(--text-4)' }}>({orgRemovedMembers.length})</span>
                </div>
                <div className="text-[11px] mb-2" style={{ color: 'var(--text-4)' }}>
                  {t(
                    'org.removed.description',
                    'These accounts left or were removed. The email-domain shortcut stays closed for them; an invite or an approved join request re-opens it.',
                  )}
                </div>
                {orgRemovedMembers.map((r) => (
                  <div
                    key={r.userId}
                    className="flex items-center gap-2 py-1.5"
                    style={{ borderTop: '1px solid var(--border-1)' }}
                  >
                    <span
                      className="min-w-0 flex-1 truncate"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}
                    >
                      {r.email}
                    </span>
                    <Badge tone={r.reason === 'removed' ? 'warning' : 'neutral'} size="sm">
                      {r.reason === 'removed'
                        ? t('org.removed.reasonRemoved', 'Removed')
                        : t('org.removed.reasonLeft', 'Left')}
                    </Badge>
                    <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                      {new Date(r.removedAt).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => allowAgain(r.userId, r.email)}
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      {t('org.removed.allowAgain', 'Allow again')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Join requests (admin+) */}
          {isAdmin && (
            <SectionCard
              id="c3o-requests"
              icon="UserPlus"
              title={t('org.requests.title', 'Join requests')}
              description={t(
                'org.requests.description',
                'Accounts that found this team in search and asked to join. Approving grants membership; discovery alone grants nothing.',
              )}
              accent="pink-orange"
            >
              {orgJoinRequestsStatus === 'loading' && orgJoinRequests.length === 0 ? (
                <div className="space-y-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="rounded" style={{ height: 48, background: 'var(--bg-surface-2)', opacity: 0.5 }} />
                  ))}
                </div>
              ) : pendingJoinRequests.length === 0 ? (
                <div className="text-xs" style={{ color: 'var(--text-4)' }}>
                  {discoverable === true
                    ? t('org.requests.empty', 'No pending requests.')
                    : t(
                        'org.requests.emptyHidden',
                        'No pending requests — this team is not discoverable in search, so it can only be joined by invitation or email domain.',
                      )}
                </div>
              ) : (
                <div>
                  {pendingJoinRequests.map((r) => {
                    const busy = decidingRequestId === r.id;
                    return (
                      <div
                        key={r.id}
                        className="py-2"
                        style={{ borderBottom: '1px solid var(--border-1)' }}
                      >
                        <div className="flex items-center gap-3" style={{ minHeight: 48 }}>
                          <Avatar name={r.email} size={32} gradient="cool" />
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate"
                              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-1)' }}
                            >
                              {r.email}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                              {t('org.requests.requestedOn', 'Requested {{date}}', {
                                date: new Date(r.createdAt).toLocaleDateString(),
                              })}
                            </div>
                          </div>
                          {isOwner && (
                            <div style={{ width: 120 }}>
                              <AuroraSelect
                                value={requestRoles[r.id] ?? 'member'}
                                onChange={(v) =>
                                  setRequestRoles((prev) => ({ ...prev, [r.id]: v as OrgInviteRole }))
                                }
                                options={[
                                  { value: 'member', label: t('org.role.member', 'Member') },
                                  { value: 'admin', label: t('org.role.admin', 'Admin') },
                                ]}
                              />
                            </div>
                          )}
                          <Button
                            variant="primary"
                            size="xs"
                            loading={busy}
                            onClick={() => void decideRequest(r.id, 'approve')}
                          >
                            {t('org.requests.approve', 'Approve')}
                          </Button>
                          <KebabMenu
                            items={[
                              {
                                icon: X,
                                label: t('org.requests.reject', 'Reject request'),
                                variant: 'danger' as const,
                                confirm: true,
                                confirmLabel: t('org.requests.rejectConfirm', 'Confirm reject'),
                                onClick: () => void decideRequest(r.id, 'reject'),
                              },
                            ]}
                            ariaLabel={t('org.requests.actions', 'Join request actions')}
                          />
                        </div>
                        {r.message && (
                          <div
                            className="mt-1 ml-11 px-2 py-1.5 text-xs"
                            style={{
                              background: 'var(--bg-surface-2)',
                              color: 'var(--text-2)',
                              borderRadius: 'var(--r-md)',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {r.message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          )}

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
              description={t('org.domains.description', 'A verified domain puts every sign-in on it into this team. Turn auto-join off to offer the join instead of granting it.')}
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
                      <>
                        <div className="text-xs" style={{ color: 'var(--text-4)' }}>
                          {d.verifiedBy === 'email'
                            ? t('org.domains.verifiedViaEmail', 'Verified via email match')
                            : d.verifiedBy === 'dns'
                              ? t('org.domains.verifiedViaDns', 'Verified via DNS')
                              : t('org.domains.verifiedByOperator', 'Verified by operator')}
                          {' · '}
                          {d.autoJoin
                            ? t('org.domains.joinHintAuto', 'Sign-ins @{{domain}} are added to this team automatically.', { domain: d.domain })
                            : t('org.domains.joinHintOffer', 'Sign-ins @{{domain}} are offered a one-click join.', { domain: d.domain })}
                        </div>
                        <div
                          className="flex items-end gap-2 flex-wrap"
                          style={{ borderTop: '1px solid var(--border-1)', paddingTop: 8 }}
                        >
                          <div style={{ width: 150 }}>
                            <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                              {t('org.domains.autoJoinLabel', 'On sign-in')}
                            </div>
                            <AuroraSelect
                              value={d.autoJoin ? 'auto' : 'offer'}
                              onChange={(v) => void saveDomainPolicy(d.domain, { autoJoin: v === 'auto' })}
                              options={[
                                { value: 'auto', label: t('org.domains.autoJoinOn', 'Add to team') },
                                { value: 'offer', label: t('org.domains.autoJoinOff', 'Offer only') },
                              ]}
                            />
                          </div>
                          <div style={{ width: 130 }}>
                            <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                              {t('org.domains.autoJoinRoleLabel', 'Role granted')}
                            </div>
                            <AuroraSelect
                              value={d.autoJoinRole}
                              onChange={(v) => void saveDomainPolicy(d.domain, { autoJoinRole: v as OrgInviteRole })}
                              options={[
                                { value: 'member', label: t('org.role.member', 'Member') },
                                ...(isOwner ? [{ value: 'admin', label: t('org.role.admin', 'Admin') }] : []),
                              ]}
                            />
                          </div>
                          {savingDomainPolicy === d.domain && (
                            <span className="text-[11px] pb-2" style={{ color: 'var(--text-4)' }}>
                              {t('org.domains.savingPolicy', 'Saving…')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--text-4)' }}>
                          {t(
                            'org.domains.autoJoinHint',
                            'Auto-join is re-checked at every sign-in, so accounts that existed before this claim are picked up on their next login. Members you remove stay out until you allow them again.',
                          )}
                        </div>
                      </>
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
                  <Button variant="danger" size="sm" onClick={() => handleLeave()}>
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
          </>
          )}
        </TwoColLayout>
      </div>
    </div>
  );
}

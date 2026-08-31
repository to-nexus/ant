/**
 * OrgBanners — the org join surface strip rendered right below the nav bar.
 * Self-gating: cloud mode ∧ authenticated. Static OSS component (no slot).
 *
 * Priority: invite > auto-join notice > domain-join offer. Only one shows at
 * a time (+ a "+n more" chip for invites). The three are mutually exclusive
 * in practice: an org either auto-joins a domain (notice) or offers it
 * (banner), never both.
 *
 * A `?invite={token}` deep link is consumed here: the invite is accepted
 * immediately (the click WAS the consent), then a switch prompt follows.
 *
 * The auto-join notice is a NOTICE, not an offer — the membership already
 * exists (a login granted it from a verified domain claim). Dismissing it
 * hides the strip; it never leaves the team.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Globe, Mail } from 'lucide-react';
import { useStore } from '@/domain/store';
import {
  selectServerMode,
  selectIsAuthenticated,
  selectVisiblePendingInvites,
  selectVisibleDomainJoinableOrgs,
  selectVisibleAutoJoinedOrg,
} from '@/domain/store/selectors';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { Button } from '../aurora/Button';
import { RoleBadge } from './RoleBadge';
import { acceptOrgInvite, joinByDomain } from '@/infrastructure/http/api/organizations';
import { fetchAuthMeDetailed } from '@/infrastructure/http/api/auth';
import { switchActiveOrg } from '@/application/auth/switchActiveOrg';
import { orgErrorMessage } from './orgErrors';

const INVITE_TOKEN_SS_KEY = 'ant-ui:org:invite-token';

async function refreshJoinSurface(): Promise<void> {
  const result = await fetchAuthMeDetailed();
  if (result.kind === 'user') {
    useStore.getState().setJoinSurface(result);
  }
}

export function OrgBanners() {
  const { t } = useTranslation('nav');
  const { showConfirm, showError } = useAlertModalContext();
  const { toast } = useToastContext();

  const serverMode = useStore(selectServerMode);
  const isAuthenticated = useStore(selectIsAuthenticated);
  const userEmail = useStore((s) => s.userEmail);
  const invites = useStore(selectVisiblePendingInvites);
  const domainOrgs = useStore(selectVisibleDomainJoinableOrgs);
  const autoJoinedOrg = useStore(selectVisibleAutoJoinedOrg);
  const inviteTokenFromUrl = useStore((s) => s.inviteTokenFromUrl);
  const dismissInvite = useStore((s) => s.dismissInvite);
  const dismissDomainBanner = useStore((s) => s.dismissDomainBanner);
  const dismissAutoJoinBanner = useStore((s) => s.dismissAutoJoinBanner);
  const setInviteTokenFromUrl = useStore((s) => s.setInviteTokenFromUrl);

  const [busy, setBusy] = useState(false);
  const consumedTokenRef = useRef<string | null>(null);

  const offerSwitch = (orgId: string, orgName: string) => {
    showConfirm(t('auth.switchPrompt', 'Switch to {{org}} now?', { org: orgName }), {
      title: t('auth.joinedTitle', 'Joined {{org}}', { org: orgName }),
      confirmText: t('auth.switchNow', 'Switch'),
      onConfirm: async () => {
        try {
          await switchActiveOrg(orgId);
        } catch (err) {
          showError(orgErrorMessage(err, t));
        }
      },
    });
  };

  const acceptToken = async (token: string) => {
    setBusy(true);
    try {
      const res = await acceptOrgInvite(token);
      if (res.alreadyMember) {
        offerSwitch(res.organization.id, res.organization.name);
      } else {
        toast.success(t('auth.joinedToast', 'Joined {{org}}', { org: res.organization.name }));
        offerSwitch(res.organization.id, res.organization.name);
      }
      await refreshJoinSurface();
    } catch (err) {
      showError(orgErrorMessage(err, t));
      await refreshJoinSurface();
    } finally {
      setBusy(false);
    }
  };

  // Deep-link consumption — once per token, only when signed in (the token
  // survives the OAuth round-trip in sessionStorage).
  useEffect(() => {
    if (serverMode !== 'cloud' || !isAuthenticated || !userEmail) return;
    let token = inviteTokenFromUrl;
    if (!token) {
      try {
        token = sessionStorage.getItem(INVITE_TOKEN_SS_KEY);
      } catch { /* ignore */ }
    }
    if (!token || consumedTokenRef.current === token) return;
    consumedTokenRef.current = token;
    try {
      sessionStorage.removeItem(INVITE_TOKEN_SS_KEY);
    } catch { /* ignore */ }
    setInviteTokenFromUrl(null);
    void acceptToken(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMode, isAuthenticated, userEmail, inviteTokenFromUrl]);

  if (serverMode !== 'cloud' || !isAuthenticated || !userEmail) return null;

  const invite = invites[0];
  const moreInvites = invites.length - 1;
  const autoJoined = !invite ? autoJoinedOrg : null;
  const domainOrg = !invite && !autoJoined ? domainOrgs[0] : undefined;

  if (!invite && !autoJoined && !domainOrg) return null;

  const stripStyle: React.CSSProperties = {
    minHeight: 40,
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border-1)',
  };

  return (
    <div className="w-full shrink-0 spring-in" role="status" style={stripStyle}>
      <div
        style={{
          height: 3,
          background: invite ? 'var(--gradient-violet-pink)' : 'var(--gradient-cool)',
          // Both non-invite banners are domain-sourced, so they share the
          // cool hairline — the icon is what distinguishes them.
        }}
      />
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
        {invite ? (
          <>
            <Mail className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--violet-400, #a78bfa)' }} />
            <span className="min-w-0 truncate">
              <strong>{invite.invitedBy}</strong>{' '}
              {t('auth.inviteBannerBody', 'invited you to')}{' '}
              <strong>{invite.organizationName}</strong>
            </span>
            <RoleBadge role={invite.role} size="sm" />
            {moreInvites > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--bg-surface-2)', color: 'var(--text-4)', fontSize: 10 }}
              >
                {t('auth.moreInvites', '+{{count}} more', { count: moreInvites })}
              </span>
            )}
            <div className="flex-1" />
            <Button variant="primary" size="xs" loading={busy} onClick={() => void acceptToken(invite.token)}>
              {t('auth.acceptInvite', 'Accept')}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => dismissInvite(invite.id)}>
              {t('auth.dismiss', 'Dismiss')}
            </Button>
          </>
        ) : autoJoined ? (
          <>
            <Building2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--cyan-400, #22d3ee)' }} />
            <span className="min-w-0 truncate">
              {t('auth.autoJoinBannerBody', 'You were added to')}{' '}
              <strong>{autoJoined.organizationName}</strong>{' '}
              {t('auth.autoJoinBannerVia', 'via')} <strong>@{autoJoined.domain}</strong>
            </span>
            <div className="flex-1" />
            <Button
              variant="primary"
              size="xs"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await switchActiveOrg(autoJoined.organizationId);
                } catch (err) {
                  showError(orgErrorMessage(err, t));
                  setBusy(false);
                }
              }}
            >
              {t('auth.switchNow', 'Switch')}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => dismissAutoJoinBanner(autoJoined.organizationId)}
            >
              {t('auth.dismiss', 'Dismiss')}
            </Button>
          </>
        ) : domainOrg ? (
          <>
            <Globe className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--cyan-400, #22d3ee)' }} />
            <span className="min-w-0 truncate">
              {t('auth.domainBannerBody', 'Your email domain')}{' '}
              <strong>@{domainOrg.domain}</strong>{' '}
              {t('auth.domainBannerMatches', 'matches')}{' '}
              <strong>{domainOrg.organizationName}</strong>
              {' — '}
              {t('auth.domainBannerJoinHint', 'you can join this team.')}
            </span>
            <div className="flex-1" />
            <Button
              variant="primary"
              size="xs"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await joinByDomain(domainOrg.organizationId);
                  toast.success(t('auth.joinedToast', 'Joined {{org}}', { org: res.organization.name }));
                  offerSwitch(res.organization.id, res.organization.name);
                  await refreshJoinSurface();
                } catch (err) {
                  showError(orgErrorMessage(err, t));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('auth.joinDomain', 'Join')}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => dismissDomainBanner(domainOrg.organizationId)}>
              {t('auth.notNow', 'Not now')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

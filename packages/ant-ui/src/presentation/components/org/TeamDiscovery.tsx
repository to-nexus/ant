/**
 * TeamDiscovery — search a team, then act on the one you picked.
 *
 * Search finds a team; it never joins one. Finding and joining are separate
 * acts, and the join is always the user pointing at a row and pressing
 * something — which is why the retired onboarding screen's free-join
 * autocomplete was not revived (it bypassed the invite and domain gates), and
 * why login-time domain auto-join is now opt-in rather than the default.
 *
 * Every row therefore carries an action, and which one depends on what this
 * account may already do with that team:
 *   member → switch into it · domain-entitled → join outright (no approval to
 *   wait for) · request already open → withdraw · otherwise → ask to join.
 * A row with a bare `Member` badge and no control was the shape that read as
 * "searching joined me": the membership had come from a silent login grant and
 * the screen offered nothing to explain or undo it.
 *
 * Presentational and chrome-free so the two entry points render the same code:
 * `JoinTeamModal` (navbar shortcut) and the `c3o-discover` section of
 * `OrgSettingsPanel`. `active` lets a host skip the debounce timer while it is
 * not visible.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Users } from 'lucide-react';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora/AuroraInput';
import { Button } from '@/presentation/components/aurora/Button';
import { Badge } from '@/presentation/components/aurora/Badge';
import { Spinner } from '@/presentation/components/common/async';
import { useStore } from '@/domain/store';
import { selectMyPendingJoinRequestByOrg } from '@/domain/store/selectors';
import {
  searchOrganizations,
  createJoinRequest,
  cancelJoinRequest,
  joinByDomain,
  type OrganizationSummary,
} from '@/infrastructure/http/api/organizations';
import { switchActiveOrg } from '@/application/auth/switchActiveOrg';
import { fetchAuthMeDetailed } from '@/infrastructure/http/api/auth';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { orgErrorMessage } from '@/presentation/components/org/orgErrors';
import { JOIN_REQUEST_MESSAGE_MAX } from '@ant/shared';

const SEARCH_DEBOUNCE_MS = 300;
/** Matches the BE floor — below this the endpoint returns an empty list. */
const MIN_SEARCH_LENGTH = 2;

export function TeamDiscovery({
  active = true,
  listMaxHeight = 280,
  onReset,
}: {
  active?: boolean;
  listMaxHeight?: number;
  /** Receives a reset callback so a host (the modal) can clear on close. */
  onReset?: (reset: () => void) => void;
}) {
  const { t } = useTranslation('nav');
  const { toast } = useToastContext();

  const memberships = useStore((s) => s.memberships);
  const pendingByOrg = useStore(selectMyPendingJoinRequestByOrg);
  const setJoinSurface = useStore((s) => s.setJoinSurface);
  const activeOrgId = useStore((s) => s.userOrganization);
  // Raw, not `selectVisibleDomainJoinableOrgs`: that selector subtracts banner
  // dismissals, and dismissing a banner must not delete the button here.
  const domainJoinableOrgs = useStore((s) => s.domainJoinableOrgs);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OrganizationSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Org id whose message composer is open. */
  const [composingFor, setComposingFor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const memberOrgIds = useMemo(
    () => new Set(memberships.map((m) => m.organizationId)),
    [memberships],
  );
  const domainByOrg = useMemo(
    () => new Map(domainJoinableOrgs.map((d) => [d.organizationId, d])),
    [domainJoinableOrgs],
  );

  useEffect(() => {
    if (!onReset) return;
    onReset(() => {
      setQuery('');
      setResults([]);
      setError(null);
      setComposingFor(null);
      setMessage('');
      setBusyOrgId(null);
    });
  }, [onReset]);

  // Debounced search. Same shape the retired onboarding screen used — the
  // only precedent for calling `searchOrganizations`.
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!active || trimmed.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        setResults(await searchOrganizations(trimmed, 20));
      } catch (err) {
        console.warn('[TeamDiscovery] search failed', err);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [query, active]);

  /** Refresh `myJoinRequests` so the rows reflect the new state. */
  const refreshJoinSurface = async () => {
    const result = await fetchAuthMeDetailed();
    if (result.kind === 'user') setJoinSurface(result);
  };

  const submitRequest = async (org: OrganizationSummary) => {
    if (busyOrgId) return;
    setBusyOrgId(org.id);
    setError(null);
    try {
      await createJoinRequest(org.id, message.trim() || undefined);
      await refreshJoinSurface();
      setComposingFor(null);
      setMessage('');
      toast.success(t('auth.joinRequestSent', 'Request sent to {{name}}', { name: org.name }));
    } catch (err) {
      setError(orgErrorMessage(err, t));
    } finally {
      setBusyOrgId(null);
    }
  };

  /** The domain shortcut, taken deliberately — the BE re-validates it. */
  const acceptDomainJoin = async (org: OrganizationSummary) => {
    if (busyOrgId) return;
    setBusyOrgId(org.id);
    setError(null);
    try {
      await joinByDomain(org.id);
      await refreshJoinSurface();
      toast.success(t('auth.joinedToast', 'Joined {{org}}', { org: org.name }));
    } catch (err) {
      setError(orgErrorMessage(err, t));
    } finally {
      setBusyOrgId(null);
    }
  };

  const withdraw = async (requestId: string, orgId: string) => {
    if (busyOrgId) return;
    setBusyOrgId(orgId);
    setError(null);
    try {
      await cancelJoinRequest(requestId);
      await refreshJoinSurface();
    } catch (err) {
      setError(orgErrorMessage(err, t));
    } finally {
      setBusyOrgId(null);
    }
  };

  const trimmed = query.trim();
  const overBudget = message.length > JOIN_REQUEST_MESSAGE_MAX;

  return (
    <div className="space-y-3">
      <AuroraInput
        value={query}
        onChange={(v) => { setQuery(v); setError(null); }}
        placeholder={t('auth.joinTeamSearchHint', 'Search by team name or ID')}
        prefix={<Search className="w-3.5 h-3.5" style={{ color: 'var(--text-4)' }} />}
        suffix={searching ? <Spinner size="sm" tone="muted" /> : undefined}
      />

      {trimmed.length < MIN_SEARCH_LENGTH ? (
        <div className="text-xs" style={{ color: 'var(--text-4)' }}>
          {t(
            'auth.joinTeamEmptyHint',
            'Only teams that opted into discovery are listed. A private team joins you by invitation.',
          )}
        </div>
      ) : !searching && results.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--text-4)' }}>
          {t('auth.joinTeamNoResults', 'No teams match that search.')}
        </div>
      ) : (
        <ul
          className="overflow-y-auto"
          style={{ maxHeight: listMaxHeight, margin: 0, padding: 0, listStyle: 'none' }}
        >
          {results.map((org) => {
            const isMember = memberOrgIds.has(org.id);
            const domainEntry = isMember ? undefined : domainByOrg.get(org.id);
            const pending = pendingByOrg.get(org.id);
            const busy = busyOrgId === org.id;
            return (
              <li key={org.id} style={{ borderTop: '1px solid var(--border-1)' }}>
                <div className="flex items-center gap-3" style={{ height: 48 }}>
                  <span
                    className="inline-flex items-center justify-center rounded-full shrink-0 font-semibold"
                    style={{
                      width: 32,
                      height: 32,
                      fontSize: 11,
                      color: '#fff',
                      background: 'var(--gradient-cool)',
                    }}
                  >
                    {org.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" style={{ color: 'var(--text-1)' }}>
                      {org.name}
                    </span>
                    <span
                      className="block truncate"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)' }}
                    >
                      {org.id}
                    </span>
                  </span>
                  {isMember ? (
                    <span className="flex items-center gap-2 shrink-0">
                      <Badge tone="info">{t('auth.joinTeamMember', 'Member')}</Badge>
                      {org.id !== activeOrgId && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void switchActiveOrg(org.id)}
                        >
                          {t('auth.switchNow', 'Switch')}
                        </Button>
                      )}
                    </span>
                  ) : domainEntry ? (
                    // Nothing to approve — this account's verified email domain
                    // already entitles it. Offering a request instead would ask
                    // an admin to grant what the org has already granted.
                    <Button
                      variant="primary"
                      size="xs"
                      loading={busy}
                      onClick={() => void acceptDomainJoin(org)}
                    >
                      {t('auth.joinDomain', 'Join')}
                    </Button>
                  ) : pending ? (
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        {t('auth.joinTeamPending', 'Requested')}
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        loading={busy}
                        onClick={() => void withdraw(pending.id, org.id)}
                      >
                        {t('auth.joinTeamWithdraw', 'Withdraw')}
                      </Button>
                    </span>
                  ) : composingFor === org.id ? null : (
                    <Button
                      variant="primary"
                      size="xs"
                      onClick={() => { setComposingFor(org.id); setMessage(''); }}
                    >
                      {t('auth.joinTeamRequest', 'Request to join')}
                    </Button>
                  )}
                </div>

                {domainEntry && (
                  <div className="pb-2 text-[11px]" style={{ color: 'var(--text-4)' }}>
                    {t(
                      'auth.joinTeamDomainHint',
                      'Your email domain ({{domain}}) lets you join this team without approval.',
                      { domain: domainEntry.domain },
                    )}
                  </div>
                )}

                {composingFor === org.id && !isMember && !domainEntry && !pending && (
                  <div className="pb-3 space-y-2 spring-in">
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={3}
                      autoFocus
                      placeholder={t(
                        'auth.joinTeamMessagePlaceholder',
                        'Optional — tell the admins who you are',
                      )}
                      className="w-full px-2 py-1.5 text-xs resize-none"
                      style={{
                        background: 'var(--bg-surface-2)',
                        color: 'var(--text-1)',
                        border: `1px solid ${overBudget ? 'var(--red-500, #ef4444)' : 'var(--border-1)'}`,
                        borderRadius: 'var(--r-md)',
                      }}
                    />
                    <div className="flex items-center justify-between">
                      <span
                        className="text-[10px]"
                        style={{ color: overBudget ? 'var(--red-500, #ef4444)' : 'var(--text-4)' }}
                      >
                        {message.length} / {JOIN_REQUEST_MESSAGE_MAX}
                      </span>
                      <span className="flex items-center gap-2">
                        <Button variant="ghost" size="xs" onClick={() => setComposingFor(null)}>
                          {t('auth.cancel', 'Cancel')}
                        </Button>
                        <Button
                          variant="primary"
                          size="xs"
                          glow
                          loading={busy}
                          disabled={overBudget}
                          onClick={() => void submitRequest(org)}
                        >
                          {t('auth.joinTeamSend', 'Send request')}
                        </Button>
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <div className="text-xs" style={{ color: 'var(--red-500, #ef4444)' }}>{error}</div>
      )}

      <div className="flex items-start gap-2 pt-1" style={{ color: 'var(--text-4)' }}>
        <Users className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span className="text-[11px]">
          {t(
            'auth.joinTeamApprovalNote',
            'An admin of the team approves requests. You will see the team in your account switcher once approved.',
          )}
        </span>
      </div>
    </div>
  );
}

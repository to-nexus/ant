import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, ShieldOff } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { useStore } from '@/domain/store';
import { fetchAuthMeDetailed } from '@/infrastructure/http/api';
import { useSignOut } from '@/application/hooks/ui/useSignOut';

const RECHECK_COOLDOWN_MS = 3000;

/**
 * Account-approval screen — replaces the entire app shell while the signed-in
 * cloud account is `pending` or `denied`.
 *
 * Rendered from a state-driven branch in `App.tsx` (`selectShowApprovalGate`)
 * rather than a URL route, so it covers every way into the product with one
 * predicate: the OAuth redirect, a deep link, QuickStart, the project wizard.
 *
 * It mounts no nav bar, no banners and no lifecycle hooks. The only request it
 * can make is the explicit "check again" → `/auth/me`, which is a public path —
 * so this screen produces zero 403s against the surface guard that put it here.
 */
export function AccountApprovalGate() {
  const { t } = useTranslation('common');
  const userEmail = useStore((s) => s.userEmail);
  const approvalStatus = useStore((s) => s.approvalStatus);
  const setUser = useStore((s) => s.setUser);
  const clearUser = useStore((s) => s.clearUser);
  const signOut = useSignOut();

  const [checking, setChecking] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [stillPending, setStillPending] = useState(false);

  const denied = approvalStatus === 'denied';

  // Re-read the verdict without a re-login. An admin approval lands in Redis
  // immediately, and the JWT carries no approval claim, so one `/auth/me` is
  // all it takes for the gate to unmount.
  const recheck = async () => {
    if (checking || cooling) return;
    setChecking(true);
    setStillPending(false);
    try {
      const result = await fetchAuthMeDetailed();
      if (result.kind === 'user') {
        setUser(
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
        // Still gated → say so, rather than leaving the button looking inert.
        if (result.user.approvalStatus === 'pending' || result.user.approvalStatus === 'denied') {
          setStillPending(true);
        }
      } else {
        // The session died while we were waiting — fall back to signed-out.
        clearUser();
      }
    } catch (err) {
      console.warn('[Approval] re-check failed', err);
      setStillPending(true);
    } finally {
      setChecking(false);
      setCooling(true);
      window.setTimeout(() => setCooling(false), RECHECK_COOLDOWN_MS);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[color:var(--bg-canvas)] px-4">
      <div
        className="w-full max-w-md bg-[color:var(--bg-surface)] shadow-lg p-8"
        style={{ border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          {denied ? (
            <ShieldOff className="w-8 h-8" style={{ color: 'var(--status-error-fg, #dc2626)' }} />
          ) : (
            <Clock className="w-8 h-8 text-indigo-600" />
          )}
          <h1 className="text-xl font-semibold text-[color:var(--text-1)]">
            {denied ? t('approval.gate.deniedTitle') : t('approval.gate.pendingTitle')}
          </h1>
        </div>

        <div role="status" aria-live="polite">
          <p className="text-sm leading-relaxed text-[color:var(--text-3)] mb-2">
            {denied
              ? t('approval.gate.deniedBody', { email: userEmail ?? '' })
              : t('approval.gate.pendingBody', { email: userEmail ?? '' })}
          </p>
          {!denied && (
            <p className="text-xs leading-relaxed text-[color:var(--text-3)] mb-6">
              {t('approval.gate.pendingHint')}
            </p>
          )}
          {stillPending && (
            <p className="text-xs text-[color:var(--text-3)] mb-4">
              {denied ? t('approval.gate.stillDenied') : t('approval.gate.stillPending')}
            </p>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => void recheck()}
            disabled={checking || cooling}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white transition-colors"
          >
            {checking && <Spinner size="sm" tone="inverse" />}
            {t('approval.gate.recheck')}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-[color:var(--bg-surface-2)] hover:bg-[color:var(--bg-active)] text-[color:var(--text-2)] transition-colors"
          >
            {t('approval.gate.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}

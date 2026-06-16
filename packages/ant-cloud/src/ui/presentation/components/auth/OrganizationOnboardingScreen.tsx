import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Check, Users } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { useStore } from '@/domain/store';
import {
  searchOrganizations,
  submitOnboardingOrganization,
  type OrganizationSummary,
} from '@cloud/infrastructure/http/api/organizations';
import { fetchAuthMeDetailed } from '@/infrastructure/http/api';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 1;

/**
 * Post-OAuth onboarding screen.
 *
 * Shown when `/auth/me` reports `needsOnboarding: true` (the JWT carries
 * the `_pending` sentinel). Single input — organization name — with
 * three resolution paths:
 *
 *   - User selects a suggestion from autocomplete → joins existing org
 *     (handshake / free-join model)
 *   - User types a new name → creates new org with that slug
 *   - User skips / submits empty → BE auto-resolves (consumer email →
 *     `personal-${sub}`, business email → domain)
 *
 * After successful submission the BE re-mints the JWT with the real
 * org claim; we re-fetch `/auth/me` to flip the store back to
 * `needsOnboarding: false` and let App.tsx render the normal UI.
 */
export function OrganizationOnboardingScreen() {
  const { t } = useTranslation('nav');
  const suggestedOrganizationName = useStore((s) => s.suggestedOrganizationName);
  const userEmail = useStore((s) => s.userEmail);
  const setUser = useStore((s) => s.setUser);
  const setOnboardingState = useStore((s) => s.setOnboardingState);

  const [input, setInput] = useState(suggestedOrganizationName ?? '');
  const [suggestions, setSuggestions] = useState<OrganizationSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced autocomplete search — fires when the user types.
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    const trimmed = input.trim();
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const results = await searchOrganizations(trimmed, 10);
        setSuggestions(results);
      } catch (err) {
        console.warn('[Onboarding] org search failed', err);
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [input]);

  // Heuristic — does the trimmed input exactly match a known org? Used
  // for the "Will join" / "Will create" hint.
  const exactMatch = useMemo(() => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return undefined;
    return suggestions.find(
      (s) => s.id.toLowerCase() === trimmed || s.name.toLowerCase() === trimmed,
    );
  }, [input, suggestions]);

  async function commit(organizationName?: string) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitOnboardingOrganization(organizationName);
      // Re-fetch /auth/me so the store flips back to needsOnboarding=false
      // and userEmail is set from the freshly minted JWT.
      const result = await fetchAuthMeDetailed();
      if (result.kind === 'user') {
        setUser(result.user.email, result.user.organization);
        setOnboardingState(result.needsOnboarding, result.suggestedOrganizationName);
      } else {
        // Fallback — clear the local onboarding flag; the next request
        // will re-verify.
        setOnboardingState(false, null);
      }
    } catch (err: any) {
      console.error('[Onboarding] submit failed', err);
      setError(err?.message ?? t('onboarding.errorGeneric'));
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    commit(input);
  }

  function handleSkip() {
    commit(undefined);
  }

  function handlePickSuggestion(s: OrganizationSummary) {
    setInput(s.id);
    // Commit immediately on click so the user doesn't have to press
    // Enter again — onboarding should feel one-click.
    commit(s.id);
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[color:var(--bg-canvas)] px-4">
      <div
        className="w-full max-w-md bg-[color:var(--bg-surface)] shadow-lg p-8"
        style={{ border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <Building2 className="w-8 h-8 text-indigo-600" />
          <h1 className="text-xl font-semibold text-[color:var(--text-1)]">
            {t('onboarding.title')}
          </h1>
        </div>

        <p className="text-sm text-[color:var(--text-3)] mb-6">
          {t('onboarding.description', { email: userEmail ?? '' })}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="organization-name"
              className="block text-sm font-medium text-[color:var(--text-2)] mb-1"
            >
              {t('onboarding.organizationLabel')}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="organization-name"
                type="text"
                autoComplete="off"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('onboarding.organizationPlaceholder')}
                disabled={submitting}
                className="w-full px-3 py-2
                           bg-[color:var(--bg-surface)] text-[color:var(--text-1)]
                           placeholder-gray-400
                           focus:outline-none focus:ring-2 focus:ring-indigo-500
                           disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)' }}
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Spinner size="sm" tone="muted" />
                </div>
              )}
            </div>

            {/* Autocomplete dropdown */}
            {suggestions.length > 0 && !submitting && (
              <ul className="mt-2 border border-[color:var(--border-1)] rounded-md
                             bg-[color:var(--bg-surface)] max-h-48 overflow-y-auto">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handlePickSuggestion(s)}
                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2
                                 text-[color:var(--text-2)]
                                 hover:bg-[color:var(--bg-hover)]
                                 transition-colors"
                    >
                      <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-[color:var(--text-3)]">({s.id})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Hint: join existing vs create new */}
            {input.trim() && !searching && (
              <p className="mt-2 text-xs text-[color:var(--text-3)]">
                {exactMatch
                  ? t('onboarding.willJoin', { name: exactMatch.name })
                  : t('onboarding.willCreate', { name: input.trim() })}
              </p>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2
                         bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium
                         rounded-md transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Spinner size="sm" tone="inverse" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {t('onboarding.continue')}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-[color:var(--text-2)]
                         bg-[color:var(--bg-surface-2)] hover:bg-[color:var(--bg-active)]
                         rounded-md transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('onboarding.skip')}
            </button>
          </div>
        </form>

        <p className="mt-6 text-xs text-[color:var(--text-3)]">
          {t('onboarding.footerHint')}
        </p>
      </div>
    </div>
  );
}

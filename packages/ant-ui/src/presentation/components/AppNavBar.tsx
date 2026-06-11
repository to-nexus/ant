import { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Bot, Code2, User, LogOut, Globe, Check, Plus } from 'lucide-react';
import { CreditIcon } from '@/presentation/components/billing/CreditIcon';
import { DesktopStatusIndicator } from './DesktopStatusIndicator';
import { AmbientActivityBar } from './common/async';
import { LocalUserBadge } from './auth/LocalUserBadge';
import { CreateTeamModal } from './auth/CreateTeamModal';
import { useStore } from '@/domain/store';
import { OAUTH_BASE, API_BASE, switchOrg } from '@/infrastructure/http/api';
import { selectServerMode, selectOrgDisplayLabel } from '@/domain/store/selectors/auth';
import { selectEffectiveCredits, selectLiveJobCreditsConsumed } from '@/domain/store/selectors/billing';
import { formatCredits, formatUsd } from '@/shared/utils/tokenUtils';
import { microCreditsToCredits } from '@ant/shared';
import { runUnifiedLogout } from '@ant/auth-client';
import { getAuthBroadcaster } from '@/infrastructure/auth/authBridge';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@/i18n';

export interface AppNavBarProps {
  // No props needed - uses hooks directly
}

/**
 * AppNavBar - Top-level navigation bar for the authenticated App (/app/*)
 *
 * Server mode (local / cloud) is BE-driven (`ANT_SERVER_MODE` at startup,
 * surfaced via `GET /system/config`). The user surface already conveys
 * mode — `LocalUserBadge` in local, Sign In or user dropdown in cloud —
 * so no separate mode badge is rendered.
 */
export function AppNavBar({}: AppNavBarProps) {
  const { t } = useTranslation('nav');
  const theme = useStore((state) => state.theme);
  const toggleTheme = useStore((state) => state.toggleTheme);
  const language = useStore((state) => state.language);
  const setLanguage = useStore((state) => state.setLanguage);
  const mainView = useStore((state) => state.mainView);
  const setMainView = useStore((state) => state.setMainView);
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const userEmail = useStore((state) => state.userEmail);
  const userOrganization = useStore((state) => state.userOrganization);
  const orgDisplayLabel = useStore((state) => selectOrgDisplayLabel(state));
  const memberships = useStore((state) => state.memberships);
  const billingEnabled = useStore((state) => state.billingEnabled);
  const billingBalance = useStore((state) => state.billingBalance);
  const billingUsage = useStore((state) => state.billingUsage);
  const refreshBalance = useStore((state) => state.refreshBalance);
  const refreshUsage = useStore((state) => state.refreshUsage);
  const effectiveCredits = useStore(selectEffectiveCredits);
  const liveJobCredits = useStore(selectLiveJobCreditsConsumed);
  const userPicture = useStore((state) => state.userPicture);
  const clearUser = useStore((state) => state.clearUser);
  const serverMode = useStore((state) => selectServerMode(state));
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);
  const setOnboardingSkipped = useStore((state) => state.setOnboardingSkipped);
  const setQuickStartProjectId = useStore((state) => state.setQuickStartProjectId);

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showCreditMenu, setShowCreditMenu] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [editorTooltip, setEditorTooltip] = useState<string | null>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const creditMenuRef = useRef<HTMLDivElement>(null);

  // Refresh credit balance whenever the identity/mode resolves. Billing is
  // always-on at this stage; the flag stays as the future-extraction seam.
  useEffect(() => {
    if (billingEnabled) void refreshBalance();
  }, [userEmail, serverMode, billingEnabled, refreshBalance]);

  // Close credit menu on outside click + refresh usage when opened.
  useEffect(() => {
    if (!showCreditMenu) return;
    void refreshUsage();
    const handleClick = (e: MouseEvent) => {
      if (creditMenuRef.current && !creditMenuRef.current.contains(e.target as Node)) {
        setShowCreditMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCreditMenu, refreshUsage]);

  // Close language menu on outside click
  useEffect(() => {
    if (!showLangMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showLangMenu]);

  // Check if user is signed in
  const isSignedIn = !!userEmail && !!userOrganization;

  // Handle Sign In / Sign Up — always redirect to Google OIDC with returnTo=/app/
  const handleSignInClick = () => {
    window.location.href = `${OAUTH_BASE()}/api/auth/google?returnTo=${encodeURIComponent('/app/')}`;
  };

  const handleSignUpClick = () => {
    window.location.href = `${OAUTH_BASE()}/api/auth/google?returnTo=${encodeURIComponent('/app/')}`;
  };

  // Handle sign out — runs the unified 5-step logout procedure (signoutAPI
  // → clearUser cascade → broadcast → hard nav). `clearUser` cascades
  // reset + projects clear + storage cleanup as a single SSOT
  // (see authSlice.clearUser jsdoc). Hard-nav target: `VITE_ANT_SITE_URL`
  // when configured, else `/` (logged-out welcome screen).
  const handleSignOut = async () => {
    setShowUserMenu(false);
    const siteUrl = (import.meta.env.VITE_ANT_SITE_URL as string | undefined) ?? '/';
    await runUnifiedLogout({
      apiBase: API_BASE(),
      destination: siteUrl,
      broadcaster: getAuthBroadcaster(),
      clearLocalState: () => clearUser(),
      showSignoutFailureToast: () => {
        console.warn(
          '[Auth] Signed out locally; the server session may persist until the cookie expires.',
        );
      },
    });
  };

  // Switch active org. The active org changes the workspace root, so a full
  // reload re-runs the mount auth flow + fetches the new org's projects
  // cleanly. Only reachable with >1 membership (team join — deferred today).
  const handleSwitchOrg = async (organizationId: string) => {
    if (organizationId === userOrganization) {
      setShowUserMenu(false);
      return;
    }
    try {
      await switchOrg(organizationId);
      window.location.reload();
    } catch (err) {
      console.warn('[Auth] switch-org failed:', err);
      setShowUserMenu(false);
    }
  };

  // Handle Editor mode switch
  const handleCodeIdeViewSwitch = async () => {
    // ✅ Check if project is selected
    if (!selectedProject) {
                      setEditorTooltip(t('viewMode.selectProjectFirst'));
      setTimeout(() => setEditorTooltip(null), 3000);
      return;
    }

    // Single SSOT: startIdeSession handles connecting state, BE start,
    // pre-flight probe, base-url publish, and error surfacing.
    await useStore.getState().startIdeSession(selectedProject, selectedFeature || undefined);

    const { selectIdeConnectError } = await import('@/domain/store/selectors/ideSelectors');
    const err = selectIdeConnectError(useStore.getState());
    if (err) {
      console.error('[GlobalNavBar] Failed to open IDE:', err);
      setEditorTooltip(t('viewMode.failedToOpenIde'));
      setTimeout(() => setEditorTooltip(null), 3000);
    }
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        height: 56,
        background: 'oklch(from var(--bg-app) l c h / 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="px-2 sm:px-4 h-full flex items-center">
        <div className="flex items-center justify-between gap-2 w-full">
          <div className="flex items-center space-x-1.5 sm:space-x-3 min-w-0">
            <a href="/" className="flex items-center space-x-1.5 sm:space-x-2 hover:opacity-80 transition-opacity">
              <img
                src={`${import.meta.env.BASE_URL}logo.png`}
                alt={t('brand.logoAlt')}
                className="w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0"
              />
              <h1
                className="hidden md:block text-xl font-display font-bold tracking-tight whitespace-nowrap gradient-flow"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  background: 'var(--gradient-aurora)',
                  backgroundSize: '200% 200%',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                ANT
              </h1>
            </a>

            {/* No separate mode badge — the user surface already conveys
                mode: local shows LocalUserBadge ("Local User"), cloud
                shows Sign In or the signed-in user dropdown. */}

            {/* View Mode Selector */}
            <div
              className="view-mode-selector flex items-center gap-1 ml-2 sm:ml-4 p-1 relative"
              style={{
                background: 'var(--bg-surface-2)',
                borderRadius: 'var(--r-md)',
              }}
            >
              {/* Agents Button */}
              <button
                onClick={() => setMainView('agents')}
                className="px-1.5 sm:px-3 py-1 text-xs font-medium flex items-center gap-1.5"
                style={
                  mainView === 'agents'
                    ? {
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--violet-200)',
                        color: 'var(--violet-700)',
                        boxShadow: 'var(--shadow-xs)',
                        borderRadius: 'var(--r-sm)',
                      }
                    : {
                        background: 'transparent',
                        border: '1px solid transparent',
                        color: 'var(--text-3)',
                        borderRadius: 'var(--r-sm)',
                      }
                }
              >
                <Bot className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('viewMode.agents')}</span>
              </button>

              {/* Editor Button */}
              <button
                onClick={handleCodeIdeViewSwitch}
                className="px-1.5 sm:px-3 py-1 text-xs font-medium flex items-center gap-1.5"
                style={
                  mainView === 'codeIde'
                    ? {
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--violet-200)',
                        color: 'var(--violet-700)',
                        boxShadow: 'var(--shadow-xs)',
                        borderRadius: 'var(--r-sm)',
                      }
                    : {
                        background: 'transparent',
                        border: '1px solid transparent',
                        color: 'var(--text-3)',
                        borderRadius: 'var(--r-sm)',
                      }
                }
                title={selectedProject ? t('viewMode.openEditor') : t('viewMode.selectProjectFirst')}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('viewMode.code')}</span>
              </button>

              {/* Tooltip for Editor button */}
              {editorTooltip && (
                <div
                  className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 text-xs px-3 py-2 whitespace-nowrap z-50"
                  style={{
                    background: 'var(--bg-inverted)',
                    color: 'var(--text-inverted)',
                    boxShadow: 'var(--shadow-md)',
                    borderRadius: 'var(--r-sm)',
                  }}
                >
                  {editorTooltip}
                  <div
                    className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 rotate-45"
                    style={{ background: 'var(--bg-inverted)' }}
                  ></div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1.5 sm:space-x-3">
            {/* Language Selector */}
            <div className="relative" ref={langMenuRef}>
              <button
                onClick={() => setShowLangMenu(!showLangMenu)}
                className="inline-flex items-center gap-1.5 px-1.5 sm:px-2.5 py-1.5 text-xs font-medium"
                style={{
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-2)',
                  color: 'var(--text-2)',
                  borderRadius: 'var(--r-sm)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-surface-2)';
                }}
                title={t('language.label')}
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{LANGUAGE_LABELS[language]}</span>
              </button>
              {showLangMenu && (
                <div
                  className="absolute top-full right-0 mt-1 w-32 py-1 z-50"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-2)',
                    borderRadius: 'var(--r-md)',
                    boxShadow: 'var(--shadow-md)',
                  }}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const selected = language === lang;
                    return (
                      <button
                        key={lang}
                        onClick={() => {
                          setLanguage(lang);
                          setShowLangMenu(false);
                        }}
                        className="w-full px-3 py-1.5 text-left text-sm flex items-center justify-between"
                        style={{
                          background: selected ? 'var(--bg-active)' : 'transparent',
                          color: selected ? 'var(--violet-700)' : 'var(--text-2)',
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) {
                            e.currentTarget.style.background = 'var(--bg-hover)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) {
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        {LANGUAGE_LABELS[lang]}
                        {selected && (
                          <span style={{ color: 'var(--violet-500)' }}>✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Theme Toggle — icon button on small, sliding toggle on sm+ */}
            <button
              onClick={toggleTheme}
              className="sm:hidden inline-flex items-center justify-center w-8 h-8 rounded-full focus:outline-none flex-shrink-0"
              style={{
                background: 'var(--bg-surface-2)',
                color: 'var(--text-2)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-surface-2)';
              }}
              aria-label={t('theme.toggle')}
              title={t('theme.switchTo', { mode: theme === 'light' ? 'dark' : 'light' })}
            >
              {theme === 'light' ? (
                <Sun className="w-4 h-4" style={{ color: 'var(--orange-500)' }} />
              ) : (
                <Moon className="w-4 h-4" style={{ color: 'var(--violet-400)' }} />
              )}
            </button>
            <button
              onClick={toggleTheme}
              className="hidden sm:inline-flex relative items-center focus:outline-none flex-shrink-0"
              style={{
                width: 56,
                height: 30,
                borderRadius: 999,
                background: 'var(--bg-surface-3)',
                border: '1px solid var(--border-2)',
                padding: 0,
              }}
              aria-label={t('theme.toggle')}
              title={t('theme.switchTo', { mode: theme === 'light' ? 'dark' : 'light' })}
            >
              <span
                className="inline-flex items-center justify-center"
                style={{
                  position: 'absolute',
                  top: 2,
                  left: theme === 'dark' ? 28 : 2,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--bg-surface)',
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'left var(--dur-base) var(--ease-spring)',
                }}
              >
                {theme === 'light' ? (
                  <Sun className="w-3.5 h-3.5" style={{ color: 'var(--orange-500)' }} />
                ) : (
                  <Moon className="w-3.5 h-3.5" style={{ color: 'var(--violet-400)' }} />
                )}
              </span>
            </button>

            <div className="w-px h-6" style={{ background: 'var(--border-1)' }}></div>

            <DesktopStatusIndicator />

            {/* User Section. Local launch has no remote identity — the
                LocalUserBadge surfaces Account Configuration only. */}
            {serverMode === 'local' && (
              <>
                <div className="w-px h-6" style={{ background: 'var(--border-1)' }}></div>
                <LocalUserBadge />
              </>
            )}

            {serverMode === 'cloud' && (
              <>
                <div className="w-px h-6" style={{ background: 'var(--border-1)' }}></div>

                {!isSignedIn ? (
                  // Not signed in - Show Sign Up / Sign In buttons
                  <div className="flex items-center gap-1 sm:gap-2">
                    <button
                      onClick={handleSignUpClick}
                      className="hidden sm:block px-3 py-1.5 text-sm font-medium"
                      style={{
                        color: 'var(--text-2)',
                        background: 'transparent',
                        borderRadius: 'var(--r-md)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {t('auth.signUp')}
                    </button>
                    <button
                      onClick={handleSignInClick}
                      className="gradient-flow px-2.5 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold"
                      style={{
                        color: 'var(--text-on-brand)',
                        background: 'var(--gradient-aurora)',
                        backgroundSize: '200% 200%',
                        boxShadow: 'var(--shadow-glow-aurora)',
                        borderRadius: 'var(--r-md)',
                        border: 'none',
                        transition: 'transform var(--dur-fast) var(--ease-smooth)',
                      }}
                    >
                      {t('auth.signIn')}
                    </button>
                  </div>
                ) : (
                  // Signed in - Show user info with dropdown
                  <>
                  {billingEnabled && billingBalance.data && effectiveCredits !== undefined && (
                    <div className="relative hidden sm:block mr-1" ref={creditMenuRef}>
                      <button
                        onClick={() => setShowCreditMenu((v) => !v)}
                        className="inline-flex items-center text-xs font-mono font-medium px-2 py-1"
                        title={t('billing.creditBalance', 'Credit balance')}
                        style={{
                          background: 'var(--bg-surface-2)',
                          borderRadius: 'var(--r-md)',
                          color: liveJobCredits > 0 ? 'var(--violet-500)' : 'var(--text-2)',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface-2)'; }}
                      >
                        <CreditIcon size={13} className="mr-1" />
                        {formatCredits(effectiveCredits)}
                      </button>

                      {showCreditMenu && (
                        <div
                          className="absolute top-full right-0 mt-2 w-72 py-2 z-50"
                          style={{
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-2)',
                            borderRadius: 'var(--r-md)',
                            boxShadow: 'var(--shadow-md)',
                          }}
                        >
                          <div className="px-4 pb-2">
                            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-4)' }}>
                              {t('billing.creditBalance', 'Credit balance')}
                            </div>
                            <div className="flex items-center gap-1.5 text-xl font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
                              <CreditIcon size={18} gradient />
                              {formatCredits(effectiveCredits)}
                              <span className="text-xs font-sans font-medium tracking-wide" style={{ color: 'var(--text-3)' }}>CREDIT</span>
                            </div>
                            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                              {billingBalance.data.tier} · {t('billing.includedMonthly', '{{n}}/mo', { n: formatCredits(billingBalance.data.includedCreditsMonthly) })}
                              {liveJobCredits > 0 && (
                                <> · <span style={{ color: 'var(--violet-500)' }}>{t('billing.thisJob', 'this job')} −{formatCredits(liveJobCredits)}</span></>
                              )}
                            </div>
                          </div>
                          <div className="my-1" style={{ height: 1, background: 'var(--border-1)' }} />
                          <div className="px-4 py-1 max-h-48 overflow-y-auto">
                            <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-4)' }}>
                              {t('billing.recentUsage', 'Recent usage')}
                            </div>
                            {(billingUsage.data ?? []).length === 0 ? (
                              <div className="text-[11px] italic" style={{ color: 'var(--text-3)' }}>
                                {t('billing.noUsage', 'No usage yet')}
                              </div>
                            ) : (
                              (billingUsage.data ?? []).slice(0, 6).map((tx) => (
                                <div key={tx.id} className="flex items-center justify-between text-[11px] tabular-nums py-0.5" style={{ color: 'var(--text-2)' }}>
                                  <span className="truncate mr-2" style={{ color: 'var(--text-3)' }}>
                                    {tx.kind}{tx.featureName ? ` · ${tx.featureName}` : ''}
                                  </span>
                                  <span className="flex items-center gap-2 whitespace-nowrap">
                                    <span style={{ color: tx.microCredits < 0 ? 'var(--text-2)' : 'var(--status-done-fg)' }}>
                                      {tx.microCredits < 0 ? '−' : '+'}{formatCredits(Math.abs(microCreditsToCredits(tx.microCredits)))}
                                    </span>
                                    {tx.usdCost !== undefined && (
                                      <span style={{ color: 'var(--text-3)' }}>{formatUsd(tx.usdCost)}</span>
                                    )}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                          <div className="my-1" style={{ height: 1, background: 'var(--border-1)' }} />
                          <button
                            onClick={() => {
                              setShowCreditMenu(false);
                              openMainPanelTab('billing');
                            }}
                            className="w-full px-4 py-1.5 text-left text-xs"
                            style={{ color: 'var(--text-2)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            {t('billing.openCenter', 'Open billing & credits →')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => setShowUserMenu(!showUserMenu)}
                      className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5"
                      style={{
                        background: 'var(--bg-surface-2)',
                        borderRadius: 'var(--r-md)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--bg-surface-2)';
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="hidden md:inline text-xs font-medium"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {orgDisplayLabel}
                        </span>
                        {userPicture ? (
                          <img
                            src={userPicture}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="w-5 h-5 rounded-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <User className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                        )}
                        <span
                          className="hidden sm:inline text-xs font-semibold"
                          style={{ color: 'var(--text-1)' }}
                        >
                          {userEmail?.split('@')[0]}
                        </span>
                      </div>
                    </button>

                    {/* User Menu Dropdown */}
                    {showUserMenu && (
                      <div
                        className="absolute top-full right-0 mt-2 w-56 py-1 z-50"
                        style={{
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-2)',
                          borderRadius: 'var(--r-md)',
                          boxShadow: 'var(--shadow-md)',
                        }}
                      >
                        {/* Account switcher — GitHub/Vercel/Slack pattern: the
                            membership list (your individual account + any teams)
                            followed by a "Create team" entry. Team join/admin is
                            deferred; "Create team" opens a placeholder modal. */}
                        <div className="px-4 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-4)' }}>
                          {t('auth.switchAccount', 'Switch account')}
                        </div>
                        {memberships.map((m) => (
                          <button
                            key={m.organizationId}
                            onClick={() => handleSwitchOrg(m.organizationId)}
                            className="w-full px-4 py-2 text-left text-sm flex items-center gap-2"
                            style={{ color: 'var(--text-2)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <User className="w-4 h-4" />
                            <span className="truncate">{m.kind === 'individual' ? 'Individual' : m.name}</span>
                            {m.organizationId === userOrganization && (
                              <Check className="w-3.5 h-3.5 ml-auto" style={{ color: 'var(--violet-500)' }} />
                            )}
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            setShowCreateTeam(true);
                            setShowUserMenu(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm flex items-center gap-2"
                          style={{ color: 'var(--text-2)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <Plus className="w-4 h-4" />
                          {t('auth.createTeam', 'Create team')}
                        </button>
                        <div className="my-1" style={{ height: 1, background: 'var(--border-1)' }}></div>
                        <button
                          onClick={() => {
                            setQuickStartProjectId(undefined);
                            setOnboardingSkipped(true);
                            openMainPanelTab('accountConfig');
                            setShowUserMenu(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm flex items-center gap-2"
                          style={{
                            color: 'var(--text-2)',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--bg-hover)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <User className="w-4 h-4" />
                          {t('auth.accountConfig')}
                        </button>
                        <div
                          className="my-1"
                          style={{ height: 1, background: 'var(--border-1)' }}
                        ></div>
                        <button
                          onClick={handleSignOut}
                          className="w-full px-4 py-2 text-left text-sm flex items-center gap-2"
                          style={{
                            color: 'var(--text-2)',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--bg-hover)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <LogOut className="w-4 h-4" />
                          {t('auth.signOut')}
                        </button>
                      </div>
                    )}
                  </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {/* Async UI Policy — ambient progress bar sits flush with the navbar's
          bottom edge. Does not affect navbar height or body layout. */}
      <AmbientActivityBar />
      <CreateTeamModal isOpen={showCreateTeam} onClose={() => setShowCreateTeam(false)} />
    </header>
  );
}

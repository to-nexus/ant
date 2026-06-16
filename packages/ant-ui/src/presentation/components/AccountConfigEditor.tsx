
import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, Globe, Lock } from 'lucide-react';
import { useGitPat, useGitPatDispatch } from '@/domain/git-world';
import {
  fetchOrgConfig,
  fetchUserConfig,
  updateUserConfig,
  resetUserAccount,
} from '@/infrastructure/http/api';
import { selectUserOrgKind } from '@/domain/store/selectors/auth';
import { BoardViewModeToggle } from './aurora/BoardViewModeToggle';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useStore } from '@/domain/store';
import { STORAGE_KEYS, removeFromStorage } from '@/domain/store/storage';
import { Spinner } from './common/async';
import { DangerZoneSection } from './common/DangerZoneSection';
import { Slot } from '@/presentation/extensions/slots';
import { DesktopConnectModal } from './DesktopConnectModal';
import { useDesktopBridge } from '@/application/hooks/ui/useDesktopBridge';
import {
  DESKTOP_DOWNLOAD_URL,
  FIGMA_DOWNLOAD_URL,
  FIGMA_DEEPLINK_URL,
} from '@/presentation/constants/desktop';
import {
  TwoColLayout,
  TocNav,
  useActiveSection,
  SectionCard,
  StatusPill,
  SignalRing,
  IdentityOrb,
  AuroraInput,
  FieldLabel,
} from './ConfigEditor/aurora';
import type { StatusPillState } from './ConfigEditor/aurora';

interface AccountConfigEditorProps {
  onClose: () => void;
}

const SECTION_IDS = [
  'c3a-identity',
  'c3a-account',
  'c3a-owners',
  'c3a-figma',
  'c3a-billing',
  'c3a-danger',
] as const;

export function AccountConfigEditor({
  onClose: _onClose,
}: AccountConfigEditorProps) {
  const { t } = useTranslation('config');
  const { showSuccess, showError, showConfirm } = useAlertModalContext();

  const reset = useStore((state) => state.reset);

  // GitHub PAT — SSOT is the git-world slice. Only the input buffer and
  // the in-flight save/delete guard live locally.
  const patState = useGitPat();
  const { fetchGitPat, savePat, deletePat } = useGitPatDispatch();
  const [githubPAT, setGithubPAT] = useState('');
  const [isSavingPAT, setIsSavingPAT] = useState(false);
  const githubPATConfigured = patState?.configured ?? false;
  const githubUsername = patState?.username;
  const isCheckingPAT = patState === null;

  // GitHub Owner state
  const [orgGithubOwner, setOrgGithubOwner] = useState('');
  const [userOwnerOverride, setUserOwnerOverride] = useState('');
  const [savedUserOverride, setSavedUserOverride] = useState('');
  const [isLoadingOwnerConfig, setIsLoadingOwnerConfig] = useState(true);
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  // Account visibility (individual orgs). Default public.
  const userOrgKind = useStore((s) => selectUserOrgKind(s));
  const isIndividual = userOrgKind === 'individual';
  // Billing surface flag — always-on at this stage; the flag stays as the
  // future-extraction seam (OSS build without @ant/cloud would hide it).
  const billingEnabled = useStore((s) => s.billingEnabled);
  const [accountVisibility, setAccountVisibility] = useState<'public' | 'private'>('public');
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);

  // Bridge state from global store (single source of truth)
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const bridgeDetected = useStore((s) => s.bridgeDetected);
  const figmaDesktopReachable = useStore((s) => s.figmaDesktopReachable);
  const accountConfigScrollTarget = useStore(
    (s) => s.accountConfigScrollTarget,
  );
  const setAccountConfigScrollTarget = useStore(
    (s) => s.setAccountConfigScrollTarget,
  );

  const {
    launchPhase,
    isRefreshing: isCheckingBridge,
    launchDesktop,
    retryLaunch,
    cancelLaunch,
    refreshStatus: loadBridgeStatus,
  } = useDesktopBridge({ enablePolling: false });

  // Account reset state
  const [isResettingAccount, setIsResettingAccount] = useState(false);
  const [resetPhase, setResetPhase] = useState<
    'idle' | 'deleting' | 'clearing' | 'done'
  >('idle');

  // Scroll wiring
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useActiveSection(
    SECTION_IDS as unknown as string[],
    scrollerRef,
  );

  // Prime the PAT slice on mount.
  useEffect(() => {
    void fetchGitPat();
  }, [fetchGitPat]);

  // Load org config (read-only) + user config (editable override) on mount
  useEffect(() => {
    async function loadOwnerConfigs() {
      setIsLoadingOwnerConfig(true);
      try {
        const [orgConfig, userConfig] = await Promise.all([
          fetchOrgConfig(),
          fetchUserConfig(),
        ]);
        setOrgGithubOwner(orgConfig.github?.owner || '');
        const override = userConfig.github?.ownerOverride || '';
        setUserOwnerOverride(override);
        setSavedUserOverride(override);
        setAccountVisibility(userConfig.account?.visibility ?? 'public');
      } catch (error) {
        console.error('Failed to load owner configs:', error);
      } finally {
        setIsLoadingOwnerConfig(false);
      }
    }
    loadOwnerConfigs();
  }, []);

  // Scroll to Figma section when requested (e.g. from GNB indicator)
  useEffect(() => {
    if (accountConfigScrollTarget === 'figma') {
      const el = document.getElementById('c3a-figma');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setAccountConfigScrollTarget(null);
      }
    }
  }, [accountConfigScrollTarget, setAccountConfigScrollTarget]);

  // ============================================
  // Handlers (preserved verbatim from pre-Aurora)
  // ============================================

  const handleSaveGitHubPAT = async () => {
    if (!githubPAT.trim()) {
      showError(t('github.enterPat'));
      return;
    }

    setIsSavingPAT(true);
    try {
      const result = await savePat(githubPAT.trim());
      if (!result.success) {
        showError(result.error || t('github.saveFailed'));
        return;
      }
      setGithubPAT('');
      showSuccess(
        result.pat?.username
          ? t('account.patSavedWithUser', { username: result.pat.username })
          : t('account.patSaved'),
      );
      const { selectedProject, selectedFeature, fetchGitWorldState } =
        useStore.getState() as any;
      if (selectedProject) {
        void fetchGitWorldState(selectedProject, {
          feature: selectedFeature || undefined,
          fresh: true,
        });
      }
    } catch (error: any) {
      console.error('Failed to save GitHub PAT:', error);
      showError(error.message || t('github.saveFailed'));
    } finally {
      setIsSavingPAT(false);
    }
  };

  const handleChangeVisibility = async (next: 'public' | 'private') => {
    if (next === accountVisibility || isSavingVisibility) return;
    const prev = accountVisibility;
    setAccountVisibility(next); // optimistic
    setIsSavingVisibility(true);
    try {
      await updateUserConfig({ account: { visibility: next } });
    } catch (error: any) {
      setAccountVisibility(prev); // revert on failure
      showError(error.message || t('account.visibilitySaveFailed', 'Failed to update visibility'));
    } finally {
      setIsSavingVisibility(false);
    }
  };

  const handleSaveOwnerOverride = async () => {
    const trimmed = userOwnerOverride.trim();
    setIsSavingOverride(true);
    try {
      await updateUserConfig({
        github: { ownerOverride: trimmed || null },
      });
      setSavedUserOverride(trimmed);
      if (trimmed) {
        showSuccess(t('account.ownerOverrideSet', { owner: trimmed }));
      } else {
        showSuccess(
          t('account.ownerOverrideCleared', {
            suffix: orgGithubOwner ? ` (${orgGithubOwner})` : '',
          }),
        );
      }
    } catch (error: any) {
      console.error('Failed to save owner override:', error);
      showError(error.message || t('github.ownerSaveFailed'));
    } finally {
      setIsSavingOverride(false);
    }
  };

  const handleDeleteGitHubPAT = async () => {
    showConfirm(t('github.deleteConfirmMsg'), {
      type: 'warning',
      title: t('github.deleteConfirm'),
      confirmText: t('common:button.delete'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        setIsSavingPAT(true);
        try {
          const result = await deletePat();
          if (!result.success) {
            showError(result.error || t('github.deleteFailed'));
            return;
          }
          setGithubPAT('');
          showSuccess(t('github.deleteSuccess'));
          const { selectedProject, selectedFeature, fetchGitWorldState } =
            useStore.getState() as any;
          if (selectedProject) {
            void fetchGitWorldState(selectedProject, {
              feature: selectedFeature || undefined,
              fresh: true,
            });
          }
        } catch (error: any) {
          console.error('Failed to delete GitHub PAT:', error);
          showError(error.message || t('github.deleteFailed'));
        } finally {
          setIsSavingPAT(false);
        }
      },
    });
  };

  const handleConnectDesktop = async () => {
    await launchDesktop();
  };

  const handleResetAccount = async () => {
    showConfirm(t('account.resetAccountConfirmMsg'), {
      type: 'error',
      title: t('account.resetAccountConfirm'),
      confirmText: t('common:button.confirm'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        setIsResettingAccount(true);
        setResetPhase('deleting');
        try {
          console.log('[AccountConfigEditor] Resetting account...');
          const result = await resetUserAccount();

          if (!result.success) {
            setResetPhase('idle');
            showError(result.error || t('account.resetAccountFailed'));
            return;
          }

          console.log('[AccountConfigEditor] Account reset successful');

          setResetPhase('clearing');

          removeFromStorage(STORAGE_KEYS.SELECTED_PROJECT);
          removeFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES);

          reset();

          await new Promise((r) => setTimeout(r, 600));

          setResetPhase('done');

          document.body.style.transition = 'opacity 0.5s ease';
          document.body.style.opacity = '0';

          setTimeout(() => {
            window.location.reload();
          }, 500);
        } catch (error: any) {
          console.error(
            '[AccountConfigEditor] Failed to reset account:',
            error,
          );
          setResetPhase('idle');
          showError(error.message || t('account.resetAccountFailed'));
          setIsResettingAccount(false);
        }
      },
    });
  };

  // ============================================
  // Derived
  // ============================================

  const isOverrideChanged =
    userOwnerOverride.trim() !== savedUserOverride;

  const resetSteps = [
    { key: 'deleting' as const, label: t('account.resetStepDeleting') },
    { key: 'clearing' as const, label: t('account.resetStepClearing') },
    { key: 'done' as const, label: t('account.resetStepDone') },
  ];

  const tocNode = (
    <TocNav
      items={[
        { id: 'c3a-identity', label: t('account.tocIdentity'), icon: 'Lock' },
        ...(isIndividual
          ? [{ id: 'c3a-account', label: t('account.tocVisibility', 'Visibility'), icon: 'Globe' as const }]
          : []),
        { id: 'c3a-owners', label: t('account.tocOwners'), icon: 'Users' },
        { id: 'c3a-figma', label: t('account.tocFigma'), icon: 'Palette' },
        ...(billingEnabled
          ? [{ id: 'c3a-billing', label: t('account.tocBilling', 'Billing'), icon: 'CreditCard' as const }]
          : []),
        {
          id: 'c3a-danger',
          label: t('account.tocDanger'),
          icon: 'AlertTriangle',
        },
      ]}
      active={activeSection}
      onSelect={(id) => {
        setActiveSection(id);
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    />
  );

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-canvas)',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Fullscreen reset overlay */}
      {isResettingAccount && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'oklch(0% 0 0 / 0.6)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            animation: 'pulse-soft 0.6s ease-in-out',
          }}
        >
          <div
            style={{
              background: 'oklch(from var(--bg-surface) l c h / 0.95)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--r-xl)',
              boxShadow:
                '0 24px 60px -16px oklch(20% 0.05 295 / 0.4)',
              padding: 32,
              margin: '0 16px',
              maxWidth: 360,
              width: '100%',
              textAlign: 'center',
            }}
          >
            {resetPhase !== 'done' && (
              <div
                style={{
                  margin: '0 auto 20px',
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--status-error-fg)',
                }}
              >
                <Spinner size="lg" tone="inherit" />
              </div>
            )}
            {resetPhase === 'done' && (
              <div
                style={{
                  margin: '0 auto 20px',
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'oklch(94% 0.06 155 / 0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'oklch(45% 0.16 155)',
                }}
              >
                <Check size={24} strokeWidth={2.5} />
              </div>
            )}

            <h4
              style={{
                margin: '0 0 16px',
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text-1)',
              }}
            >
              {t('account.resetting')}
            </h4>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                textAlign: 'left',
              }}
            >
              {resetSteps.map((step) => {
                const stepOrder = resetSteps.findIndex(
                  (s) => s.key === step.key,
                );
                const currentOrder = resetSteps.findIndex(
                  (s) => s.key === resetPhase,
                );
                const isDone = currentOrder > stepOrder;
                const isCurrent = resetPhase === step.key;

                return (
                  <div
                    key={step.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    {isDone ? (
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: 'oklch(94% 0.06 155 / 0.6)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          color: 'oklch(45% 0.16 155)',
                        }}
                      >
                        <Check size={12} strokeWidth={3} />
                      </div>
                    ) : isCurrent ? (
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: '2px solid var(--violet-400)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--violet-500)',
                            animation:
                              'pulse-soft 1.6s ease-in-out infinite',
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: '2px solid var(--border-2)',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 13,
                        color: isCurrent
                          ? 'var(--text-1)'
                          : isDone
                            ? 'var(--text-3)'
                            : 'var(--text-4)',
                        fontWeight: isCurrent ? 700 : 500,
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Scroller */}
      <div
        ref={scrollerRef}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        <TwoColLayout toc={tocNode}>
          {/* ============================
              Section 1 — GitHub Identity
              ============================ */}
          <SectionCard
            id="c3a-identity"
            icon="Lock"
            title={t('github.title')}
            description={t('github.description')}
            accent="aurora"
            status={
              <StatusPill
                state={
                  isCheckingPAT
                    ? 'checking'
                    : githubPATConfigured
                      ? 'configured'
                      : 'not-configured'
                }
                label={
                  githubPATConfigured && githubUsername
                    ? `@${githubUsername}`
                    : undefined
                }
              />
            }
          >
            <C3aGitHubIdentityCard
              configured={githubPATConfigured}
              username={githubUsername}
              pat={githubPAT}
              setPat={setGithubPAT}
              isSaving={isSavingPAT}
              onSave={handleSaveGitHubPAT}
              onDelete={handleDeleteGitHubPAT}
              labelSave={t('github.savePat')}
              labelSaving={t('github.saving')}
              labelGenerate={t('account.generateToken')}
              labelDelete={t('account.deleteButton')}
            />
          </SectionCard>

          {/* ============================
              Section — Account Visibility (individual only)
              ============================ */}
          {isIndividual && (
            <SectionCard
              id="c3a-account"
              icon="Globe"
              title={t('account.visibilityTitle', 'Account Visibility')}
              description={t(
                'account.visibilityDescription',
                'Public accounts can be found by their full email for file transfers. Private accounts are not discoverable.',
              )}
              accent="aurora"
            >
              <BoardViewModeToggle<'public' | 'private'>
                value={accountVisibility}
                onChange={handleChangeVisibility}
                options={[
                  { id: 'public', label: t('account.visibilityPublic', 'Public'), icon: Globe },
                  { id: 'private', label: t('account.visibilityPrivate', 'Private'), icon: Lock },
                ]}
                ariaLabel={t('account.visibilityTitle', 'Account Visibility')}
              />
            </SectionCard>
          )}

          {/* ============================
              Section 2 — Owners
              ============================ */}
          <SectionCard
            id="c3a-owners"
            icon="Users"
            title={t('account.defaultRepoOwner')}
            description={t('account.ownersDescription')}
            accent="violet-pink"
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              {/* Organization (editable override) — team only. Individual
                  accounts have no shared org to set a default owner for; only
                  the personal owner applies. */}
              {!isIndividual && (
              <div>
                <FieldLabel
                  action={
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 'var(--r-pill)',
                          background:
                            'oklch(94% 0.06 290 / 0.55)',
                          color: 'var(--violet-700)',
                          border: '1px solid var(--violet-300)',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {t('account.organizationBadge')}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-4)',
                        }}
                      >
                        {savedUserOverride
                          ? t('account.customOverrideActive')
                          : orgGithubOwner
                            ? t('account.usingOrgDefault')
                            : t('account.notConfigured')}
                      </span>
                    </span>
                  }
                >
                  {t('account.defaultRepoOwner')}
                </FieldLabel>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <AuroraInput
                      value={userOwnerOverride}
                      onChange={(v) =>
                        setUserOwnerOverride(v.replace(/\s/g, ''))
                      }
                      placeholder={
                        orgGithubOwner ||
                        githubUsername ||
                        'owner'
                      }
                      prefix="github.com/"
                      mono
                      disabled={isLoadingOwnerConfig}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveOwnerOverride}
                    disabled={
                      !isOverrideChanged || isSavingOverride
                    }
                    style={{
                      height: 36,
                      padding: '0 16px',
                      background: 'var(--gradient-violet-pink)',
                      color: 'white',
                      fontWeight: 700,
                      fontSize: 12,
                      border: 'none',
                      borderRadius: 'var(--r-md)',
                      cursor:
                        !isOverrideChanged || isSavingOverride
                          ? 'not-allowed'
                          : 'pointer',
                      opacity:
                        !isOverrideChanged || isSavingOverride
                          ? 0.5
                          : 1,
                      flexShrink: 0,
                    }}
                  >
                    {isSavingOverride
                      ? t('github.saving')
                      : t('common:button.save')}
                  </button>
                  {savedUserOverride && (
                    <button
                      type="button"
                      title={t('github.revertToDefault')}
                      disabled={isSavingOverride}
                      onClick={() => {
                        setUserOwnerOverride('');
                        setIsSavingOverride(true);
                        updateUserConfig({
                          github: { ownerOverride: null },
                        })
                          .then(() => {
                            setSavedUserOverride('');
                            showSuccess(
                              t(
                                'account.revertedToOrgDefault',
                                {
                                  suffix: orgGithubOwner
                                    ? ` (${orgGithubOwner})`
                                    : '',
                                },
                              ),
                            );
                          })
                          .catch((err: any) =>
                            showError(
                              err.message ||
                                t('github.clearFailed'),
                            ),
                          )
                          .finally(() =>
                            setIsSavingOverride(false),
                          );
                      }}
                      style={{
                        height: 36,
                        padding: '0 12px',
                        background: 'var(--bg-surface-2)',
                        color: 'var(--text-2)',
                        fontWeight: 600,
                        fontSize: 12,
                        border: '1px solid var(--border-2)',
                        borderRadius: 'var(--r-md)',
                        cursor: isSavingOverride
                          ? 'not-allowed'
                          : 'pointer',
                        opacity: isSavingOverride ? 0.5 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {t('common:button.reset')}
                    </button>
                  )}
                </div>
              </div>
              )}

              {/* Personal Owner (auto-detected from PAT) */}
              <div>
                <FieldLabel
                  action={
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 'var(--r-pill)',
                          background: 'var(--bg-surface-2)',
                          color: 'var(--text-3)',
                          border: '1px solid var(--border-2)',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {t('account.personalBadge')}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-4)',
                        }}
                      >
                        {t('github.autoDetected')}
                      </span>
                    </span>
                  }
                >
                  {t('account.personalBadge')}
                </FieldLabel>
                <AuroraInput
                  value={githubUsername || ''}
                  placeholder={
                    githubPATConfigured
                      ? t('github.reSavePat')
                      : t('github.savePATToDetect')
                  }
                  prefix="github.com/"
                  mono
                  disabled
                />
              </div>
            </div>
          </SectionCard>

          {/* ============================
              Section 3 — Figma Bridge
              ============================ */}
          <FigmaBridgeSection
            bridgeConnected={bridgeConnected}
            bridgeDetected={bridgeDetected}
            figmaDesktopReachable={figmaDesktopReachable}
            isCheckingBridge={isCheckingBridge}
            onRefresh={loadBridgeStatus}
            onConnectDesktop={handleConnectDesktop}
            tTitle={t('figma.title')}
            tDescription={t('figma.description')}
            tReady={t('figma.ready')}
            tSetupNeeded={t('figma.setupNeeded')}
            tAntDesktop={t('figma.antDesktop')}
            tFigmaDesktop={t('figma.figmaDesktop')}
            tStatusConnected={t('figma.statusConnected')}
            tStatusDetected={t('figma.statusDetected')}
            tStatusNotDetected={t('figma.statusNotDetected')}
            tStatusReachable={t('figma.statusReachable')}
            tStatusNotReachable={t('figma.statusNotReachable')}
            tStatusRequiresAntDesktop={t(
              'figma.statusRequiresAntDesktop',
            )}
            tConnectAntDesktop={t('figma.connectAntDesktop')}
            tLaunchAntDesktop={t('figma.launchAntDesktop')}
            tLaunchFigmaDesktop={t('figma.launchFigmaDesktop')}
            tDownloadAntDesktop={t('figma.downloadAntDesktop')}
            tDownloadFigmaDesktop={t('figma.downloadFigmaDesktop')}
            tRefresh={t('figma.refresh')}
          />

          {/* ============================
              Plan & Billing — always-on at this stage. The flag is the future
              @ant/cloud extraction seam (OSS build without it would hide this).
              ============================ */}
          {billingEnabled && <Slot name="accountConfig.billing" />}

          {/* ============================
              Section 4 — Danger Zone
              ============================ */}
          <div id="c3a-danger">
            <DangerZoneSection
              title={t('account.resetAccount')}
              description={t('account.resetAccountDesc')}
              buttonText={t('account.resetAccount')}
              loadingText={t('account.resetting')}
              isLoading={isResettingAccount}
              onAction={handleResetAccount}
            />
          </div>
        </TwoColLayout>
      </div>

      <DesktopConnectModal
        launchPhase={launchPhase}
        onRetry={retryLaunch}
        onCancel={cancelLaunch}
      />
    </div>
  );
}

// ============================================================
// Local components
// ============================================================

interface C3aGitHubIdentityCardProps {
  configured: boolean;
  username?: string;
  pat: string;
  setPat: (v: string) => void;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
  labelSave: string;
  labelSaving: string;
  labelGenerate: string;
  labelDelete: string;
}

function C3aGitHubIdentityCard({
  configured,
  username,
  pat,
  setPat,
  isSaving,
  onSave,
  onDelete,
  labelSave,
  labelSaving,
  labelGenerate,
  labelDelete,
}: C3aGitHubIdentityCardProps) {
  const scopes = ['repo', 'user', 'read:org', 'workflow'];

  if (configured) {
    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: 16,
          background:
            'linear-gradient(135deg, oklch(96% 0.04 290 / 0.65), oklch(97% 0.03 320 / 0.6))',
          border: '1px solid var(--violet-300)',
          borderRadius: 'var(--r-lg)',
          boxShadow:
            '0 0 0 4px oklch(64% 0.20 290 / 0.10), 0 4px 14px -4px oklch(45% 0.20 290 / 0.20)',
        }}
      >
        <IdentityOrb
          initial={username?.[0]?.toUpperCase() ?? 'G'}
          size={48}
          gradient="var(--gradient-aurora)"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 6,
            }}
          >
            <h4
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-1)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              @{username ?? '—'}
            </h4>
            <SignalRing state="running" size={8} />
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            {scopes.map((scope) => (
              <span
                key={scope}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 'var(--r-pill)',
                  background:
                    'oklch(94% 0.06 155 / 0.5)',
                  color: 'oklch(40% 0.14 155)',
                  border:
                    '1px solid oklch(82% 0.10 155)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.01em',
                }}
              >
                <Check size={8} strokeWidth={3} />
                {scope}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={isSaving}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 32,
            padding: '0 12px',
            background: 'transparent',
            color: 'var(--status-error-fg)',
            fontWeight: 600,
            fontSize: 12,
            border: '1px solid transparent',
            borderRadius: 'var(--r-md)',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            opacity: isSaving ? 0.5 : 1,
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background =
              'var(--status-error-bg)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Trash2 size={12} strokeWidth={2} />
          {labelDelete}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        background:
          'linear-gradient(135deg, oklch(97% 0.04 50 / 0.6), oklch(97% 0.05 25 / 0.55))',
        border: '1px solid oklch(85% 0.10 50)',
        borderRadius: 'var(--r-lg)',
        boxShadow:
          '0 0 0 4px oklch(70% 0.18 50 / 0.10), 0 4px 14px -4px oklch(55% 0.18 50 / 0.20)',
      }}
    >
      <AuroraInput
        type="password"
        value={pat}
        onChange={setPat}
        placeholder="ghp_••••••••••••••••••••"
        mono
        onKeyDown={(e) => {
          if (e.key === 'Enter' && pat.trim()) onSave();
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !pat.trim()}
          style={{
            height: 36,
            padding: '0 16px',
            background: 'var(--gradient-pink-orange)',
            color: 'white',
            fontWeight: 700,
            fontSize: 12,
            border: 'none',
            borderRadius: 'var(--r-md)',
            cursor:
              isSaving || !pat.trim() ? 'not-allowed' : 'pointer',
            opacity: isSaving || !pat.trim() ? 0.5 : 1,
          }}
        >
          {isSaving ? labelSaving : labelSave}
        </button>
        <a
          href="https://github.com/settings/tokens/new?scopes=repo&description=ANT%20CLI%20Access"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 36,
            padding: '0 12px',
            color: 'var(--text-3)',
            fontWeight: 600,
            fontSize: 12,
            textDecoration: 'none',
            borderRadius: 'var(--r-md)',
            transition: 'color 0.15s ease',
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.color = 'var(--text-1)')
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.color = 'var(--text-3)')
          }
        >
          {labelGenerate}
        </a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Figma Bridge Section
// ------------------------------------------------------------

interface FigmaBridgeSectionProps {
  bridgeConnected: boolean | null | undefined;
  bridgeDetected: boolean | null | undefined;
  figmaDesktopReachable: boolean | null | undefined;
  isCheckingBridge: boolean;
  onRefresh: () => void;
  onConnectDesktop: () => void;
  tTitle: string;
  tDescription: string;
  tReady: string;
  tSetupNeeded: string;
  tAntDesktop: string;
  tFigmaDesktop: string;
  tStatusConnected: string;
  tStatusDetected: string;
  tStatusNotDetected: string;
  tStatusReachable: string;
  tStatusNotReachable: string;
  tStatusRequiresAntDesktop: string;
  tConnectAntDesktop: string;
  tLaunchAntDesktop: string;
  tLaunchFigmaDesktop: string;
  tDownloadAntDesktop: string;
  tDownloadFigmaDesktop: string;
  tRefresh: string;
}

function FigmaBridgeSection(props: FigmaBridgeSectionProps) {
  const {
    bridgeConnected,
    bridgeDetected,
    figmaDesktopReachable,
    isCheckingBridge,
    onRefresh,
    onConnectDesktop,
    tTitle,
    tDescription,
    tReady,
    tSetupNeeded,
    tAntDesktop,
    tFigmaDesktop,
    tStatusConnected,
    tStatusDetected,
    tStatusNotDetected,
    tStatusReachable,
    tStatusNotReachable,
    tStatusRequiresAntDesktop,
    tConnectAntDesktop,
    tLaunchAntDesktop,
    tLaunchFigmaDesktop,
    tDownloadAntDesktop,
    tDownloadFigmaDesktop,
    tRefresh,
  } = props;

  const fullyOk =
    bridgeConnected === true && Boolean(figmaDesktopReachable);

  const statusState: StatusPillState = isCheckingBridge
    ? 'checking'
    : fullyOk
      ? 'configured'
      : 'not-configured';
  const statusLabel = fullyOk ? tReady : tSetupNeeded;

  const antDesktopState: StatusPillState = bridgeConnected
    ? 'connected'
    : bridgeDetected
      ? 'detected'
      : 'not-connected';
  const antDesktopLabel = bridgeConnected
    ? tStatusConnected
    : bridgeDetected
      ? tStatusDetected
      : tStatusNotDetected;

  const figmaState: StatusPillState = !bridgeConnected
    ? 'not-connected'
    : figmaDesktopReachable
      ? 'connected'
      : 'warning';
  const figmaLabel = !bridgeConnected
    ? tStatusRequiresAntDesktop
    : figmaDesktopReachable
      ? tStatusReachable
      : tStatusNotReachable;

  return (
    <SectionCard
      id="c3a-figma"
      icon="Palette"
      title={tTitle}
      description={tDescription}
      accent="pink-orange"
      status={<StatusPill state={statusState} label={statusLabel} />}
      statusAction={
        <button
          type="button"
          onClick={onRefresh}
          disabled={isCheckingBridge}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            background: 'var(--bg-surface-2)',
            color: 'var(--text-3)',
            border: '1px solid var(--border-1)',
            borderRadius: 'var(--r-pill)',
            fontSize: 10,
            fontWeight: 700,
            cursor: isCheckingBridge ? 'not-allowed' : 'pointer',
            opacity: isCheckingBridge ? 0.5 : 1,
          }}
        >
          {isCheckingBridge ? (
            <Spinner size="sm" tone="inherit" />
          ) : (
            <RefreshIcon />
          )}
          {tRefresh}
        </button>
      }
    >
      <C3aBridgeDiagram
        bridgeConnected={bridgeConnected === true}
        figmaDesktopReachable={Boolean(figmaDesktopReachable)}
        bridgeDetected={Boolean(bridgeDetected)}
        antDesktopState={antDesktopState}
        antDesktopLabel={antDesktopLabel}
        figmaState={figmaState}
        figmaLabel={figmaLabel}
        tAntDesktop={tAntDesktop}
        tFigmaDesktop={tFigmaDesktop}
        tConnectAntDesktop={tConnectAntDesktop}
        tLaunchAntDesktop={tLaunchAntDesktop}
        tLaunchFigmaDesktop={tLaunchFigmaDesktop}
        tDownloadAntDesktop={tDownloadAntDesktop}
        tDownloadFigmaDesktop={tDownloadFigmaDesktop}
        onConnectDesktop={onConnectDesktop}
      />
    </SectionCard>
  );
}

// Refresh icon component (no extra lucide import needed at the
// top of the file because the helper is co-located here).
function RefreshIcon() {
  // Lazy-import: avoids breaking the top imports list. Inline
  // SVG keeps the bundle identical without depending on a new
  // lucide symbol.
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// ------------------------------------------------------------
// Bridge Diagram
// ------------------------------------------------------------

interface C3aBridgeDiagramProps {
  bridgeConnected: boolean;
  figmaDesktopReachable: boolean;
  bridgeDetected: boolean;
  antDesktopState: StatusPillState;
  antDesktopLabel: string;
  figmaState: StatusPillState;
  figmaLabel: string;
  tAntDesktop: string;
  tFigmaDesktop: string;
  tConnectAntDesktop: string;
  tLaunchAntDesktop: string;
  tLaunchFigmaDesktop: string;
  tDownloadAntDesktop: string;
  tDownloadFigmaDesktop: string;
  onConnectDesktop: () => void;
}

function C3aBridgeDiagram({
  bridgeConnected,
  figmaDesktopReachable,
  bridgeDetected,
  antDesktopState,
  antDesktopLabel,
  figmaState,
  figmaLabel,
  tAntDesktop,
  tFigmaDesktop,
  tConnectAntDesktop,
  tLaunchAntDesktop,
  tLaunchFigmaDesktop,
  tDownloadAntDesktop,
  tDownloadFigmaDesktop,
  onConnectDesktop,
}: C3aBridgeDiagramProps) {
  const fullyOk = bridgeConnected && figmaDesktopReachable;
  const partial = bridgeConnected && !figmaDesktopReachable;

  let strokeColor: string;
  let dash: string | undefined;
  let animFlow = false;
  let label: string;

  if (fullyOk) {
    strokeColor = 'var(--violet-500)';
    dash = undefined;
    animFlow = false;
    label = 'ACTIVE';
  } else if (partial) {
    strokeColor = 'oklch(70% 0.18 50)';
    dash = '6 6';
    animFlow = true;
    label = 'PARTIAL';
  } else {
    strokeColor = 'var(--border-3)';
    dash = '4 6';
    animFlow = false;
    label = 'OFFLINE';
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '12px 4px 4px',
        flexWrap: 'wrap',
      }}
    >
      <BridgeNode
        icon="Monitor"
        gradient="var(--gradient-aurora)"
        pulse={bridgeConnected}
        title={tAntDesktop}
        pillState={antDesktopState}
        pillLabel={antDesktopLabel}
        action={
          !bridgeConnected ? (
            <>
              <button
                type="button"
                onClick={onConnectDesktop}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--violet-700)',
                  fontWeight: 600,
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  textDecoration: 'underline',
                }}
              >
                {bridgeDetected
                  ? tConnectAntDesktop
                  : tLaunchAntDesktop}
              </button>
              {!bridgeDetected && (
                <a
                  href={DESKTOP_DOWNLOAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--text-4)',
                    fontSize: 10,
                    textDecoration: 'none',
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.textDecoration =
                      'underline')
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.textDecoration = 'none')
                  }
                >
                  {tDownloadAntDesktop} ↗
                </a>
              )}
            </>
          ) : null
        }
      />

      {/* Connector */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          minWidth: 120,
          padding: '0 8px',
        }}
      >
        <svg
          width={100}
          height={80}
          viewBox="0 0 100 80"
          style={{ overflow: 'visible' }}
          aria-hidden
        >
          <text
            x={50}
            y={28}
            fill="var(--text-3)"
            fontSize={9.5}
            fontWeight={700}
            textAnchor="middle"
            style={{
              textTransform: 'uppercase',
              letterSpacing: 1.2,
            }}
          >
            {label}
          </text>
          {fullyOk && (
            <path
              d="M 5 40 C 30 40, 70 40, 95 40"
              fill="none"
              stroke="var(--violet-400)"
              strokeWidth={8}
              strokeLinecap="round"
              opacity={0.35}
              style={{ filter: 'blur(6px)' }}
            />
          )}
          <path
            d="M 5 40 C 30 40, 70 40, 95 40"
            fill="none"
            stroke={strokeColor}
            strokeWidth={fullyOk ? 3 : 2.5}
            strokeDasharray={dash}
            strokeLinecap="round"
            style={{
              animation: animFlow
                ? 'flow-dash 1.4s linear infinite'
                : 'none',
            }}
          />
          <circle cx={5} cy={40} r={4} fill={strokeColor} />
          <circle cx={95} cy={40} r={4} fill={strokeColor} />
          {fullyOk && (
            <>
              <circle
                cx={5}
                cy={40}
                r={4}
                fill={strokeColor}
                opacity={0.6}
              >
                <animate
                  attributeName="r"
                  from="4"
                  to="11"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  from="0.6"
                  to="0"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle
                cx={95}
                cy={40}
                r={4}
                fill={strokeColor}
                opacity={0.6}
              >
                <animate
                  attributeName="r"
                  from="4"
                  to="11"
                  dur="1.8s"
                  begin="0.9s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  from="0.6"
                  to="0"
                  dur="1.8s"
                  begin="0.9s"
                  repeatCount="indefinite"
                />
              </circle>
            </>
          )}
        </svg>
      </div>

      <BridgeNode
        icon="Palette"
        gradient="var(--gradient-pink-orange)"
        pulse={Boolean(figmaDesktopReachable && bridgeConnected)}
        title={tFigmaDesktop}
        pillState={figmaState}
        pillLabel={figmaLabel}
        action={
          !figmaDesktopReachable && bridgeConnected ? (
            <>
              <button
                type="button"
                onClick={() =>
                  window.open(FIGMA_DEEPLINK_URL, '_self')
                }
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--violet-700)',
                  fontWeight: 600,
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  textDecoration: 'underline',
                }}
              >
                {tLaunchFigmaDesktop}
              </button>
              <a
                href={FIGMA_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-4)',
                  fontSize: 10,
                  textDecoration: 'none',
                }}
                onMouseOver={(e) =>
                  (e.currentTarget.style.textDecoration =
                    'underline')
                }
                onMouseOut={(e) =>
                  (e.currentTarget.style.textDecoration = 'none')
                }
              >
                {tDownloadFigmaDesktop} ↗
              </a>
            </>
          ) : !figmaDesktopReachable && !bridgeConnected ? (
            <a
              href={FIGMA_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--text-4)',
                fontSize: 10,
                textDecoration: 'none',
              }}
              onMouseOver={(e) =>
                (e.currentTarget.style.textDecoration =
                  'underline')
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.textDecoration = 'none')
              }
            >
              {tDownloadFigmaDesktop} ↗
            </a>
          ) : null
        }
      />
    </div>
  );
}

interface BridgeNodeProps {
  icon: string;
  gradient: string;
  pulse: boolean;
  title: string;
  pillState: StatusPillState;
  pillLabel: string;
  action?: ReactNode;
}

function BridgeNode({
  icon,
  gradient,
  pulse,
  title,
  pillState,
  pillLabel,
  action,
}: BridgeNodeProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        minWidth: 140,
        padding: '10px 8px',
      }}
    >
      <IdentityOrb
        icon={icon}
        size={56}
        gradient={gradient}
        pulse={pulse}
      />
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--text-1)',
        }}
      >
        {title}
      </div>
      <StatusPill state={pillState} label={pillLabel} />
      {action && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {action}
        </div>
      )}
    </div>
  );
}

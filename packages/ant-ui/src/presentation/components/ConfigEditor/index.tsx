
import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Bot } from 'lucide-react';
import {
  ProjectConfig,
  fetchOrgConfig,
  fetchUserConfig,
  renameProject,
  deleteProject,
} from '@/infrastructure/http/api';
import { ApiError } from '@/infrastructure/http/api/client';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useStore } from '@/domain/store';
import { ProjectDeletionPanel } from '@/presentation/components/common/ProjectDeletion/ProjectDeletionPanel';
import type { ProjectDeletionErrorShape } from '@ant/shared';
import { useGitSnapshot, useGitPat, useGitPatDispatch } from '@/domain/git-world';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '@/domain/store/storage';
import { useAvailableModels } from './hooks/useAvailableModels';
import { useConfigEditor } from './hooks/useConfigEditor';
import { CONFIG_SCHEMA } from './configSchema';
import { ConfigField, GitHubOwnerInfo } from './components/ConfigField';
import { DomainSelect } from '../Actions/DomainSelect';
import { LLMModelsSection } from './components/LLMModelsSection';
import { ProviderConsentModal } from './components/ProviderConsentModal';
import { DangerZoneSection } from '../common/DangerZoneSection';
import { MODEL_REGISTRY, OVERRIDABLE_MODEL_SLOTS, IMAGE_GEN_SLOTS, providerRequiresDataConsent, type ModelJobKey, type ModelProvider } from '@ant/shared';
import {
  TwoColLayout,
  TocNav,
  useActiveSection,
  ChangedBar,
  SectionCard,
  FieldLabel,
  AuroraInput,
  AuroraSelect,
} from './aurora';

interface ConfigEditorProps {
  config: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

const SECTION_IDS = ['c3p-identity', 'c3p-domain', 'c3p-project-type', 'c3p-repository', 'c3p-llm', 'c3p-danger'] as const;

export function ConfigEditor({ config, onSave, onClose }: ConfigEditorProps) {
  // onClose is handled by MainPanel tab close button (kept for API compatibility)
  void onClose;
  const { t } = useTranslation('config');
  const { availableModels, isLoadingModels, configuredProviders } = useAvailableModels();
  const {
    editedConfig,
    setEditedConfig,
    errors,
    setErrors,
    hasChanges,
    serverMode,
  } = useConfigEditor(config);

  // projectType is a creation-time decision (SSOT: config.json) — universal
  // workspaces show a read-only type card in place of the Domain section and
  // hide canonical-only concerns (repository/git).
  const isUniversal = editedConfig.projectType === 'universal';

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [githubOwnerInfo, setGithubOwnerInfo] = useState<GitHubOwnerInfo>({});
  const [githubRepoManuallyEdited, setGithubRepoManuallyEdited] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const visibleSectionIds = useMemo(
    () =>
      SECTION_IDS.filter((id) =>
        isUniversal ? id !== 'c3p-domain' && id !== 'c3p-repository' : id !== 'c3p-project-type',
      ),
    [isUniversal],
  );
  const [activeSection, setActiveSection] = useActiveSection(visibleSectionIds, scrollerRef);

  // Git snapshot — branchBase locks once a remote is connected (clone/init).
  // NOT `hasGit`: local git always exists once a feature is created, so a
  // hasGit-based lock would make the base branch permanently read-only.
  const snapshot = useGitSnapshot();
  const isBranchBaseLocked = snapshot?.hasRemote ?? false;
  const features = useStore((state) => state.features);
  const patState = useGitPat();
  const { fetchGitPat } = useGitPatDispatch();

  useEffect(() => {
    if (patState === null) void fetchGitPat();
  }, [patState, fetchGitPat]);

  // Project rename state
  const selectedProject = useStore((state) => state.selectedProject);
  const setSelectedProject = useStore((state) => state.setSelectedProject);
  const fetchProjects = useStore((state) => state.fetchProjects);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newProjectName, setNewProjectName] = useState(selectedProject || '');
  const [isRenaming, setIsRenaming] = useState(false);
  const { showSuccess, showError, showConfirm } = useAlertModalContext();

  // Load GitHub owner info (user override > org > personal) for quick-fill.
  useEffect(() => {
    let cancelled = false;
    async function loadGithubOwners() {
      try {
        const [orgConfig, userConfig] = await Promise.all([
          fetchOrgConfig(),
          fetchUserConfig(),
        ]);
        if (cancelled) return;
        const orgOwner = orgConfig.github?.owner;
        const userOverride = userConfig.github?.ownerOverride;
        const personalOwner = useStore.getState().pat?.data?.username;
        const effectiveOrgOwner = userOverride || orgOwner;
        setGithubOwnerInfo({ orgOwner: effectiveOrgOwner, personalOwner });

        const defaultOwner = effectiveOrgOwner || personalOwner;
        if (defaultOwner) {
          setEditedConfig((prev) => {
            // Universal workspaces have no repository section — don't seed a
            // githubRepo default into a form that never shows the field.
            if (prev.projectType === 'universal') return prev;
            if (prev.githubRepo) return prev;
            const repoName = prev.repositoryName || 'my-project';
            return {
              ...prev,
              githubRepo: `https://github.com/${defaultOwner}/${repoName}`,
            };
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[ConfigEditor] Failed to load GitHub owners:', error);
        }
      }
    }
    void loadGithubOwners();
    return () => {
      cancelled = true;
    };
  }, [patState, setEditedConfig]);

  const handleChange = (key: keyof ProjectConfig, value: any) => {
    if (key === 'githubRepo') {
      setGithubRepoManuallyEdited(true);
    }

    setEditedConfig((prev) => {
      const newConfig = {
        ...prev,
        [key]: value,
      };

      if (
        key === 'repositoryName' &&
        typeof value === 'string' &&
        prev.githubRepo &&
        !githubRepoManuallyEdited
      ) {
        const match = prev.githubRepo.match(/^(https:\/\/github\.com\/[^/]+\/)([^/]*)$/);
        if (match) {
          const sanitized = value
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
          newConfig.githubRepo = `${match[1]}${sanitized}`;
        }
      }

      return newConfig;
    });

    if (errors[key]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    CONFIG_SCHEMA.forEach((field) => {
      if (field.required && !editedConfig[field.key]) {
        newErrors[field.key] = t('projectEditor.fieldRequired', { field: t(field.label) });
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setIsSaving(true);
    try {
      const result = await onSave(editedConfig);
      if (result.success) {
        showSuccess(t('projectConfig.saved'));
      } else {
        showError(result.error || t('projectConfig.saveFailed'));
      }
    } catch (error) {
      showError(t('projectConfig.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const commitModelChange = (job: string, nodeType: string, modelId: string) => {
    setEditedConfig((prev) => {
      const prevJob = prev.llmModels?.[job as keyof NonNullable<typeof prev.llmModels>] || {};
      const nextJob: Record<string, string | undefined> = { ...prevJob, [nodeType]: modelId || undefined };
      // Changing a job's Default cascades across that job's row: every text
      // node slot follows the new Default. Image-gen slots (visual sketch /
      // render) keep their own values — a text/default model is nonsensical
      // for image generation.
      if (nodeType === 'default') {
        const jobKey = job as ModelJobKey;
        const imageSlots = new Set(IMAGE_GEN_SLOTS[jobKey] ?? []);
        for (const slot of OVERRIDABLE_MODEL_SLOTS[jobKey] ?? []) {
          if (!imageSlots.has(slot)) nextJob[slot] = modelId || undefined;
        }
      }
      return { ...prev, llmModels: { ...prev.llmModels, [job]: nextJob } };
    });
  };

  // Third-party (DeepSeek / GLM) selections pass through a per-provider
  // informed-consent gate first. The pending selection is held until the user
  // confirms; Cancel drops it (previous model kept). The consent policy is owned
  // by the shared MODEL_REGISTRY + providerRequiresDataConsent, so future models
  // of a gated provider are covered without a hardcoded id.
  const [pendingConsentSelection, setPendingConsentSelection] = useState<
    { job: string; nodeType: string; modelId: string; provider: ModelProvider } | null
  >(null);

  const handleModelChange = (job: string, nodeType: string, modelId: string) => {
    const provider = modelId ? MODEL_REGISTRY[modelId]?.provider : undefined;
    if (provider && providerRequiresDataConsent(provider)) {
      const alreadyAcked = loadFromStorage(STORAGE_KEYS.PROVIDER_CONSENT_ACK(provider)) === true;
      if (!alreadyAcked) {
        setPendingConsentSelection({ job, nodeType, modelId, provider });
        return;
      }
    }
    commitModelChange(job, nodeType, modelId);
  };

  const handleConsentConfirm = (dontShowAgain: boolean) => {
    if (pendingConsentSelection) {
      const { job, nodeType, modelId, provider } = pendingConsentSelection;
      if (dontShowAgain) saveToStorage(STORAGE_KEYS.PROVIDER_CONSENT_ACK(provider), true);
      commitModelChange(job, nodeType, modelId);
    }
    setPendingConsentSelection(null);
  };

  const handleDiscardChanges = () => {
    if (!hasChanges) return;
    showConfirm(t('projectConfig.revertConfirm'), {
      type: 'warning',
      title: t('projectConfig.revertConfirm'),
      confirmText: t('common:button.confirm'),
      cancelText: t('common:button.cancel'),
      onConfirm: () => {
        setEditedConfig(config);
        setErrors({});
      },
    });
  };

  // Cloud 모드에서 repoType 비활성화 여부
  const isRepoTypeDisabled = (fieldKey: string) => {
    return serverMode === 'cloud' && fieldKey === 'repoType';
  };

  const handleRename = async () => {
    const trimmed = newProjectName.trim();
    if (!trimmed || trimmed === selectedProject) {
      setIsEditingName(false);
      setNewProjectName(selectedProject || '');
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      showError(t('projectEditor.renameInvalidName'));
      return;
    }

    showConfirm(
      t('projectEditor.renameConfirm', { oldName: selectedProject, newName: trimmed }),
      {
        type: 'warning',
        title: t('projectEditor.renameProject'),
        confirmText: t('common:button.confirm'),
        cancelText: t('common:button.cancel'),
        onConfirm: async () => {
          setIsRenaming(true);
          try {
            await renameProject(selectedProject!, trimmed);

            const projectFeatures = loadFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES) || {};
            if (projectFeatures[selectedProject!] !== undefined) {
              projectFeatures[trimmed] = projectFeatures[selectedProject!];
              delete projectFeatures[selectedProject!];
              saveToStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES, projectFeatures);
            }

            await fetchProjects();
            setSelectedProject(trimmed);
            setIsEditingName(false);
            showSuccess(t('projectEditor.renameSuccess'));
          } catch (error: any) {
            showError(error.message || t('projectEditor.renameFailed'));
          } finally {
            setIsRenaming(false);
          }
        },
      },
    );
  };

  const startProjectDeletion = useStore((s) => s.startProjectDeletion);
  const markProjectDeletionComplete = useStore((s) => s.markProjectDeletionComplete);
  const markProjectDeletionFailed = useStore((s) => s.markProjectDeletionFailed);
  const resetProjectDeletionSession = useStore((s) => s.resetProjectDeletionSession);

  const runDelete = async (projectId: string, force: boolean) => {
    setIsDeleting(true);
    startProjectDeletion(projectId);
    try {
      await deleteProject(projectId, { force });
      markProjectDeletionComplete();
      await fetchProjects();
      setSelectedProject('');
      useStore.getState().closeMainPanelTab('projectConfig');
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'projectDeletion' && error.stage) {
        const shape: ProjectDeletionErrorShape = {
          kind: 'projectDeletion',
          stage: error.stage as ProjectDeletionErrorShape['stage'],
          message: error.message,
          canForceCleanup: error.canForceCleanup ?? false,
          retryable: error.canForceCleanup ?? false,
          ...(error.hint !== undefined ? { hint: error.hint } : {}),
          ...(error.leftovers !== undefined ? { leftovers: error.leftovers } : {}),
        };
        markProjectDeletionFailed(shape, error.correlationId ?? '');
      } else {
        resetProjectDeletionSession();
        const message = error instanceof Error ? error.message : 'Failed to delete project';
        showError(message);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteProject = () => {
    if (!selectedProject) return;
    showConfirm(
      <>
        <p className="text-sm">
          {t('dangerZone.deleteProjectConfirm', { name: selectedProject })}
        </p>
        <p
          className="text-sm mt-2 whitespace-pre-line"
          style={{ color: 'var(--text-3)' }}
        >
          {t('dangerZone.deleteProjectConfirmMsg')}
        </p>
      </>,
      {
        type: 'warning',
        title: t('dangerZone.deleteProject'),
        confirmText: t('dangerZone.deleteProject'),
        onConfirm: () => {
          void runDelete(selectedProject, false);
        },
      },
    );
  };

  const handleForceDelete = () => {
    const sess = useStore.getState().projectDeletionSession;
    if (sess.kind !== 'failed') return;
    const projectId = sess.projectId;
    if (!projectId) return;
    void runDelete(projectId, true);
  };

  // Per-section dirty flags
  const identityDirty =
    !!selectedProject &&
    isEditingName &&
    newProjectName.trim() !== '' &&
    newProjectName.trim() !== selectedProject;

  // Repository/domain sections are hidden (universal) — keep their dirty
  // flags hard-false so invisible fields can't trip the change bar.
  const repositoryDirty = useMemo(() => {
    if (isUniversal) return false;
    const keys: Array<keyof ProjectConfig> = [
      'repositoryName',
      'repoType',
      'localPath',
      'githubRepo',
      'branchBase',
    ];
    return keys.some((k) => editedConfig[k] !== config[k]);
  }, [isUniversal, editedConfig, config]);

  const domainDirty = useMemo(
    () => !isUniversal && (editedConfig.domain ?? 'service') !== (config.domain ?? 'service'),
    [isUniversal, editedConfig.domain, config.domain],
  );

  const llmDirty = useMemo(() => {
    return JSON.stringify(editedConfig.llmModels ?? {}) !== JSON.stringify(config.llmModels ?? {});
  }, [editedConfig, config]);

  const changedCount = [identityDirty, domainDirty, repositoryDirty, llmDirty].filter(Boolean).length;

  const tocElement = (
    <TocNav
      items={[
        { id: 'c3p-identity', label: '아이덴티티', icon: 'Box', dirty: identityDirty },
        ...(isUniversal
          ? [{ id: 'c3p-project-type', label: t('projectType.title'), icon: 'Bot' }]
          : [
              { id: 'c3p-domain', label: t('domain.title'), icon: 'Globe', dirty: domainDirty },
              { id: 'c3p-repository', label: '저장소', icon: 'GitBranch', dirty: repositoryDirty },
            ]),
        { id: 'c3p-llm', label: 'LLM 모델', icon: 'Brain', dirty: llmDirty },
        { id: 'c3p-danger', label: '위험 영역', icon: 'AlertTriangle' },
      ]}
      active={activeSection}
      onSelect={(id) => {
        setActiveSection(id);
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      <div ref={scrollerRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <TwoColLayout toc={tocElement} contentMaxWidth="none">
          <ChangedBar
            hasChanges={hasChanges}
            isSaving={isSaving}
            count={changedCount}
            onSave={handleSave}
            onDiscard={handleDiscardChanges}
          />

          {/* Identity */}
          {selectedProject && (
            <SectionCard
              id="c3p-identity"
              icon="Box"
              title="아이덴티티"
              accent="cool"
              description={t('projectEditor.projectNameDesc')}
              bodyMaxWidth={640}
            >
              <FieldLabel>{t('projectEditor.projectName')}</FieldLabel>
              {isEditingName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <AuroraInput
                      value={newProjectName}
                      onChange={setNewProjectName}
                      disabled={isRenaming}
                      mono
                      autoComplete="off"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRename();
                        if (e.key === 'Escape') {
                          setIsEditingName(false);
                          setNewProjectName(selectedProject || '');
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRename()}
                    disabled={
                      isRenaming ||
                      !newProjectName.trim() ||
                      newProjectName.trim() === selectedProject
                    }
                    style={{
                      height: 32,
                      padding: '0 12px',
                      background: 'var(--gradient-aurora)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 'var(--r-md)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor:
                        isRenaming ||
                        !newProjectName.trim() ||
                        newProjectName.trim() === selectedProject
                          ? 'not-allowed'
                          : 'pointer',
                      opacity:
                        isRenaming ||
                        !newProjectName.trim() ||
                        newProjectName.trim() === selectedProject
                          ? 0.5
                          : 1,
                    }}
                  >
                    {isRenaming ? '…' : t('common:button.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingName(false);
                      setNewProjectName(selectedProject || '');
                    }}
                    disabled={isRenaming}
                    style={{
                      height: 32,
                      padding: '0 12px',
                      background: 'transparent',
                      border: '1px solid var(--border-2)',
                      borderRadius: 'var(--r-md)',
                      color: 'var(--text-2)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isRenaming ? 'not-allowed' : 'pointer',
                      opacity: isRenaming ? 0.5 : 1,
                    }}
                  >
                    {t('common:button.cancel')}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '8px 12px',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--bg-surface-2)',
                      border: '1px solid var(--border-1)',
                      color: 'var(--text-1)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selectedProject}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNewProjectName(selectedProject || '');
                      setIsEditingName(true);
                    }}
                    title={t('projectEditor.renameProject')}
                    style={{
                      width: 32,
                      height: 32,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'transparent',
                      border: '1px solid var(--border-2)',
                      borderRadius: 'var(--r-md)',
                      color: 'var(--text-3)',
                      cursor: 'pointer',
                    }}
                  >
                    <Pencil size={14} strokeWidth={2} />
                  </button>
                </div>
              )}
            </SectionCard>
          )}

          {/* Universal workspaces have no domain — projectType (not a domain)
              takes the Domain section's slot as a read-only, creation-time
              fact. Canonical projects keep the editable Domain section. */}
          {isUniversal ? (
            <SectionCard
              id="c3p-project-type"
              icon="Bot"
              title={t('projectType.title')}
              accent="pink-orange"
              description={t('projectType.description')}
              bodyMaxWidth={640}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-1)',
                }}
              >
                <Bot size={16} style={{ color: 'var(--pink-500, oklch(70% 0.2 350))', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                    {t('projectType.universal')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {t('projectType.universalDesc')}
                  </div>
                </div>
              </div>
            </SectionCard>
          ) : (
          /* Domain — project-level SSOT (service vs game). Editing here writes
              config.json on save; the projectConfigSlice mirror then updates
              actionMetadata.domain and runs the domain-transition cleanup. */
          <SectionCard
            id="c3p-domain"
            icon="Globe"
            title={t('domain.title')}
            accent="cool"
            description={t('domain.description')}
            bodyMaxWidth={640}
          >
            <DomainSelect
              value={editedConfig.domain ?? 'service'}
              onChange={(d) => handleChange('domain', d)}
              labels={{
                service: { title: t('domain.service'), desc: t('domain.serviceDesc') },
                game: { title: t('domain.game'), desc: t('domain.gameDesc') },
              }}
            />
          </SectionCard>
          )}

          {/* Repository — canonical-only concern (universal workspaces have no
              git/features; see the project wizard's universal branch). */}
          {!isUniversal && (
          <SectionCard
            id="c3p-repository"
            icon="GitBranch"
            title={t('schema.repositoryName')}
            accent="violet-pink"
            bodyMaxWidth={640}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {CONFIG_SCHEMA.map((field) => (
                <ConfigField
                  key={field.key}
                  field={field}
                  value={editedConfig[field.key]}
                  hasError={!!errors[field.key]}
                  errorMessage={errors[field.key]}
                  isRepoTypeDisabled={isRepoTypeDisabled(field.key)}
                  showLocalPath={false}
                  onChange={handleChange}
                  githubOwnerInfo={githubOwnerInfo}
                  projectName={editedConfig.repositoryName}
                  gitSnapshot={snapshot}
                />
              ))}

              {/* Base branch — a pointer into the feature set (branch == feature
                  name). Locked after remote connection; before that, a dropdown
                  of existing features; with zero features there is nothing to
                  point at, so it is free text seeding the feature Publish
                  materializes (the first feature created overwrites it). */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <FieldLabel>{t('schema.baseBranch')}</FieldLabel>
                <p style={{ margin: '-2px 0 8px', fontSize: 11, color: 'var(--text-4)' }}>
                  {isBranchBaseLocked
                    ? t('schema.baseBranchLockedDesc')
                    : features.length > 0
                      ? t('schema.baseBranchPickDesc')
                      : t('schema.baseBranchNoFeatures')}
                </p>
                {isBranchBaseLocked ? (
                  <div
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--bg-surface-2)',
                      border: '1px solid var(--border-1)',
                      color: 'var(--text-2)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                    }}
                  >
                    {editedConfig.branchBase || 'main'}
                  </div>
                ) : features.length === 0 ? (
                  <AuroraInput
                    value={editedConfig.branchBase || ''}
                    onChange={(v) => handleChange('branchBase', v)}
                    placeholder="main"
                    mono
                  />
                ) : (
                  <AuroraSelect
                    value={editedConfig.branchBase || features[0]?.name || 'main'}
                    onChange={(v) => handleChange('branchBase', v)}
                    options={(() => {
                      const opts = features.map((f) => ({ value: f.name, label: f.name }));
                      // Transient race guard: keep a saved branchBase visible even
                      // if it's momentarily absent from the features list.
                      const saved = editedConfig.branchBase;
                      if (saved && !opts.some((o) => o.value === saved)) {
                        opts.unshift({ value: saved, label: saved });
                      }
                      return opts;
                    })()}
                  />
                )}
              </div>
            </div>
          </SectionCard>
          )}

          {/* LLM Models — renders its own SectionCard with id="c3p-llm" */}
          <LLMModelsSection
            editedConfig={editedConfig}
            availableModels={availableModels}
            isLoadingModels={isLoadingModels}
            onModelChange={handleModelChange}
            configuredProviders={configuredProviders}
          />

          {/* Danger Zone */}
          {selectedProject && (
            <div id="c3p-danger">
              <DangerZoneSection
                title={t('dangerZone.deleteProject')}
                description={t('dangerZone.deleteProjectDesc')}
                buttonText={t('dangerZone.deleteProject')}
                loadingText={t('dangerZone.deleting')}
                isLoading={isDeleting}
                onAction={handleDeleteProject}
              />
            </div>
          )}
        </TwoColLayout>
      </div>

      <ProjectDeletionPanel onForceDelete={handleForceDelete} />

      <ProviderConsentModal
        isOpen={pendingConsentSelection !== null}
        provider={pendingConsentSelection?.provider ?? 'deepseek'}
        onConfirm={handleConsentConfirm}
        onCancel={() => setPendingConsentSelection(null)}
      />
    </div>
  );
}

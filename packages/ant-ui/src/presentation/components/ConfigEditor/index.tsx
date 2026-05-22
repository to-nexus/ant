
import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
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
import { LLMModelsSection } from './components/LLMModelsSection';
import { DangerZoneSection } from '../common/DangerZoneSection';
import {
  TwoColLayout,
  TocNav,
  useActiveSection,
  ChangedBar,
  SectionCard,
  FieldLabel,
  AuroraInput,
} from './aurora';

interface ConfigEditorProps {
  config: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

const SECTION_IDS = ['c3p-identity', 'c3p-repository', 'c3p-llm', 'c3p-danger'] as const;

export function ConfigEditor({ config, onSave, onClose }: ConfigEditorProps) {
  // onClose is handled by MainPanel tab close button (kept for API compatibility)
  void onClose;
  const { t } = useTranslation('config');
  const { availableModels, isLoadingModels, defaultModelId } = useAvailableModels();
  const {
    editedConfig,
    setEditedConfig,
    errors,
    setErrors,
    hasChanges,
    serverMode,
  } = useConfigEditor(config, defaultModelId);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [githubOwnerInfo, setGithubOwnerInfo] = useState<GitHubOwnerInfo>({});
  const [githubRepoManuallyEdited, setGithubRepoManuallyEdited] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeSection = useActiveSection([...SECTION_IDS], scrollerRef);

  // Git snapshot (determines if branchBase is editable)
  const snapshot = useGitSnapshot();
  const isGitInitialized = snapshot?.hasGit ?? false;
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

  const handleModelChange = (job: string, nodeType: string, modelId: string) => {
    setEditedConfig((prev) => ({
      ...prev,
      llmModels: {
        ...prev.llmModels,
        [job]: {
          ...(prev.llmModels?.[job as keyof NonNullable<typeof prev.llmModels>] || {}),
          [nodeType]: modelId || undefined,
        },
      },
    }));
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

  const repositoryDirty = useMemo(() => {
    const keys: Array<keyof ProjectConfig> = [
      'repositoryName',
      'repoType',
      'localPath',
      'githubRepo',
      'branchBase',
    ];
    return keys.some((k) => editedConfig[k] !== config[k]);
  }, [editedConfig, config]);

  const llmDirty = useMemo(() => {
    return JSON.stringify(editedConfig.llmModels ?? {}) !== JSON.stringify(config.llmModels ?? {});
  }, [editedConfig, config]);

  const changedCount = [identityDirty, repositoryDirty, llmDirty].filter(Boolean).length;

  const tocElement = (
    <TocNav
      items={[
        { id: 'c3p-identity', label: '아이덴티티', icon: 'Cube', dirty: identityDirty },
        { id: 'c3p-repository', label: '저장소', icon: 'GitBranch', dirty: repositoryDirty },
        { id: 'c3p-llm', label: 'LLM 모델', icon: 'Brain', dirty: llmDirty },
        { id: 'c3p-danger', label: '위험 영역', icon: 'AlertTriangle' },
      ]}
      active={activeSection}
      onSelect={(id) => {
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
        <TwoColLayout toc={tocElement}>
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
              icon="Cube"
              title="아이덴티티"
              accent="cool"
              description={t('projectEditor.projectNameDesc')}
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

          {/* Repository */}
          <SectionCard
            id="c3p-repository"
            icon="GitBranch"
            title={t('schema.repositoryName')}
            accent="violet-pink"
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

              {/* Base branch */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <FieldLabel>{t('schema.baseBranch')}</FieldLabel>
                <p style={{ margin: '-2px 0 8px', fontSize: 11, color: 'var(--text-4)' }}>
                  {isGitInitialized
                    ? t('schema.baseBranchDesc')
                    : t('schema.baseBranchEditable')}
                </p>
                {isGitInitialized ? (
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
                ) : (
                  <AuroraInput
                    value={editedConfig.branchBase || ''}
                    onChange={(v) => handleChange('branchBase', v)}
                    placeholder="main"
                    mono
                  />
                )}
              </div>
            </div>
          </SectionCard>

          {/* LLM Models — renders its own SectionCard with id="c3p-llm" */}
          <LLMModelsSection
            editedConfig={editedConfig}
            availableModels={availableModels}
            isLoadingModels={isLoadingModels}
            onModelChange={handleModelChange}
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
    </div>
  );
}

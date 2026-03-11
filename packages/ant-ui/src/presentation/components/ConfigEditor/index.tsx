import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { ProjectConfig, fetchOrgConfig, fetchUserConfig, checkGitHubPATStatus, renameProject } from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useStore } from '@/domain/store';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '@/domain/store/storage';
import { useAvailableModels } from './hooks/useAvailableModels';
import { useConfigEditor } from './hooks/useConfigEditor';
import { CONFIG_SCHEMA } from './configSchema';
import { ConfigEditorHeader } from './components/ConfigEditorHeader';
import { ConfigField, GitHubOwnerInfo } from './components/ConfigField';
import { LLMModelsSection } from './components/LLMModelsSection';

interface ConfigEditorProps {
  config: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

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
    backendMode
  } = useConfigEditor(config, defaultModelId);
  
  const [isSaving, setIsSaving] = useState(false);
  const [githubOwnerInfo, setGithubOwnerInfo] = useState<GitHubOwnerInfo>({});

  // Git status (determines if branchBase is editable)
  const gitStatus = useStore((state) => state.gitStatus);
  const isGitInitialized = gitStatus?.hasGit ?? false;

  // Project rename state
  const selectedProject = useStore((state) => state.selectedProject);
  const setSelectedProject = useStore((state) => state.setSelectedProject);
  const fetchProjects = useStore((state) => state.fetchProjects);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newProjectName, setNewProjectName] = useState(selectedProject || '');
  const [isRenaming, setIsRenaming] = useState(false);
  const { showSuccess, showError, showConfirm } = useAlertModalContext();

  // Load GitHub owner info (user override > org > personal) for quick-fill
  useEffect(() => {
    async function loadGithubOwners() {
      try {
        const [orgConfig, userConfig, patStatus] = await Promise.all([
          fetchOrgConfig(),
          fetchUserConfig(),
          checkGitHubPATStatus(),
        ]);
        const orgOwner = orgConfig.github?.owner;
        const userOverride = userConfig.github?.ownerOverride;
        const personalOwner = patStatus.username;
        // Org button shows effective org owner (user override > org config)
        const effectiveOrgOwner = userOverride || orgOwner;
        setGithubOwnerInfo({ orgOwner: effectiveOrgOwner, personalOwner });

        // Auto-fill githubRepo if empty: effective org > personal
        const defaultOwner = effectiveOrgOwner || personalOwner;
        if (defaultOwner) {
          setEditedConfig(prev => {
            if (prev.githubRepo) return prev; // already has a value
            const repoName = prev.repositoryName || 'my-project';
            return { ...prev, githubRepo: `https://github.com/${defaultOwner}/${repoName}` };
          });
        }
      } catch (error) {
        console.error('[ConfigEditor] Failed to load GitHub owners:', error);
      }
    }
    loadGithubOwners();
  }, []);

  const handleChange = (key: keyof ProjectConfig, value: any) => {
    setEditedConfig(prev => {
      const newConfig = {
        ...prev,
        [key]: value
      };

      if (key === 'repositoryName' && typeof value === 'string' && prev.githubRepo) {
        const match = prev.githubRepo.match(/^(https:\/\/github\.com\/[^/]+\/)([^/]*)$/);
        if (match) {
          const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
          newConfig.githubRepo = `${match[1]}${sanitized}`;
        }
      }

      return newConfig;
    });
    
    // Clear error for this field
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    CONFIG_SCHEMA.forEach(field => {
      if (field.required && !editedConfig[field.key]) {
        newErrors[field.key] = t('projectEditor.fieldRequired', { field: t(field.label) });
      }
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      return;
    }
    
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
    setEditedConfig(prev => ({
      ...prev,
      llmModels: {
        ...prev.llmModels,
        [job]: {
          ...(prev.llmModels?.[job as 'design' | 'code' | 'learn'] || {}),
          [nodeType]: modelId || undefined  // Remove if empty string
        }
      }
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
      }
    });
  };

  // Cloud 모드에서 repoType 비활성화 여부
  const isRepoTypeDisabled = (fieldKey: string) => {
    return backendMode === 'cloud' && fieldKey === 'repoType';
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

    showConfirm(t('projectEditor.renameConfirm', { oldName: selectedProject, newName: trimmed }), {
      type: 'warning',
      title: t('projectEditor.renameProject'),
      confirmText: t('common:button.confirm'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        setIsRenaming(true);
        try {
          await renameProject(selectedProject!, trimmed);

          // Migrate PROJECT_LAST_FEATURES mapping key
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
      }
    });
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-white dark:bg-gray-800">
      <ConfigEditorHeader
        hasChanges={hasChanges}
        isSaving={isSaving}
        onSave={handleSave}
        onDiscardChanges={handleDiscardChanges}
      />
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Project Name (rename) Section */}
          {selectedProject && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('projectEditor.projectName')}
                </label>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('projectEditor.projectNameDesc')}
              </p>
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename();
                      if (e.key === 'Escape') {
                        setIsEditingName(false);
                        setNewProjectName(selectedProject || '');
                      }
                    }}
                    autoFocus
                    disabled={isRenaming}
                    className="flex-1 px-3 py-2 border rounded-md text-sm 
                      bg-white dark:bg-gray-800 
                      text-gray-900 dark:text-white
                      border-gray-300 dark:border-gray-600
                      focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                      disabled:opacity-50"
                  />
                  <button
                    onClick={handleRename}
                    disabled={isRenaming || !newProjectName.trim() || newProjectName.trim() === selectedProject}
                    className="px-3 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isRenaming ? '...' : t('common:button.save')}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingName(false);
                      setNewProjectName(selectedProject || '');
                    }}
                    disabled={isRenaming}
                    className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    {t('common:button.cancel')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 border rounded-md text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600">
                    {selectedProject}
                  </div>
                  <button
                    onClick={() => {
                      setNewProjectName(selectedProject || '');
                      setIsEditingName(true);
                    }}
                    className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                    title={t('projectEditor.renameProject')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {CONFIG_SCHEMA.map(field => (
            <ConfigField
              key={field.key}
              field={field}
              value={editedConfig[field.key]}
              hasError={!!errors[field.key]}
              errorMessage={errors[field.key]}
              isRepoTypeDisabled={isRepoTypeDisabled(field.key)}
              showLocalPath={backendMode !== 'cloud'}
              onChange={handleChange}
              githubOwnerInfo={githubOwnerInfo}
              projectName={editedConfig.repositoryName}
              gitStatus={gitStatus}
            />
          ))}

          {/* Base Branch: editable before git init, read-only after */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('schema.baseBranch')}
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isGitInitialized
                ? t('schema.baseBranchDesc')
                : t('schema.baseBranchEditable')}
            </p>
            {isGitInitialized ? (
              <div className="w-full px-3 py-2 border rounded-md text-sm bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 cursor-default">
                {editedConfig.branchBase || 'main'}
              </div>
            ) : (
              <input
                type="text"
                value={editedConfig.branchBase || ''}
                onChange={(e) => handleChange('branchBase', e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 border rounded-md text-sm
                  bg-white dark:bg-gray-800
                  text-gray-900 dark:text-white
                  border-gray-300 dark:border-gray-600
                  focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                  placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            )}
          </div>
          
          {/* LLM Models Section */}
          <LLMModelsSection
            editedConfig={editedConfig}
            availableModels={availableModels}
            isLoadingModels={isLoadingModels}
            onModelChange={handleModelChange}
          />
        </div>
      </div>
    </div>
  );
}

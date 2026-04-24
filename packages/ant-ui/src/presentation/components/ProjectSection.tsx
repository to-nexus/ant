import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createProject } from '@/infrastructure/http/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { CreationWizardModal } from './CreationWizardModal';
import { GitPanel } from '@/presentation/git-panel';
import { useGithubRepo } from '@/domain/project-world';
import {
  selectProjectConfigMissing,
  selectProjectConfigExists,
} from '@/domain/store/selectors';

export function ProjectSection({ explorerWidth }: { explorerWidth: number }) {
  const { t } = useTranslation('explorer');
  const {
    projects,
    selectedProject,
    selectedFeature,
    setSelectedProject,
    fetchProjects,
    openMainPanelTab,
    backendMode,
    fetchProjectConfig,
    createProjectConfig,
  } = useStore();

  const projectConfigData = useStore((s) => s.projectConfig.data);
  const projectConfigMissing = useStore(selectProjectConfigMissing);
  const projectConfigReady = useStore(selectProjectConfigExists);
  const githubRepo = useGithubRepo();

  const [showWizard, setShowWizard] = useState(false);
  const [forceInlineCreate, setForceInlineCreate] = useState(false);
  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleCreateEmpty = useCallback(() => {
    setShowWizard(false);
    setForceInlineCreate(true);
  }, []);
  const handleForceInlineCreateHandled = useCallback(() => setForceInlineCreate(false), []);
  const gitMenuRef = useRef<HTMLDivElement>(null);
  const policy = useUIActionPolicy();
  const { showError } = useAlertModalContext();

  useEffect(() => {
    if (selectedProject) {
      fetchProjectConfig(selectedProject);
    }
  }, [selectedProject, fetchProjectConfig]);

  const handleCreateProject = async (projectName: string) => {
    await createProject(projectName);
    setSelectedProject(projectName);
  };

  const handleConfigClick = async () => {
    if (!selectedProject) return;
    if (projectConfigMissing) {
      try {
        await createProjectConfig(selectedProject, backendMode);
      } catch (error) {
        console.error('Failed to create config:', error);
        showError(t('workspace.createFailed'));
        return;
      }
    }
    openMainPanelTab('projectConfig');
  };

  const handleOpenPatConfig = useCallback(
    () => openMainPanelTab('accountConfig'),
    [openMainPanelTab],
  );
  const handleOpenProjectConfig = useCallback(
    () => openMainPanelTab('projectConfig'),
    [openMainPanelTab],
  );

  const projectItems = projects.map((p: string) => ({ name: p }));

  return (
    <div>
      <ItemDropdown
        title={t('workspace.title')}
        icon={Folder}
        items={projectItems}
        selectedItem={selectedProject}
        onSelect={setSelectedProject}
        onCreate={handleCreateProject}
        onItemCreated={fetchProjects}
        placeholder={t('workspace.placeholder')}
        inputPlaceholder={t('workspace.inputPlaceholder')}
        onSettingsClick={handleConfigClick}
        disabled={!policy.canChangeProject}
        disabledReason={policy.disabledReason || undefined}
        onOpenWizard={handleOpenWizard}
        forceInlineCreate={forceInlineCreate}
        onForceInlineCreateHandled={handleForceInlineCreateHandled}
        isNarrow={explorerWidth < 260}
      />

      <CreationWizardModal
        isOpen={showWizard}
        onClose={handleCloseWizard}
        onCreateEmpty={handleCreateEmpty}
      />

      {/* Git panel — single entry point into the `git-world` slice. Replaces
          the former bespoke section (GitStatusButton + menu + handlers). */}
      {selectedProject && (
        <div className="mt-2" ref={gitMenuRef}>
          <GitPanel
            feature={selectedFeature || undefined}
            githubRepo={githubRepo}
            onOpenPatConfig={handleOpenPatConfig}
            onOpenProjectConfig={handleOpenProjectConfig}
          />

          {projectConfigMissing && (
            <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
              <div className="flex items-start gap-1.5">
                <span className="text-orange-600 dark:text-orange-400 text-xs flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    {t('config:git.configRequired')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {backendMode !== 'cloud' &&
            projectConfigReady &&
            !projectConfigData?.localPath &&
            projectConfigData?.repoType !== 'cloud' && (
              <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
                <div className="flex items-start gap-1.5">
                  <span className="text-orange-600 dark:text-orange-400 text-xs flex-shrink-0">⚠️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-orange-700 dark:text-orange-300">
                      {t('config:git.localPathRequired')}
                    </p>
                  </div>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder } from 'lucide-react';
import { useStore } from '@/domain/store';
import { selectServerMode } from '@/domain/store/selectors/auth';
import { createProject } from '@/infrastructure/http/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { CreationWizardModal } from './CreationWizardModal';
import { GitStatusButton } from './GitStatusButton';
import { GitMenuButton } from './GitMenuButton';
import { useGitSnapshot } from '@/domain/git-world';
import {
  selectProjectConfigMissing,
  selectProjectConfigExists,
} from '@/domain/store/selectors';

export function ProjectSection({ explorerWidth }: { explorerWidth: number }) {
  const { t } = useTranslation('explorer');
  const {
    projects,
    selectedProject,
    setSelectedProject,
    fetchProjects,
    openMainPanelTab,
    fetchProjectConfig,
    createProjectConfig,
  } = useStore();
  const serverMode = useStore((state) => selectServerMode(state));
  const projectConfigData = useStore((s) => s.projectConfig.data);
  const projectConfigMissing = useStore(selectProjectConfigMissing);
  const projectConfigReady = useStore(selectProjectConfigExists);
  const snapshot = useGitSnapshot();

  const [showWizard, setShowWizard] = useState(false);
  const [forceInlineCreate, setForceInlineCreate] = useState(false);
  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleCreateEmpty = useCallback(() => {
    setShowWizard(false);
    setForceInlineCreate(true);
  }, []);
  const handleForceInlineCreateHandled = useCallback(() => setForceInlineCreate(false), []);
  const policy = useUIActionPolicy();
  const { showError } = useAlertModalContext();

  // Initial project config fetch. Git state refresh on (project, feature)
  // changes is owned by `useProjectLifecycle` — this effect only pulls
  // projectConfig because it's project-scoped (feature-independent).
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
        await createProjectConfig(selectedProject);
      } catch (error) {
        console.error('Failed to create config:', error);
        showError(t('workspace.createFailed'));
        return;
      }
    }
    openMainPanelTab('projectConfig');
  };

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

      {/* Git Status Section — the two Git buttons sit side-by-side and
          read through the same `git-world` selectors:
            <GitStatusButton /> → primary action (Commit/Push/Pull/Sync/Publish)
            <GitMenuButton />   → secondary dropdown (Clone/Init/Publish/Push/Pull/Fetch)
          Their consistency is guaranteed by shared selectors + FSM. */}
      {selectedProject && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            <GitStatusButton />
            <GitMenuButton />
          </div>

          {/* Current Branch Display.
              Branch name comes from the git-world snapshot. Rendered only
              once the snapshot is loaded and a `.git` directory exists. */}
          {snapshot?.currentBranch && (
            <div className="px-2 text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {explorerWidth >= 260 && <>{t('config:git.currentBranch')}{' '}</>}
              <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{snapshot.currentBranch}</span>
            </div>
          )}

          {/* Warning Messages */}
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

          {serverMode !== 'cloud' &&
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

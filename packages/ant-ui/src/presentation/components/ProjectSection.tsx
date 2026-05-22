import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createProject } from '@/infrastructure/http/api';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { CreationWizardModal } from './CreationWizardModal';
import { useGitSnapshot } from '@/domain/git-world';
import {
  selectProjectConfigMissing,
} from '@/domain/store/selectors';
import { SectionShell } from './layout/Explorer/SectionShell';
import { RowList } from './layout/Explorer/RowList';
import { ProjectRow, type ProjectDotAccent } from './layout/Explorer/ProjectRow';
import { GitToolbar } from './layout/Explorer/GitToolbar';

const PROJECT_DOTS: ProjectDotAccent[] = ['violet', 'pink', 'orange', 'cool'];

/** Deterministic 4px accent dot color per project name (spec §5.4). */
function pickAccent(name: string): ProjectDotAccent {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PROJECT_DOTS[Math.abs(h) % PROJECT_DOTS.length];
}

export function ProjectSection({ explorerWidth: _explorerWidth }: { explorerWidth: number }) {
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
  const projectConfigMissing = useStore(selectProjectConfigMissing);
  const snapshot = useGitSnapshot();

  const [showWizard, setShowWizard] = useState(false);
  const [forceInlineCreate, setForceInlineCreate] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleCreateEmpty = useCallback(() => {
    setShowWizard(false);
    setForceInlineCreate(true);
  }, []);
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

  const projectAccents = useMemo(() => {
    const map: Record<string, ProjectDotAccent> = {};
    for (const p of projects) map[p] = pickAccent(p);
    return map;
  }, [projects]);

  // Order: active project on top, others below.
  const orderedProjects = useMemo(() => {
    if (!selectedProject) return projects;
    return [
      selectedProject,
      ...projects.filter((p) => p !== selectedProject),
    ];
  }, [projects, selectedProject]);

  const handleSwitchProject = useCallback(
    (name: string) => {
      if (!policy.canChangeProject) return;
      setSelectedProject(name);
    },
    [policy.canChangeProject, setSelectedProject],
  );

  const handleClearProject = useCallback(() => {
    setSelectedProject(undefined);
  }, [setSelectedProject]);

  const handleSubmitNewProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      await handleCreateProject(name);
      setNewProjectName('');
      setForceInlineCreate(false);
      fetchProjects();
    } catch (err) {
      console.error('Failed to create project:', err);
      showError(t('workspace.createFailed'));
    }
  }, [newProjectName, fetchProjects, showError, t]);

  return (
    <div>
      <SectionShell
        eyebrow={t('workspace.title')}
        count={projects.length}
        accent="violet"
        action={
          <button
            type="button"
            onClick={handleOpenWizard}
            disabled={!policy.canChangeProject}
            title={
              !policy.canChangeProject
                ? policy.disabledReason || undefined
                : t('workspace.inputPlaceholder')
            }
            aria-label={t('workspace.inputPlaceholder')}
            style={{
              height: 22,
              width: 22,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              color: '#fff',
              background: 'var(--gradient-aurora)',
              boxShadow: 'var(--shadow-glow-aurora)',
              border: 'none',
              cursor: policy.canChangeProject ? 'pointer' : 'not-allowed',
              opacity: policy.canChangeProject ? 1 : 0.5,
            }}
          >
            <Plus size={12} />
          </button>
        }
      >
        {projects.length === 0 ? (
          <div
            style={{
              padding: '12px 8px',
              fontSize: 12,
              color: 'var(--text-3)',
              textAlign: 'center',
              border: '1px dashed var(--border-1)',
              borderRadius: 8,
              background: 'var(--surface-2)',
            }}
          >
            {t('workspace.placeholder')}
          </div>
        ) : (
          <RowList ariaLabel={t('workspace.title')}>
            {orderedProjects.map((name) => {
              const isActive = name === selectedProject;
              const row = (
                <ProjectRow
                  key={name}
                  name={name}
                  isActive={isActive}
                  accent={projectAccents[name] || 'violet'}
                  disabled={!policy.canChangeProject && !isActive}
                  disabledReason={policy.disabledReason || undefined}
                  onSwitch={() => handleSwitchProject(name)}
                  onClear={isActive ? handleClearProject : undefined}
                  onSettings={isActive ? handleConfigClick : undefined}
                />
              );
              // Git toolbar sits directly under the active project row,
              // INSIDE the RowList so it stays adjacent to the selection
              // it controls. The list is scrollable up to 240px (RowList
              // default); preview-editor entry and other always-visible
              // controls live in `FeatureSection` outside its own list.
              if (isActive) {
                return (
                  <div key={name}>
                    {row}
                    <GitToolbar />
                    {snapshot?.currentBranch && (
                      <div
                        className="font-mono truncate"
                        style={{
                          marginTop: 4,
                          padding: '2px 10px',
                          fontSize: 11,
                          color: 'var(--text-3)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={snapshot.currentBranch}
                      >
                        {snapshot.currentBranch}
                      </div>
                    )}
                    {projectConfigMissing && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: '6px 8px',
                          borderRadius: 6,
                          border: '1px solid color-mix(in srgb, var(--orange-500) 35%, transparent)',
                          background: 'color-mix(in srgb, var(--orange-500) 12%, transparent)',
                          color: 'var(--orange-500)',
                          fontSize: 11,
                          display: 'flex',
                          gap: 6,
                          alignItems: 'flex-start',
                        }}
                      >
                        <span aria-hidden>⚠️</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {t('config:git.configRequired')}
                        </span>
                      </div>
                    )}
                  </div>
                );
              }
              return row;
            })}
          </RowList>
        )}

        {forceInlineCreate && (
          <div
            style={{
              marginTop: 6,
              display: 'flex',
              gap: 4,
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmitNewProject();
                if (e.key === 'Escape') {
                  setForceInlineCreate(false);
                  setNewProjectName('');
                }
              }}
              placeholder={t('workspace.inputPlaceholder')}
              style={{
                flex: 1,
                minWidth: 0,
                height: 26,
                padding: '0 8px',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text-1)',
                background: 'var(--surface-1)',
                border: '1px solid var(--border-1)',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => void handleSubmitNewProject()}
              disabled={!newProjectName.trim()}
              style={{
                height: 26,
                padding: '0 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                color: '#fff',
                background: 'var(--gradient-aurora)',
                boxShadow: 'var(--shadow-glow-aurora)',
                border: 'none',
                cursor: newProjectName.trim() ? 'pointer' : 'not-allowed',
                opacity: newProjectName.trim() ? 1 : 0.5,
              }}
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => {
                setForceInlineCreate(false);
                setNewProjectName('');
              }}
              style={{
                height: 26,
                padding: '0 10px',
                borderRadius: 6,
                fontSize: 11,
                color: 'var(--text-3)',
                background: 'transparent',
                border: '1px solid var(--border-1)',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        )}
      </SectionShell>

      <CreationWizardModal
        isOpen={showWizard}
        onClose={handleCloseWizard}
        onCreateEmpty={handleCreateEmpty}
      />
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Settings } from 'lucide-react';
import { useStore } from '@/domain/store';
import {
  createProject,
  fetchProjectConfig as apiFetchProjectConfig,
  createProjectConfig as apiCreateProjectConfig,
} from '@/infrastructure/http/api';
import type { ProjectType } from '@/domain/store/slices/universalSlice';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { CreationWizardModal } from './CreationWizardModal';
import {
  selectProjectConfigMissing,
} from '@/domain/store/selectors';
import { SectionShell } from './layout/Explorer/SectionShell';
import { RowList } from './layout/Explorer/RowList';
import { ProjectRow, type ProjectDotAccent } from './layout/Explorer/ProjectRow';
import { GitToolbar } from './layout/Explorer/GitToolbar';
import type { Domain } from '@ant/shared';

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
    updateProjectConfig,
  } = useStore();
  const projectConfigMissing = useStore(selectProjectConfigMissing);
  // Live domain mirror for the ACTIVE project. `actionMetadata.domain` is the
  // derived mirror of the project's `config.json` domain — the projectConfig
  // mirror keeps it in sync after a project-settings domain change — so the
  // active row reads from here to reflect a change without waiting on a fetch.
  const activeDomain = useStore((s) => s.actionMetadata.domain as Domain | undefined);

  const [showWizard, setShowWizard] = useState(false);
  // Inline-create form visibility + the projectType the created project gets
  // (creation-time decision — carried from the CreationWizardModal tab).
  const [inlineCreateType, setInlineCreateType] = useState<ProjectType | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  // Per-project config meta cache for the NON-active rows (project-level SSOT
  // is `config.json` — domain + projectType, one value per project, feature-
  // independent). Filled by a bulk parallel fetch; never routed through the
  // single-project `projectConfig` store slice.
  const [projectMetaByName, setProjectMetaByName] = useState<
    Record<string, { domain: Domain; projectType: ProjectType }>
  >({});
  // Live projectType mirror for the ACTIVE project (universalSlice, synced
  // from config.json on every load/save).
  const activeProjectType = useStore((s) => s.projectType as ProjectType);

  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleCreateEmpty = useCallback((projectType: ProjectType) => {
    setShowWizard(false);
    setInlineCreateType(projectType);
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

  const handleCreateProject = async (projectName: string, projectType: ProjectType = 'canonical') => {
    await createProject(projectName);
    setSelectedProject(projectName);
    if (projectType === 'universal') {
      // Record the projectType SSOT (same fetch→merge→PUT sequence as the
      // project wizard; git/domain are canonical-project concerns and stay
      // untouched). Saved via the store slice so `syncProjectTypeFromConfig`
      // flips the sidebar/toolbar gates immediately.
      let serverConfig = await apiFetchProjectConfig(projectName);
      if (!serverConfig) {
        serverConfig = await apiCreateProjectConfig(projectName);
      }
      const result = await updateProjectConfig(projectName, {
        ...serverConfig,
        projectType: 'universal',
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to persist projectType');
      }
    }
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

  // Bulk-resolve every project's config meta so ALL rows show the correct icon
  // without any interaction (including when no project/feature is selected).
  // Uses the RAW API (aliased) — the store's `fetchProjectConfig` is a
  // single-project slice writer and must NOT be used for other projects.
  useEffect(() => {
    const missing = projects.filter((p) => !(p in projectMetaByName));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.allSettled(
      missing.map(async (name) => {
        const cfg = await apiFetchProjectConfig(name);
        return [
          name,
          {
            domain: (cfg?.domain as Domain) ?? 'service',
            projectType: (cfg?.projectType === 'universal' ? 'universal' : 'canonical') as ProjectType,
          },
        ] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      const resolved: Record<string, { domain: Domain; projectType: ProjectType }> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') resolved[r.value[0]] = r.value[1];
      }
      if (Object.keys(resolved).length > 0) {
        setProjectMetaByName((prev) => ({ ...prev, ...resolved }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projects, projectMetaByName]);

  // Warm-keep: mirror the active project's live domain/type into the cache so
  // the icon stays correct after the project is deselected / becomes non-active.
  useEffect(() => {
    if (!selectedProject || !activeDomain) return;
    setProjectMetaByName((prev) => {
      const cur = prev[selectedProject];
      if (cur && cur.domain === activeDomain && cur.projectType === activeProjectType) return prev;
      return { ...prev, [selectedProject]: { domain: activeDomain, projectType: activeProjectType } };
    });
  }, [selectedProject, activeDomain, activeProjectType]);

  const handleSubmitNewProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      await handleCreateProject(name, inlineCreateType ?? 'canonical');
      await fetchProjects();
      setSelectedProject(name);
      setNewProjectName('');
      setInlineCreateType(null);
    } catch (err) {
      console.error('Failed to create project:', err);
      showError(t('workspace.createFailed'));
    }
  }, [newProjectName, inlineCreateType, fetchProjects, setSelectedProject, showError, t]);

  return (
    <div>
      <SectionShell
        eyebrow={t('workspace.title')}
        accent="violet"
        action={
          <>
            {selectedProject && (
              <button
                type="button"
                onClick={handleConfigClick}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.color = 'var(--violet-600)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-3)';
                }}
                aria-label="Project settings"
                title="프로젝트 설정"
                style={{
                  height: 22,
                  width: 22,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  color: 'var(--text-3)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all var(--dur-fast)',
                }}
              >
                <Settings size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenWizard}
              disabled={!policy.canChangeProject}
              onMouseEnter={(e) => {
                if (!policy.canChangeProject) return;
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--violet-600)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-3)';
              }}
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
                color: 'var(--text-3)',
                background: 'transparent',
                border: 'none',
                cursor: policy.canChangeProject ? 'pointer' : 'not-allowed',
                opacity: policy.canChangeProject ? 1 : 0.5,
                transition: 'all var(--dur-fast)',
              }}
            >
              <Plus size={12} />
            </button>
          </>
        }
      >
        {projects.length === 0 ? (
          <div
            style={{
              padding: '14px 8px',
              fontSize: 11,
              fontStyle: 'italic',
              color: 'var(--text-3)',
              textAlign: 'center',
            }}
          >
            {t('workspace.placeholder')}
          </div>
        ) : (
          <>
            <RowList ariaLabel={t('workspace.title')}>
              {orderedProjects.map((name) => {
                const isActive = name === selectedProject;
                // Active row: live mirrors (reflect a settings change quickly).
                // Non-active rows: bulk-resolved cache. Default service/canonical.
                const domain: Domain = isActive
                  ? (activeDomain || 'service')
                  : (projectMetaByName[name]?.domain || 'service');
                const projectType: ProjectType = isActive
                  ? activeProjectType
                  : (projectMetaByName[name]?.projectType || 'canonical');
                return (
                  <ProjectRow
                    key={name}
                    name={name}
                    isActive={isActive}
                    accent={projectAccents[name] || 'violet'}
                    domain={domain}
                    projectType={projectType}
                    disabled={!policy.canChangeProject && !isActive}
                    disabledReason={policy.disabledReason || undefined}
                    onSwitch={() => handleSwitchProject(name)}
                    onClear={isActive ? handleClearProject : undefined}
                  />
                );
              })}
            </RowList>
            {/* Universal projects have no git anchor — the toolbar is dead UI there. */}
            {selectedProject && activeProjectType !== 'universal' && <GitToolbar />}
            {selectedProject && projectConfigMissing && (
              <div
                style={{
                  margin: '0 10px 8px',
                  padding: 7,
                  borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--orange-500) 22%, transparent)',
                  background: 'color-mix(in srgb, var(--orange-500) 8%, transparent)',
                  color: 'var(--orange-600)',
                  fontSize: 11,
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                  lineHeight: 1.4,
                }}
              >
                <span aria-hidden>⚠️</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {t('config:git.configRequired')}
                </span>
              </div>
            )}
          </>
        )}

        {inlineCreateType && (
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
                  setInlineCreateType(null);
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
                color: 'var(--text-on-brand)',
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
                setInlineCreateType(null);
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

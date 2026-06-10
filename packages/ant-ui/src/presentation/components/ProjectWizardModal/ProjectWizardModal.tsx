import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { useStore } from '@/domain/store';
import { selectServerMode, selectUserOrgKind } from '@/domain/store/selectors/auth';
import { useGitSnapshot, useGitPat, useGitPatDispatch, useGitDispatch } from '@/domain/git-world';
import {
  createProject, createFeature, createProjectConfig, updateProjectConfig,
  deleteProject, uploadFiles, type UploadFileEntry,
  checkCloneStatus,
  addChatUserMessage, fetchProjectConfig,
  fetchOrgConfig, fetchUserConfig,
} from '@/infrastructure/http/api';
import { ApiError } from '@/infrastructure/http/api/client';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { cn } from '@/shared/utils/design-system';

import type { WizardStep, ExecStepId, ExecStepStatus, ExecStepState } from './types';
import { designDirOf } from '@ant/shared';
import { isCanonicalDesignDoc, isValidName, sanitizeRepoName, delay, generateProjectName, generateFeatureName } from './constants';
import {
  WizardStepIndicator,
  type WizardStep as AuroraWizardStep,
} from '@/presentation/components/aurora';
import { StepProjectSetup } from './StepProjectSetup';
import { StepGitIntegration } from './StepGitIntegration';
import { StepFilesAndStart } from './StepFilesAndStart';

import { ExecutionProgress } from './ExecutionProgress';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useGitErrorRouting } from '@/application/hooks/git/useGitErrorRouting';

interface ProjectWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode: 'design' | 'code';
  existingProjectId?: string;
}

export function ProjectWizardModal({ isOpen, onClose, initialMode, existingProjectId }: ProjectWizardModalProps) {
  const { t } = useTranslation('onboarding');
  const { showConfirm } = useAlertModalContext();
  const handleGitError = useGitErrorRouting();

  // ── Wizard navigation ──
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [maxVisited, setMaxVisited] = useState<WizardStep>(1);
  const [isExecuting, setIsExecuting] = useState(false);

  // ── Step 1 ──
  const [mode, setMode] = useState<'design' | 'code'>(initialMode);
  const [projectName, setProjectName] = useState(() =>
    existingProjectId ?? generateProjectName(useStore.getState().projects),
  );
  const [featureName, setFeatureName] = useState(() =>
    generateFeatureName(useStore.getState().features.map((f) => f.name)),
  );

  // ── Step 2 ──
  const [gitEnabled, setGitEnabled] = useState(true);
  const [repositoryName, setRepositoryName] = useState('');
  const [repoNameManuallyEdited, setRepoNameManuallyEdited] = useState(false);
  const [gitUrl, setGitUrl] = useState('');
  const [gitUrlFromConfig, setGitUrlFromConfig] = useState(false);
  const [gitUrlManuallyEdited, setGitUrlManuallyEdited] = useState(false);
  const [gitAction, setGitAction] = useState<'none' | 'clone' | 'init'>('none');
  // PAT state is the git-world slice — `patStatus` is a derived value from
  // `worldPat`, not a mirror. Only the input buffer and save-in-flight flag
  // are local.
  const [patInput, setPatInput] = useState('');
  const [patSaving, setPatSaving] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);
  const [showPatInput, setShowPatInput] = useState(false);
  const [ownerInfo, setOwnerInfo] = useState<{ orgOwner?: string; personalOwner?: string }>({});

  // ── Step 3 ──
  const [sourcesFiles, setSourcesFiles] = useState<File[]>([]);
  const [assetsFiles, setAssetsFiles] = useState<File[]>([]);
  const [designDocsFiles, setDesignDocsFiles] = useState<File[]>([]);
  const [directive, setDirective] = useState('');
  const [showDirective, setShowDirective] = useState(false);

  // ── Execution ──
  const [execSteps, setExecSteps] = useState<ExecStepState[]>([]);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const gitDecisionRef = useRef<{ resolve: (v: 'skip' | 'retry' | 'abort') => void } | null>(null);
  const [gitDecisionPending, setGitDecisionPending] = useState(false);

  // ── Store ──
  const projects = useStore((s) => s.projects);
  const features = useStore((s) => s.features);
  const isIndividual = useStore((s) => selectUserOrgKind(s)) === 'individual';
  const snapshot = useGitSnapshot();
  // PAT state flows through the git-world hook — no direct slice peeking.
  // The slice is primed on open via `fetchGitPat` in the effect below.
  const worldPat = useGitPat();
  const patStatus: { configured: boolean; username?: string } | null =
    worldPat ? { configured: worldPat.configured, username: worldPat.username } : null;
  const { fetchGitPat, savePat: savePatToWorld } = useGitPatDispatch();
  const { runGitOperation } = useGitDispatch();
  const setSelectedProject = useStore((s) => s.setSelectedProject);
  const setSelectedFeature = useStore((s) => s.setSelectedFeature);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const setSelectedJobType = useStore((s) => s.setSelectedJobType);
  const setRunning = useStore((s) => s.setRunning);
  const setCurrentJob = useStore((s) => s.setCurrentJob);
  const fetchProjects = useStore((s) => s.fetchProjects);
  const setProjectSetupConfig = useStore((s) => s.setProjectSetupConfig);
  const serverMode = useStore((s) => selectServerMode(s));
  const language = useStore((s) => s.language);

  const projectNameExists = !existingProjectId && !!projectName.trim() && projects.includes(projectName.trim());
  const featureNameExists = !!existingProjectId && !!featureName.trim() && features.some((f) => f.name === featureName.trim());
  const projectNameInvalid = !existingProjectId && !!projectName.trim() && !isValidName(projectName.trim());
  const featureNameInvalid = !!featureName.trim() && !isValidName(featureName.trim());

  // ── Effects ──

  useEffect(() => {
    if (!repoNameManuallyEdited && projectName) {
      setRepositoryName(sanitizeRepoName(projectName));
    }
  }, [projectName, repoNameManuallyEdited]);

  useEffect(() => {
    if (gitUrlFromConfig || gitUrlManuallyEdited) return;
    if (!repositoryName) return;
    setGitUrl((prev) => {
      if (prev) {
        const match = prev.match(/^(https:\/\/github\.com\/[^/]+\/)([^/]*)$/);
        if (match) return `${match[1]}${sanitizeRepoName(repositoryName)}`;
      }
      const owner = ownerInfo.orgOwner || ownerInfo.personalOwner;
      if (owner) return `https://github.com/${owner}/${sanitizeRepoName(repositoryName)}`;
      return prev;
    });
  }, [repositoryName, ownerInfo, gitUrlFromConfig, gitUrlManuallyEdited]);

  // Prime the PAT slice + org/user config on open. `worldPat` updates
  // flow through the next effect so the derived URL stays in sync even
  // if the PAT arrives after this effect's microtask completes.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      await fetchGitPat();
      const [orgCfg, userCfg] = await Promise.all([
        fetchOrgConfig().catch(() => ({} as any)),
        fetchUserConfig().catch(() => ({} as any)),
      ]);
      if (cancelled) return;
      // Individual accounts have no org owner — only the personal owner is
      // selectable, so leave `orgOwner` undefined (hides the Organization pill).
      const orgOwner = isIndividual
        ? undefined
        : (userCfg?.github?.ownerOverride || orgCfg?.github?.owner);
      setOwnerInfo((prev) => ({ orgOwner, personalOwner: prev.personalOwner }));
    })();
    return () => { cancelled = true; };
  }, [isOpen, fetchGitPat]);

  // Sync personalOwner + default git URL whenever the git-world PAT state
  // changes (initial prime, handleSavePat success, DELETE, external SSE).
  useEffect(() => {
    if (!isOpen || !worldPat) return;
    setOwnerInfo((prev) => ({ ...prev, personalOwner: worldPat.username }));
    if (worldPat.configured && !gitUrlFromConfig) {
      const defaultOwner = ownerInfo.orgOwner || worldPat.username;
      if (defaultOwner) {
        setGitUrl((prev) => {
          if (prev) return prev;
          const repo = repositoryName || sanitizeRepoName(projectName) || '';
          if (!repo) return prev;
          return `https://github.com/${defaultOwner}/${repo}`;
        });
      }
    }
    // ownerInfo.orgOwner/repositoryName/projectName are intentionally
    // omitted — we want this effect to fire on PAT changes only; the
    // separate effect above re-runs this block when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, worldPat, gitUrlFromConfig]);

  useEffect(() => {
    if (!existingProjectId || !isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const config = await fetchProjectConfig(existingProjectId);
        if (!cancelled && config?.githubRepo && !gitUrl) {
          setGitUrl(config.githubRepo);
          setGitUrlFromConfig(true);
          setGitEnabled(true);
          if (config.repositoryName) {
            setRepositoryName(config.repositoryName);
            setRepoNameManuallyEdited(true);
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [existingProjectId, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gitUrl.trim() && patStatus?.configured && gitAction === 'none') {
      setGitAction('clone');
    }
    if (!gitUrl.trim()) setGitAction('none');
  }, [gitUrl, patStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──

  const gitReadOnly = !!existingProjectId && gitUrlFromConfig;

  const hasModeDepData = sourcesFiles.length + assetsFiles.length + designDocsFiles.length > 0 || directive.trim().length > 0;

  const hasDirective = showDirective && directive.trim().length > 0;
  const hasDesignInputs = sourcesFiles.length > 0;
  const hasCodeInputs = designDocsFiles.filter((f) => isCanonicalDesignDoc(f.name)).length > 0;
  const canSubmit = mode === 'design'
    ? (hasDirective || hasDesignInputs)
    : (hasDirective || hasCodeInputs);

  const canGoNext: Record<WizardStep, boolean> = {
    1: featureName.trim().length >= 3 && isValidName(featureName.trim())
      && (!!existingProjectId || (projectName.trim().length >= 3 && isValidName(projectName.trim())))
      && !projectNameExists && !featureNameExists,
    2: true,
    3: true,
  };

  const activeOwner = ownerInfo.orgOwner && gitUrl.includes(`github.com/${ownerInfo.orgOwner}/`)
    ? 'org' as const
    : ownerInfo.personalOwner && gitUrl.includes(`github.com/${ownerInfo.personalOwner}/`)
      ? 'personal' as const
      : null;

  // ── Handlers ──

  const updateExecStep = (id: ExecStepId, status: ExecStepStatus, error?: string) => {
    setExecSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status, error } : s)));
  };

  const handleModeChange = (newMode: 'design' | 'code') => {
    if (newMode === mode) return;
    const apply = () => {
      setSourcesFiles([]); setAssetsFiles([]);
      setDesignDocsFiles([]); setDirective(''); setShowDirective(false);
      setMode(newMode);
      setCurrentStep(1);
    };
    if (hasModeDepData) {
      showConfirm(t('quickstart.projectWizard.modeChangeConfirm'), { onConfirm: apply });
    } else {
      setMode(newMode);
      setCurrentStep(1);
    }
  };

  const goToStep = (step: WizardStep) => {
    setCurrentStep(step);
    if (step > maxVisited) setMaxVisited(step);
  };

  const handleNext = () => {
    if (currentStep < 3) goToStep((currentStep + 1) as WizardStep);
  };

  const handleSavePat = async () => {
    if (!patInput.trim()) return;
    setPatSaving(true);
    setPatError(null);
    const result = await savePatToWorld(patInput.trim());
    setPatSaving(false);
    if (result.success) {
      setPatInput(''); setShowPatInput(false);
      // `patStatus` / `ownerInfo.personalOwner` are driven by `worldPat`
      // via the sync effect above — no manual mirror write needed.
    } else {
      setPatError(result.error || 'Unknown error');
    }
  };

  const applyOwner = (owner: string) => {
    const repo = repositoryName || sanitizeRepoName(projectName) || 'my-project';
    setGitUrl(`https://github.com/${owner}/${repo}`);
    setGitUrlFromConfig(false);
  };

  const handleClose = () => {
    if (isExecuting) return;
    setProjectSetupConfig(undefined);
    onClose();
  };

  const handleBackdropClick = () => {
    if (isExecuting) return;
    showConfirm(t('quickstart.projectWizard.closeConfirm'), {
      type: 'warning',
      confirmText: t('common:button.confirm'),
      cancelText: t('common:button.cancel'),
      onConfirm: handleClose,
    });
  };

  // ── Submit / Execute ──

  const handleSubmit = useCallback(async (startJob: boolean = true) => {
    if (isExecuting) return;
    setIsExecuting(true);
    setExecutionError(null);

    const needsProject = !existingProjectId;
    const hasGitAction = !gitReadOnly && gitEnabled && gitAction !== 'none' && gitUrl.trim().length > 0 && patStatus?.configured;
    const uploadableDesignDocs = designDocsFiles.filter((f) => isCanonicalDesignDoc(f.name));
    const hasFiles = sourcesFiles.length + assetsFiles.length + (mode === 'code' ? uploadableDesignDocs.length : 0) > 0;

    const userDirective = directive.trim();
    const effectiveDirective = startJob
      ? (userDirective || (mode === 'design'
        ? t('quickstart.projectWizard.defaultDirectiveDesign')
        : t('quickstart.projectWizard.defaultDirectiveCode')))
      : '';
    const shouldStartJob = startJob && effectiveDirective;

    const steps: ExecStepState[] = [];
    if (needsProject) steps.push({ id: 'project', status: 'pending' });
    if (needsProject) steps.push({ id: 'config', status: 'pending' });
    if (hasGitAction) steps.push({ id: gitAction === 'clone' ? 'gitClone' : 'gitInit', status: 'pending' });
    steps.push({ id: 'feature', status: 'pending' });
    if (hasFiles) steps.push({ id: 'upload', status: 'pending' });
    if (shouldStartJob) steps.push({ id: 'job', status: 'pending' });
    setExecSteps(steps);

    let projectId = existingProjectId || projectName.trim();
    try {

      if (needsProject) {
        updateExecStep('project', 'active');
        try {
          await createProject(projectId);
        } catch (createErr) {
          // Server returns 409 + canForceCleanup when stale state survives a
          // failed delete. Surface a confirm dialog so the user can opt-in
          // to a force-recreate (which deletes the leftover project first).
          if (
            createErr instanceof ApiError &&
            createErr.status === 409 &&
            createErr.canForceCleanup
          ) {
            const confirmed = await new Promise<boolean>((resolve) => {
              showConfirm(
                t('quickstart.projectWizard.forceCleanupMessage', { projectName: projectId }),
                {
                  type: 'warning',
                  title: t('quickstart.projectWizard.forceCleanupTitle'),
                  confirmText: t('quickstart.projectWizard.forceCleanupConfirm'),
                  cancelText: t('quickstart.projectWizard.forceCleanupCancel'),
                  onConfirm: () => resolve(true),
                  onCancel: () => resolve(false),
                },
              );
            });
            if (!confirmed) {
              throw createErr;
            }
            await createProject(projectId, { force: true });
          } else {
            throw createErr;
          }
        }
        await delay(500);
        updateExecStep('project', 'done');
      }

      if (needsProject) {
        updateExecStep('config', 'active');
        // createProject already generates a full config.json on the server
        // (including llmModels, githubRepo default, etc.).
        // Fetch the server-created config and merge wizard overrides on top.
        let serverConfig = await fetchProjectConfig(projectId);
        if (!serverConfig) {
          serverConfig = await createProjectConfig(projectId);
        }
        const updates: Record<string, any> = {};
        if (repositoryName) updates.repositoryName = repositoryName;
        if (gitUrl.trim()) updates.githubRepo = gitUrl.trim();
        if (Object.keys(updates).length > 0) {
          await updateProjectConfig(projectId, { ...serverConfig, ...updates });
        }
        await delay(300);
        updateExecStep('config', 'done');
      }

      if (hasGitAction) {
        const gitStepId: ExecStepId = gitAction === 'clone' ? 'gitClone' : 'gitInit';
        let gitDone = false;
        while (!gitDone) {
          try {
            updateExecStep(gitStepId, 'active');
            if (gitAction === 'clone') {
              const cloneResult = await runGitOperation(projectId, { kind: 'clone' });
              if (!cloneResult.success) {
                // Auth failures route to the PAT dialog (Account Config tab)
                // and abort the wizard — the skip/retry/abort decision UI
                // would offer the wrong recovery path here.
                if (handleGitError(cloneResult.error).handled) {
                  updateExecStep(gitStepId, 'error', cloneResult.error?.message || 'PAT not configured');
                  throw new Error(cloneResult.error?.message || 'PAT not configured');
                }
                throw new Error(cloneResult.error?.message || 'Git clone failed');
              }
              // Back-compat: some server builds still complete clone
              // asynchronously after returning success. Poll briefly to
              // confirm the working tree materialized before proceeding.
              let cloned = false;
              for (let i = 0; i < 60; i++) {
                await delay(2000);
                const status = await checkCloneStatus(projectId);
                if (status.error) throw new Error(status.error);
                if (status.cloned) { cloned = true; break; }
              }
              if (!cloned) throw new Error('Git clone timed out');
            } else {
              const initResult = await runGitOperation(projectId, { kind: 'publish' });
              if (!initResult.success) {
                if (handleGitError(initResult.error).handled) {
                  updateExecStep(gitStepId, 'error', initResult.error?.message || 'PAT not configured');
                  throw new Error(initResult.error?.message || 'PAT not configured');
                }
                throw new Error(initResult.error?.message || 'Git init failed');
              }
            }
            updateExecStep(gitStepId, 'done');
            gitDone = true;
          } catch (gitErr) {
            const msg = gitErr instanceof Error ? gitErr.message : 'Git operation failed';
            updateExecStep(gitStepId, 'error', msg);
            setGitDecisionPending(true);
            const decision = await new Promise<'skip' | 'retry' | 'abort'>((resolve) => {
              gitDecisionRef.current = { resolve };
            });
            setGitDecisionPending(false);
            gitDecisionRef.current = null;
            if (decision === 'abort') throw gitErr;
            if (decision === 'skip') { updateExecStep(gitStepId, 'done'); gitDone = true; }
          }
        }
      }

      updateExecStep('feature', 'active');
      const hasSources = sourcesFiles.length > 0;
      await createFeature(projectId, featureName.trim(), language, hasSources ? { skipPrdTemplate: true } : undefined);
      useStore.getState().addFeatureOptimistic(featureName.trim());
      await delay(500);
      updateExecStep('feature', 'done');

      if (hasFiles) {
        updateExecStep('upload', 'active');
        const feat = featureName.trim();
        const batch = async (files: File[], dir: string) => {
          if (files.length === 0) return;
          const entries: UploadFileEntry[] = files.map((f) => ({ file: f, relativePath: f.name }));
          await uploadFiles(projectId, feat, dir, entries);
        };
        await batch(sourcesFiles, 'plan');
        await batch(assetsFiles, 'assets');
        if (mode === 'code' && uploadableDesignDocs.length > 0) {
          const byDesignDir = new Map<string, File[]>();
          for (const f of uploadableDesignDocs) {
            const dir = designDirOf(f.name);
            const list = byDesignDir.get(dir) ?? [];
            list.push(f);
            byDesignDir.set(dir, list);
          }
          for (const [dir, files] of byDesignDir) {
            await batch(files, dir);
          }
        }
        updateExecStep('upload', 'done');
      }

      if (useStore.getState().selectedProject !== projectId) setSelectedProject(projectId);
      await delay(150);
      setSelectedFeature(featureName.trim());
      await delay(200);

      if (shouldStartJob) {
        updateExecStep('job', 'active');
        const jobType = mode === 'design' ? 'design' : 'code';
        setSelectedAgent('architect');
        setSelectedJobType(jobType);
        await addChatUserMessage(projectId, featureName.trim(), effectiveDirective);
        setRunning(true, undefined, 'generate');
        const jobExec = executeCodeJob({
          projectId, featureName: featureName.trim(), jobType, agent: 'architect',
          overrideDirective: effectiveDirective, chatSource: true,
        });
        setCurrentJob(jobExec);
        jobExec.onJobIdReady((jobId) => setRunning(true, jobId));
        jobExec.on('exit', (code) => {
          useStore.getState().setLastJobFailed(code !== 0 && code !== null);
          setRunning(false);
          setCurrentJob(null);
        });
        await delay(800);
        updateExecStep('job', 'done');
      }

      await useStore.getState().fetchFeatures(projectId);
      await fetchProjects();
      setProjectSetupConfig(undefined);
    } catch (err) {
      console.error('[ProjectWizardModal] Error:', err);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setExecutionError(msg);
      setExecSteps((prev) => prev.map((s) => s.status === 'active' ? { ...s, status: 'error', error: msg } : s));

      // Rollback: delete the newly created project if execution failed mid-way
      if (needsProject && projectId) {
        try {
          console.log(`[ProjectWizardModal] Rolling back project: ${projectId}`);
          await deleteProject(projectId);
          await fetchProjects();
        } catch (rollbackErr) {
          console.error('[ProjectWizardModal] Rollback failed:', rollbackErr);
        }
      }

      setIsExecuting(false);
    }
  }, [
    isExecuting, existingProjectId, projectName, repositoryName, gitUrl, gitAction, patStatus,
    featureName, directive, showDirective, sourcesFiles, assetsFiles,
    designDocsFiles, mode, serverMode, language, gitEnabled, gitReadOnly, t,
    setSelectedProject, setSelectedFeature, setSelectedAgent, setSelectedJobType,
    setRunning, setCurrentJob, fetchProjects, setProjectSetupConfig, runGitOperation,
  ]);

  // ── Render ──

  // Project the wizard's 1/2/3 numeric steps into the shared aurora
  // WizardStepIndicator's WizardStep[] contract. `hasValue` encodes the
  // emerald-checkmark / violet-current state expected by the primitive.
  const auroraSteps: AuroraWizardStep[] = ([1, 2, 3] as const).map((step) => ({
    id: String(step),
    label: t(`quickstart.projectWizard.step${step}Title`),
    hasValue: step < currentStep || (step === currentStep && canGoNext[step]),
  }));

  return (
    <Modal isOpen={isOpen} onClose={handleClose} onBackdropClick={handleBackdropClick} title={`${t('quickstart.projectWizard.title')} — ${mode === 'design' ? t('quickstart.projectWizard.modeDesign') : t('quickstart.projectWizard.modeCode')}`} size="xl">
      {isExecuting ? (
        <ExecutionProgress
          t={t}
          mode={mode}
          execSteps={execSteps}
          executionError={executionError}
          gitDecisionPending={gitDecisionPending}
          onGitDecision={(d) => gitDecisionRef.current?.resolve(d)}
          onRetry={() => { setIsExecuting(false); setExecutionError(null); setExecSteps([]); }}
        />
      ) : (
        <div className="flex flex-col" style={{ height: '70vh' }}>
          <div className="flex-1 overflow-y-auto pr-1 space-y-5 pb-4">
            {currentStep === 1 && (
              <StepProjectSetup
                t={t}
                mode={mode}
                onModeChange={handleModeChange}
                existingProjectId={existingProjectId}
                projectName={projectName}
                onProjectNameChange={setProjectName}
                featureName={featureName}
                onFeatureNameChange={setFeatureName}
                projectNameExists={projectNameExists}
                featureNameExists={featureNameExists}
                projectNameInvalid={projectNameInvalid}
                featureNameInvalid={featureNameInvalid}
              />
            )}
            {currentStep === 2 && (
              <StepGitIntegration
                t={t}
                gitEnabled={gitEnabled}
                onGitEnabledChange={setGitEnabled}
                readOnly={gitReadOnly}
                gitSnapshot={snapshot}
                patStatus={patStatus}
                showPatInput={showPatInput}
                onShowPatInput={() => setShowPatInput(true)}
                patInput={patInput}
                onPatInputChange={setPatInput}
                patSaving={patSaving}
                patError={patError}
                onSavePat={handleSavePat}
                repositoryName={repositoryName}
                onRepositoryNameChange={setRepositoryName}
                onRepoManualEdit={() => { setRepoNameManuallyEdited(true); setGitUrlFromConfig(false); }}
                gitUrl={gitUrl}
                onGitUrlChange={(v) => { setGitUrl(v); setGitUrlFromConfig(false); setGitUrlManuallyEdited(true); }}
                gitUrlFromConfig={gitUrlFromConfig}
                ownerInfo={ownerInfo}
                activeOwner={activeOwner}
                onApplyOwner={applyOwner}
                gitAction={gitAction}
                onGitActionChange={setGitAction}
              />
            )}
            {currentStep === 3 && (
              <StepFilesAndStart
                t={t}
                mode={mode}
                sourcesFiles={sourcesFiles}
                onSourcesChange={setSourcesFiles}
                assetsFiles={assetsFiles}
                onAssetsChange={setAssetsFiles}
                designDocsFiles={designDocsFiles}
                onDesignDocsChange={setDesignDocsFiles}
                directive={directive}
                onDirectiveChange={setDirective}
                showDirective={showDirective}
                onShowDirectiveToggle={() => {
                  setDirective('');
                  setShowDirective(!showDirective);
                }}
                canSubmit={canSubmit}
              />
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between pt-4"
            style={{
              borderTop: '1px solid var(--border-1)',
              background: 'oklch(from var(--bg-surface-2) l c h / 0.6)',
            }}
          >
            <WizardStepIndicator
              steps={auroraSteps}
              currentIndex={currentStep - 1}
              onStepClick={(idx) => {
                const target = (idx + 1) as WizardStep;
                if (target <= maxVisited) goToStep(target);
              }}
              size="sm"
            />
            <div className="flex items-center gap-2">
              {currentStep < 3 ? (
                <NextButton
                  disabled={!canGoNext[currentStep]}
                  onClick={handleNext}
                  label={t('quickstart.projectWizard.nextStep')}
                />
              ) : (
                <div className="flex items-center gap-2 sm:gap-3">
                  <CreateOnlyButton
                    onClick={() => handleSubmit(false)}
                    label={t('quickstart.projectWizard.createOnly')}
                  />
                  <SubmitButton
                    disabled={!canSubmit}
                    onClick={() => handleSubmit(true)}
                    label={t('quickstart.projectWizard.submit')}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Footer button primitives (Aurora-skinned) ─────────────────────────

function NextButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      className={cn(
        'px-3 sm:px-5 py-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-all',
        'disabled:opacity-50 disabled:cursor-not-allowed',
      )}
      style={{
        background: disabled
          ? 'var(--bg-surface-2)'
          : 'var(--gradient-aurora)',
        backgroundSize: '180% 180%',
        backgroundPosition: hover && !disabled ? '100% 50%' : '0% 50%',
        color: disabled ? 'var(--text-3)' : 'white',
        border: 'none',
        borderRadius: 'var(--r-lg, 10px)',
        boxShadow: disabled
          ? 'none'
          : '0 4px 14px -4px oklch(60% 0.20 290 / 0.3)',
        transform: disabled
          ? 'none'
          : press
            ? 'scale(0.97)'
            : hover
              ? 'translateY(-1px)'
              : 'none',
      }}
    >
      {label}
    </button>
  );
}

function CreateOnlyButton({ onClick, label }: { onClick: () => void; label: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="px-3 sm:px-5 py-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-all"
      style={{
        background: hover ? 'var(--bg-hover)' : 'var(--bg-surface)',
        border: '1.5px solid var(--border-2)',
        color: 'var(--text-2)',
        borderRadius: 'var(--r-lg, 10px)',
      }}
    >
      {label}
    </button>
  );
}

function SubmitButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      className="relative inline-flex items-center gap-2 px-3 sm:px-5 py-2 text-xs sm:text-sm font-semibold whitespace-nowrap overflow-hidden transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: disabled
          ? 'var(--bg-surface-2)'
          : 'var(--gradient-aurora)',
        backgroundSize: '180% 180%',
        backgroundPosition: hover && !disabled ? '100% 50%' : '0% 50%',
        color: disabled ? 'var(--text-3)' : 'white',
        border: 'none',
        borderRadius: 'var(--r-lg, 10px)',
        boxShadow: disabled ? 'none' : 'var(--shadow-glow-aurora)',
        transform: disabled
          ? 'none'
          : press
            ? 'scale(0.97)'
            : hover
              ? 'translateY(-1px) scale(1.02)'
              : 'none',
      }}
    >
      {/* Sparkle shine sweep on hover */}
      {!disabled && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(120deg, transparent 30%, oklch(100% 0 0 / 0.25) 50%, transparent 70%)',
            transform: hover ? 'translateX(120%)' : 'translateX(-120%)',
            transition: 'transform 0.7s var(--ease-smooth)',
            pointerEvents: 'none',
          }}
        />
      )}
      <span className="relative">{label}</span>
    </button>
  );
}

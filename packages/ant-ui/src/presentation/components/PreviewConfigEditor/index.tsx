import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  getPreviewConfig,
  updatePreviewConfig,
  startPreview,
  stopPreview,
  getPreviewStatus,
  PREVIEW_BASE,
  type LinkedBackendConfig,
  type PreviewConfig,
  type PreviewStatus,
} from '@/infrastructure/http/api';
import {
  Monitor,
  Play,
  Square,
  RotateCw,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Loader2,
  Link2,
  Globe,
  FolderOpen,
  Save,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

/**
 * PreviewConfigEditor
 * 
 * Main panel tab for configuring preview server settings:
 * - Project Info: detected structureType
 * - Backend Connection: direct URL or Ant project linking
 * - Preview Controls: start/stop/restart + running status
 * - Status Console: issues, warnings, and logs
 */
export function PreviewConfigEditor() {
  const { t } = useTranslation('explorer');
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const projects = useStore((s) => s.projects);

  // Local state
  const [config, setConfig] = useState<PreviewConfig | null>(null);
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [isPreviewLoading, setPreviewLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);

  // LinkedBackend form state
  const [backendType, setBackendType] = useState<'url' | 'project'>('url');
  const [backendUrl, setBackendUrl] = useState('');
  const [backendProjectId, setBackendProjectId] = useState('');
  const [backendFeature, setBackendFeature] = useState('main');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load config and status
  const loadData = useCallback(async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const [configData, statusData] = await Promise.all([
        getPreviewConfig(selectedProject, selectedFeature || 'main'),
        getPreviewStatus(selectedProject, selectedFeature || 'main'),
      ]);
      setConfig(configData);
      setStatus(statusData);

      // Populate form from config
      if (configData.linkedBackend) {
        setBackendType(configData.linkedBackend.type);
        setBackendUrl(configData.linkedBackend.url || '');
        setBackendProjectId(configData.linkedBackend.projectId || '');
        setBackendFeature(configData.linkedBackend.feature || 'main');
      } else {
        setBackendType('url');
        setBackendUrl('');
        setBackendProjectId('');
        setBackendFeature('main');
      }
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('[PreviewConfig] Failed to load:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject, selectedFeature]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Polling for status updates when preview is running/starting
  useEffect(() => {
    if (!selectedProject || !status?.running) return;
    const interval = setInterval(async () => {
      try {
        const newStatus = await getPreviewStatus(selectedProject, selectedFeature || 'main');
        setStatus(newStatus);
      } catch {
        // ignore polling errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedProject, selectedFeature, status?.running]);

  // Save config
  const handleSave = async () => {
    if (!selectedProject) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const linkedBackend: LinkedBackendConfig | null = backendType === 'url'
        ? backendUrl.trim() ? { type: 'url', url: backendUrl.trim() } : null
        : backendProjectId.trim() ? { type: 'project', projectId: backendProjectId.trim(), feature: backendFeature || 'main' } : null;

      await updatePreviewConfig(selectedProject, selectedFeature || 'main', { linkedBackend });
      setHasUnsavedChanges(false);
      setSaveMessage('Saved');
      setTimeout(() => setSaveMessage(null), 2000);
      // Refresh
      loadData();
    } catch (error: any) {
      setSaveMessage(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Preview controls
  const handleStart = async () => {
    if (!selectedProject) return;
    setPreviewLoading(true);
    try {
      await startPreview(selectedProject, selectedFeature || 'main');
      // Poll status until running
      setTimeout(loadData, 1500);
    } catch (error) {
      console.error('[PreviewConfig] Start failed:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleStop = async () => {
    if (!selectedProject) return;
    setPreviewLoading(true);
    try {
      await stopPreview(selectedProject, selectedFeature || 'main');
      setTimeout(loadData, 1000);
    } catch (error) {
      console.error('[PreviewConfig] Stop failed:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRestart = async () => {
    if (!selectedProject) return;
    setPreviewLoading(true);
    try {
      await stopPreview(selectedProject, selectedFeature || 'main');
      await new Promise((r) => setTimeout(r, 1000));
      await startPreview(selectedProject, selectedFeature || 'main');
      setTimeout(loadData, 1500);
    } catch (error) {
      console.error('[PreviewConfig] Restart failed:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleOpenPreview = () => {
    if (status?.url) {
      window.open(`${PREVIEW_BASE()}${status.url}`, '_blank');
    }
  };

  // Mark changes
  const onFormChange = () => {
    setHasUnsavedChanges(true);
  };

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        Select a workspace to configure preview.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const structureType = config?.structureType || status?.structureType || null;
  const phase = status?.phase || 'idle';
  const isRunning = status?.running || false;
  const isReady = status?.ready || false;
  const issues = status?.issues || [];
  const logs = status?.logs || [];
  const fatalIssues = issues.filter((i) => i.severity === 'fatal');
  const warningIssues = issues.filter((i) => i.severity === 'warning');

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('preview.configTitle', 'Preview Config')}
          </h2>
        </div>

        {/* Section 1: Project Info */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t('preview.projectInfo', 'Project Info')}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Structure Type:</span>
            {structureType ? (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200">
                {structureType}
              </span>
            ) : (
              <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                {t('preview.notDetected', 'Not detected (start preview to detect)')}
              </span>
            )}
          </div>
        </section>

        {/* Section 2: Backend Connection */}
        {(structureType === 'frontend-only' || !structureType) && (
          <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {t('preview.backendConnection', 'Backend Connection')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t('preview.backendConnectionDesc', 'Connect this frontend project to a backend API for preview testing.')}
            </p>

            {/* Type selector */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => { setBackendType('url'); onFormChange(); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  backendType === 'url'
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                Direct URL
              </button>
              <button
                onClick={() => { setBackendType('project'); onFormChange(); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  backendType === 'project'
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Ant Project
              </button>
            </div>

            {/* Direct URL input */}
            {backendType === 'url' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Backend URL
                </label>
                <input
                  type="text"
                  value={backendUrl}
                  onChange={(e) => { setBackendUrl(e.target.value); onFormChange(); }}
                  placeholder="http://localhost:8080"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-md 
                           bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                           placeholder-gray-400 dark:placeholder-gray-500
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}

            {/* Ant Project selector */}
            {backendType === 'project' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Project
                  </label>
                  <select
                    value={backendProjectId}
                    onChange={(e) => { setBackendProjectId(e.target.value); onFormChange(); }}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-md 
                             bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select a project...</option>
                    {projects
                      .filter((p) => p !== selectedProject)
                      .map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Feature
                  </label>
                  <input
                    type="text"
                    value={backendFeature}
                    onChange={(e) => { setBackendFeature(e.target.value); onFormChange(); }}
                    placeholder="main"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-md 
                             bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                             placeholder-gray-400 dark:placeholder-gray-500
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Save button */}
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleSave}
                disabled={isSaving || !hasUnsavedChanges}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                         bg-blue-600 text-white hover:bg-blue-700 
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              {saveMessage && (
                <span className={`text-xs ${saveMessage.startsWith('Error') ? 'text-red-500' : 'text-green-500'}`}>
                  {saveMessage}
                </span>
              )}
              {hasUnsavedChanges && (
                <span className="text-xs text-amber-500">Unsaved changes</span>
              )}
            </div>

            {/* Current connection info */}
            {config?.linkedBackend && (
              <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-md">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <Link2 className="w-3 h-3" />
                  <span>
                    Active: {config.linkedBackend.type === 'url'
                      ? config.linkedBackend.url
                      : `${config.linkedBackend.projectId} / ${config.linkedBackend.feature}`}
                  </span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Section 3: Preview Controls */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t('preview.controls', 'Preview Controls')}
          </h3>

          {/* Status badge */}
          <div className="flex items-center gap-2 mb-4">
            {phase === 'running' && isReady ? (
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-green-700 dark:text-green-300">Running</span>
              </div>
            ) : phase === 'running' || phase === 'starting' || phase === 'installing' ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300 capitalize">{phase}</span>
              </div>
            ) : phase === 'error' ? (
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-red-700 dark:text-red-300">Error</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-sm text-gray-500 dark:text-gray-400">Stopped</span>
              </div>
            )}
          </div>

          {/* Control buttons */}
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={isPreviewLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                         bg-green-600 text-white hover:bg-green-700
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
              >
                {isPreviewLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Start
              </button>
            ) : (
              <>
                <button
                  onClick={handleStop}
                  disabled={isPreviewLoading}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                           bg-red-600 text-white hover:bg-red-700
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors"
                >
                  <Square className="w-3.5 h-3.5" />
                  Stop
                </button>
                <button
                  onClick={handleRestart}
                  disabled={isPreviewLoading}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                           bg-gray-600 text-white hover:bg-gray-700
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  Restart
                </button>
              </>
            )}
            {isRunning && isReady && status?.url && (
              <button
                onClick={handleOpenPreview}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                         bg-blue-600 text-white hover:bg-blue-700
                         transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </button>
            )}
          </div>

          {/* Error display */}
          {status?.error && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-700 dark:text-red-300">{status.error}</p>
            </div>
          )}
        </section>

        {/* Section 4: Status Console */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t('preview.statusConsole', 'Status Console')}
          </h3>

          {/* Issues */}
          {fatalIssues.length > 0 && (
            <div className="space-y-2 mb-3">
              {fatalIssues.map((issue, idx) => (
                <div key={idx} className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-red-700 dark:text-red-300">{issue.reason}</p>
                      {issue.suggestedFix && (
                        <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-1">Fix: {issue.suggestedFix}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {warningIssues.length > 0 && (
            <div className="space-y-2 mb-3">
              {warningIssues.map((issue, idx) => (
                <div key={idx} className="p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-yellow-700 dark:text-yellow-300">{issue.reason}</p>
                      {issue.suggestedFix && (
                        <p className="text-xs text-yellow-600/70 dark:text-yellow-400/70 mt-1">Fix: {issue.suggestedFix}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {issues.length === 0 && !isRunning && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('preview.noIssues', 'No issues. Start the preview server to see status.')}
            </p>
          )}

          {issues.length === 0 && isRunning && isReady && (
            <p className="text-xs text-green-500 dark:text-green-400">
              All checks passed.
            </p>
          )}

          {/* Logs (collapsible) */}
          {logs.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setLogsExpanded(!logsExpanded)}
                className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {logsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Logs ({logs.length})
              </button>
              {logsExpanded && (
                <div className="mt-2 max-h-60 overflow-y-auto bg-gray-900 dark:bg-gray-950 rounded-md p-3">
                  {logs.slice(-50).map((log, idx) => (
                    <div
                      key={idx}
                      className={`text-xs font-mono leading-relaxed ${
                        log.type === 'stderr' ? 'text-red-400' : 'text-gray-300'
                      }`}
                    >
                      {log.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  getPreviewConfig,
  updatePreviewConfig,
  detectConnections,
  fetchProjects,
  fetchFeatures,
  PREVIEW_BASE,
  type ServiceConnection,
  type ConnectionResolution,
  type PreviewConfig,
  type Feature,
} from '@/infrastructure/http/api';
import { usePreviewManager } from '../FeatureSection/hooks/usePreviewManager';
import {
  Monitor,
  Play,
  Square,
  RotateCw,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  AlertTriangle,
  Server,
  Database,
  Search,
  Plus,
  Trash2,
  Pencil,
  Package,
  Save,
  X,
  Check,
} from 'lucide-react';

// Status badge color mappings
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  'not-started': 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  unreachable: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
};

/**
 * PreviewConfigEditor
 * 
 * Main panel tab for configuring preview server settings:
 * - Project Profile: detected structureType, language, framework
 * - Service Connections: all detected connections grouped by category
 * - Preview Controls: start/stop/restart + running status
 * - Status Console: issues, warnings, and logs
 */
export function PreviewConfigEditor() {
  const { t } = useTranslation('explorer');
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const setPendingChatInput = useStore((s) => s.setPendingChatInput);

  // Read preview status from shared store (updated via SSE by usePreviewManager)
  const previewStatus = useStore((s) => s.previewStatus);
  const isJobRunning = useStore((s) => s.isRunning);

  // Shared preview lifecycle (single source of truth with FeatureDropdown)
  const {
    startServer,
    stopServer,
    isLoading: isPreviewLoading,
    state: previewState,
  } = usePreviewManager(selectedProject, selectedFeature);

  // Local state
  const [config, setConfig] = useState<PreviewConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [connectionsExpanded, setConnectionsExpanded] = useState(true);

  // Load config
  const loadConfig = useCallback(async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const configData = await getPreviewConfig(selectedProject, selectedFeature || 'main');
      setConfig(configData);
    } catch (error) {
      console.error('[PreviewConfig] Failed to load config:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject, selectedFeature]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleOpenPreview = () => {
    if (previewStatus?.url) {
      window.open(`${PREVIEW_BASE()}${previewStatus.url}`, '_blank');
    }
  };

  /**
   * Chat Actions: send suggested fix or connection change instruction to chat
   */
  const handleApplyToChat = (message: string) => {
    setPendingChatInput({
      message,
      jobType: 'code',
      autoSubmit: false,
    });
  };

  // Derive display values (must be before any conditional returns for hook stability)
  const structureType = previewStatus?.structureType || config?.structureType || null;
  const projectProfile = (previewStatus?.projectProfile || config?.projectProfile)
    ? { ...(config?.projectProfile || {}), ...(previewStatus?.projectProfile || {}) }
    : null;
  const connections: ServiceConnection[] = useMemo(() => {
    const base = config?.connections || [];
    const live = previewStatus?.connections;
    if (!live?.length) return base;
    return base.map(conn => {
      const liveConn = live.find((lc: ServiceConnection) => lc.id === conn.id);
      return liveConn ? { ...conn, status: liveConn.status } : conn;
    });
  }, [config?.connections, previewStatus?.connections]);
  const phase = previewStatus?.phase || 'idle';
  const isRunning = previewState === 'running';
  const isReady = previewStatus?.ready || false;
  const issues = previewStatus?.issues || [];
  const logs = previewStatus?.logs || [];
  const fatalIssues = issues.filter((i) => i.severity === 'fatal');
  const warningIssues = issues.filter((i) => i.severity === 'warning');

  // Dismissed errors/issues (persisted to localStorage)
  const dismissedKey = `ant-ui:dismissed-preview-errors:${selectedProject || ''}:${selectedFeature || 'main'}`;
  const [dismissedSet, setDismissedSet] = useState<Set<string>>(new Set());

  // Sync dismissed state from localStorage when key changes (project/feature switch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(dismissedKey);
      setDismissedSet(stored ? new Set(JSON.parse(stored)) : new Set());
    } catch { setDismissedSet(new Set()); }
  }, [dismissedKey]);

  const dismissError = useCallback((key: string) => {
    setDismissedSet(prev => {
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem(dismissedKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [dismissedKey]);

  const clearDismissed = useCallback(() => {
    setDismissedSet(new Set());
    try { localStorage.removeItem(dismissedKey); } catch {}
  }, [dismissedKey]);

  // Preview controls — delegate to shared usePreviewManager
  const handleStart = useCallback(async () => {
    clearDismissed();
    await startServer();
  }, [startServer, clearDismissed]);

  const handleStop = useCallback(async () => {
    await stopServer();
  }, [stopServer]);

  const handleRestart = useCallback(async () => {
    await stopServer();
    await new Promise((r) => setTimeout(r, 1000));
    await startServer();
  }, [stopServer, startServer]);

  // Local connections state for editing
  const [localConns, setLocalConns] = useState<ServiceConnection[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [addingNew, setAddingNew] = useState(false);

  // Sync server connections to local state (when not editing)
  useEffect(() => {
    if (!hasUnsavedChanges) {
      setLocalConns(connections);
    }
  }, [connections, hasUnsavedChanges]);

  // Group connections by source (package)
  const packageGroups = useMemo(() => {
    const groups = new Map<string, ServiceConnection[]>();
    for (const conn of localConns) {
      const source = conn.source || '*';
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source)!.push(conn);
    }
    // Sort within each group: business first, then infrastructure
    for (const conns of groups.values()) {
      conns.sort((a, b) => {
        if (a.category === b.category) return 0;
        return a.category === 'business' ? -1 : 1;
      });
    }
    return groups;
  }, [localConns]);

  const isSinglePackage = packageGroups.size <= 1;

  // Early returns (AFTER all hooks)
  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        {t('preview.selectWorkspace', 'Select a workspace to configure preview.')}
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

  // Auto Detect handler
  const handleAutoDetect = async () => {
    if (!selectedProject) return;
    setIsDetecting(true);
    try {
      const result = await detectConnections(selectedProject, selectedFeature || 'main');
      if (result.success) {
        setLocalConns(result.connections);
        setConfig(prev => prev
          ? { ...prev, connections: result.connections }
          : { connections: result.connections } as any);
        setHasUnsavedChanges(false);
      }
    } catch (err) {
      console.error('[PreviewConfig] Auto-detect failed:', err);
      setLocalConns([]);
      setConfig(prev => prev ? { ...prev, connections: [] } : { connections: [] } as any);
      setHasUnsavedChanges(false);
    } finally {
      setIsDetecting(false);
    }
  };

  // Save connections
  const handleSaveConnections = async () => {
    if (!selectedProject) return;
    try {
      const result = await updatePreviewConfig(selectedProject, selectedFeature || 'main', { connections: localConns });
      if (result.success && result.connections) {
        setLocalConns(result.connections);
        setConfig(prev => prev
          ? { ...prev, connections: result.connections }
          : { connections: result.connections } as any);
      }
      setHasUnsavedChanges(false);
      setEditingConnId(null);
    } catch (err) {
      console.error('[PreviewConfig] Save failed:', err);
    }
  };

  // Edit a connection locally
  const handleUpdateConn = (id: string, updates: Partial<ServiceConnection>) => {
    setLocalConns(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    setHasUnsavedChanges(true);
  };

  // Delete a connection locally
  const handleDeleteConn = (id: string) => {
    setLocalConns(prev => prev.filter(c => c.id !== id));
    setHasUnsavedChanges(true);
    if (editingConnId === id) setEditingConnId(null);
  };

  // Add a new connection
  const handleAddConn = (conn: ServiceConnection) => {
    setLocalConns(prev => [...prev, conn]);
    setHasUnsavedChanges(true);
    setAddingNew(false);
  };

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

        {/* Section 1: Project Profile */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t('preview.projectProfile', 'Project Profile')}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400 w-28">{t('preview.structureType', 'Structure Type:')}</span>
              {structureType ? (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200">
                  {structureType}
                </span>
              ) : (
                <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                  {t('preview.notDetected', 'Not detected')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400 w-28">{t('preview.language', 'Language:')}</span>
              {projectProfile?.language ? (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200">
                  {projectProfile.language}
                </span>
              ) : (
                <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                  {t('preview.notDetected', 'Not detected')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400 w-28">{t('preview.framework', 'Framework:')}</span>
              {projectProfile?.framework ? (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200">
                  {projectProfile.framework}
                </span>
              ) : (
                <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                  {t('preview.notDetected', 'Not detected')}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Section 2: Service Connections */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => setConnectionsExpanded(!connectionsExpanded)}
              className="flex items-center gap-2 text-left"
            >
              {connectionsExpanded ? <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />}
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('preview.serviceConnections', 'Service Connections')}
              </h3>
              {localConns.length > 0 && (
                <span className="text-xs text-gray-400 dark:text-gray-500">({localConns.length})</span>
              )}
            </button>
            <div className="flex items-center gap-1.5">
              {hasUnsavedChanges && (
                <button
                  onClick={handleSaveConnections}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                           bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300
                           hover:bg-green-200 dark:hover:bg-green-800/50 transition-colors"
                >
                  <Save className="w-3 h-3" />
                  {t('preview.save', 'Save')}
                </button>
              )}
              <button
                onClick={handleAutoDetect}
                disabled={isDetecting}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                         bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400
                         hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors
                         disabled:opacity-50"
                title={t('preview.autoDetectTitle', 'Re-scan project files for connections')}
              >
                {isDetecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                {t('preview.autoDetect', 'Auto Detect')}
              </button>
            </div>
          </div>

          {connectionsExpanded && (
            <div className="mt-3 space-y-4">
              {localConns.length === 0 && !addingNew ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {t('preview.noConnections', 'No connections detected. Click "Auto Detect" to scan .env.example files.')}
                </p>
              ) : (
                <>
                  {/* Render by package groups */}
                  {Array.from(packageGroups.entries()).map(([source, conns]) => (
                    <div key={source}>
                      {/* Package header (hidden for single-package projects) */}
                      {!isSinglePackage && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <Package className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                            {source === '*' ? 'Root' : source}
                          </span>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        {conns.map((conn) => (
                          <ConnectionRow
                            key={`${conn.source}:${conn.id}`}
                            conn={conn}
                            isEditing={editingConnId === conn.id}
                            onEdit={() => setEditingConnId(editingConnId === conn.id ? null : conn.id)}
                            onUpdate={(updates) => handleUpdateConn(conn.id, updates)}
                            onDelete={() => handleDeleteConn(conn.id)}
                            onFix={handleApplyToChat}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Add new connection */}
              {addingNew ? (
                <AddConnectionForm
                  onAdd={handleAddConn}
                  onCancel={() => setAddingNew(false)}
                />
              ) : (
                <button
                  onClick={() => setAddingNew(true)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                           text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {t('preview.addConnection', 'Add Connection')}
                </button>
              )}
            </div>
          )}
        </section>

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
                <span className="text-sm font-medium text-green-700 dark:text-green-300">{t('preview.running')}</span>
              </div>
            ) : phase === 'stopping' ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{t('preview.stopping')}</span>
              </div>
            ) : phase === 'running' || phase === 'starting' || phase === 'installing' ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  {phase === 'starting' ? t('preview.starting')
                    : phase === 'installing' ? t('preview.installing')
                    : phase}
                </span>
              </div>
            ) : phase === 'error' && previewStatus?.error ? (
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-red-700 dark:text-red-300">{t('preview.startFailed')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-sm text-gray-500 dark:text-gray-400">{t('preview.notRunning')}</span>
              </div>
            )}
          </div>

          {/* Control buttons */}
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={isPreviewLoading || isJobRunning || !(previewStatus?.canStart ?? false)}
                title={isJobRunning ? t('preview.jobRunning', 'Cannot start while a task is running') : !(previewStatus?.canStart ?? false) ? t('preview.cannotStart', 'No runnable project detected') : undefined}
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
                {t('preview.start', 'Start')}
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
                  {isPreviewLoading && phase === 'stopping' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                  {isPreviewLoading && phase === 'stopping' ? t('preview.stopping') : t('preview.stop', 'Stop')}
                </button>
                <button
                  onClick={handleRestart}
                  disabled={isPreviewLoading || isJobRunning}
                  title={isJobRunning ? t('preview.jobRunning', 'Cannot start while a task is running') : undefined}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                           bg-gray-600 text-white hover:bg-gray-700
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  {t('preview.restart', 'Restart')}
                </button>
              </>
            )}
            {isRunning && isReady && previewStatus?.url && (
              <button
                onClick={handleOpenPreview}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                         bg-blue-600 text-white hover:bg-blue-700
                         transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {t('preview.openPreview', 'Open')}
              </button>
            )}
          </div>

          {/* Error display */}
          {previewStatus?.error && !dismissedSet.has(`error:${previewStatus.error}`) && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-red-700 dark:text-red-300">{previewStatus.error}</p>
                <button
                  onClick={() => dismissError(`error:${previewStatus.error}`)}
                  className="p-0.5 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors flex-shrink-0"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Section 4: Status Console */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t('preview.statusConsole', 'Status Console')}
          </h3>

          {/* Issues with Fix buttons */}
          {fatalIssues.filter(i => !dismissedSet.has(`issue:${i.reason}`)).length > 0 && (
            <div className="space-y-2 mb-3">
              {fatalIssues.filter(i => !dismissedSet.has(`issue:${i.reason}`)).map((issue, idx) => (
                <div key={idx} className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-red-700 dark:text-red-300">{issue.reason}</p>
                      {issue.suggestedFix && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <button
                            onClick={() => handleApplyToChat(issue.suggestedFix!)}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                                     bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300
                                     hover:bg-red-200 dark:hover:bg-red-800/50 transition-colors"
                          >
                            <MessageSquare className="w-3 h-3" />
                            Fix
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => dismissError(`issue:${issue.reason}`)}
                      className="p-0.5 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors flex-shrink-0"
                      title="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {warningIssues.filter(i => !dismissedSet.has(`issue:${i.reason}`)).length > 0 && (
            <div className="space-y-2 mb-3">
              {warningIssues.filter(i => !dismissedSet.has(`issue:${i.reason}`)).map((issue, idx) => (
                <div key={idx} className="p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-yellow-700 dark:text-yellow-300">{issue.reason}</p>
                      {issue.suggestedFix && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <button
                            onClick={() => handleApplyToChat(issue.suggestedFix!)}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                                     bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300
                                     hover:bg-yellow-200 dark:hover:bg-yellow-800/50 transition-colors"
                          >
                            <MessageSquare className="w-3 h-3" />
                            Fix
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => dismissError(`issue:${issue.reason}`)}
                      className="p-0.5 text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 transition-colors flex-shrink-0"
                      title="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
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
              {t('preview.allChecksPassed', 'All checks passed.')}
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
                {t('preview.logsCount', 'Logs ({{count}})', { count: logs.length })}
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

// Resolution type badge colors
const RESOLUTION_COLORS: Record<string, string> = {
  url: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  docker: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',
  'ant-project': 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
};

// Category badge config
const CATEGORY_BADGE: Record<string, { icon: typeof Server; color: string; label: string }> = {
  business: { icon: Server, color: 'text-blue-500', label: 'business' },
  infrastructure: { icon: Database, color: 'text-orange-500', label: 'infra' },
};

// Resolution options per category
const RESOLUTION_OPTIONS: Record<string, string[]> = {
  business: ['url', 'ant-project'],
  infrastructure: ['url', 'docker'],
};

function getResolutionLabel(conn: ServiceConnection): string {
  if (conn.resolution.type === 'docker') {
    return `docker://${conn.resolution.service}${conn.resolution.port ? ':' + conn.resolution.port : ''}`;
  }
  if (conn.resolution.type === 'ant-project') {
    const pid = conn.resolution.projectId === 'self' ? 'self' : conn.resolution.projectId;
    const feat = conn.resolution.feature === 'self' ? 'self' : conn.resolution.feature;
    const svc = conn.resolution.serviceName;
    return svc ? `ant://${pid}/${feat}/${svc}` : `ant://${pid}/${feat}`;
  }
  return conn.value || (conn.resolution as any).url || '';
}

/**
 * Chip/badge selector: renders a row of selectable chips.
 * Only one chip can be active at a time.
 */
function ChipSelector({
  options,
  value,
  onChange,
  colorMap,
  disabled,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  colorMap?: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const isSelected = value === opt;
        const activeColor = colorMap?.[opt] || 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300';
        return (
          <button
            key={opt}
            onClick={() => !disabled && onChange(opt)}
            disabled={disabled}
            className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors ${
              isSelected
                ? activeColor
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

const CATEGORY_CHIP_COLORS: Record<string, string> = {
  business: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  infrastructure: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
};

/**
 * ConnectionRow -- single connection with inline editing, badges, and actions
 */
function ConnectionRow({
  conn,
  isEditing,
  onEdit,
  onUpdate,
  onDelete,
  onFix,
}: {
  conn: ServiceConnection;
  isEditing: boolean;
  onEdit: () => void;
  onUpdate: (updates: Partial<ServiceConnection>) => void;
  onDelete: () => void;
  onFix: (msg: string) => void;
}) {
  const statusClass = STATUS_COLORS[conn.status || 'not-started'] || STATUS_COLORS['not-started'];
  const catBadge = CATEGORY_BADGE[conn.category] || CATEGORY_BADGE.business;
  const CatIcon = catBadge.icon;
  const resClass = RESOLUTION_COLORS[conn.resolution.type] || RESOLUTION_COLORS.url;

  // Draft state for editing: resolution-specific fields instead of generic "value"
  const [draft, setDraft] = useState({
    name: conn.name,
    category: conn.category as 'business' | 'infrastructure',
    envVar: conn.envVar,
    resolution: conn.resolution,
    urlInput: '',
    connectionString: '',
  });

  // Project/feature lists for ant-project resolution
  const [projects, setProjects] = useState<string[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingFeatures, setLoadingFeatures] = useState(false);

  const draftProjectId = draft.resolution.type === 'ant-project' ? draft.resolution.projectId : null;

  // Derive the final env value from resolution settings
  const derivedValue = useMemo(() => {
    if (draft.resolution.type === 'url') return draft.urlInput;
    if (draft.resolution.type === 'docker') return draft.connectionString;
    if (draft.resolution.type === 'ant-project') return '(auto)';
    return '';
  }, [draft.resolution.type, draft.urlInput, draft.connectionString]);

  // Allowed resolutions for current category
  const allowedResolutions = RESOLUTION_OPTIONS[draft.category] || ['url'];

  useEffect(() => {
    if (isEditing) {
      setDraft({
        name: conn.name,
        category: conn.category as 'business' | 'infrastructure',
        envVar: conn.envVar,
        resolution: conn.resolution,
        urlInput: conn.resolution.type === 'url' ? (conn.value || (conn.resolution as any).url || '') : '',
        connectionString: conn.resolution.type === 'docker' ? (conn.value || '') : '',
      });
    }
  }, [isEditing, conn.name, conn.category, conn.envVar, conn.value, conn.resolution]);

  // Fetch available projects when editing an ant-project connection
  useEffect(() => {
    if (isEditing && draft.resolution.type === 'ant-project') {
      setLoadingProjects(true);
      fetchProjects()
        .then((p) => setProjects(p))
        .catch(() => setProjects([]))
        .finally(() => setLoadingProjects(false));
    }
  }, [isEditing, draft.resolution.type]);

  // Fetch features when a specific (non-self) project is selected
  useEffect(() => {
    if (isEditing && draftProjectId && draftProjectId !== 'self') {
      setLoadingFeatures(true);
      fetchFeatures(draftProjectId)
        .then((f) => setFeatures(f))
        .catch(() => setFeatures([]))
        .finally(() => setLoadingFeatures(false));
    } else {
      setFeatures([]);
    }
  }, [isEditing, draftProjectId]);

  if (isEditing) {
    const handleConfirm = () => {
      let finalValue = '';
      let finalResolution = draft.resolution;

      if (draft.resolution.type === 'url') {
        finalValue = draft.urlInput;
        finalResolution = { type: 'url', url: draft.urlInput };
      } else if (draft.resolution.type === 'docker') {
        finalValue = draft.connectionString;
      } else if (draft.resolution.type === 'ant-project') {
        finalValue = '';
      }

      onUpdate({
        name: draft.name,
        category: draft.category,
        envVar: draft.envVar,
        value: finalValue,
        resolution: finalResolution,
        userModified: true,
      });
      onEdit();
    };

    const handleCategoryChange = (cat: string) => {
      const category = cat as 'business' | 'infrastructure';
      const allowed = RESOLUTION_OPTIONS[category] || ['url'];
      if (!allowed.includes(draft.resolution.type)) {
        const first = allowed[0];
        let newRes: ConnectionResolution;
        if (first === 'docker') newRes = { type: 'docker', service: conn.id };
        else if (first === 'ant-project') newRes = { type: 'ant-project', projectId: 'self', feature: 'self' };
        else newRes = { type: 'url', url: draft.urlInput || '' };
        setDraft(d => ({ ...d, category, resolution: newRes }));
      } else {
        setDraft(d => ({ ...d, category }));
      }
    };

    const handleResolutionChange = (type: string) => {
      let resolution: ConnectionResolution;
      if (type === 'docker') resolution = { type: 'docker', service: (conn.resolution as any).service || conn.id };
      else if (type === 'ant-project') resolution = { type: 'ant-project', projectId: 'self', feature: 'self' };
      else resolution = { type: 'url', url: draft.urlInput || '' };
      setDraft(d => ({ ...d, resolution }));
    };

    return (
      <div className="px-2.5 py-2.5 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-blue-200 dark:border-blue-800 space-y-2.5">
        {/* A. Name + Actions */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))}
            className="flex-1 px-2 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600
                     bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
            placeholder="Connection name"
          />
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={handleConfirm} className="p-0.5 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 transition-colors" title="Confirm">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onEdit()} className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors" title="Cancel">
              <X className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} className="p-0.5 text-red-400 hover:text-red-600 transition-colors" title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* B. Category + Resolution chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <ChipSelector
            options={['business', 'infrastructure']}
            value={draft.category}
            onChange={handleCategoryChange}
            colorMap={CATEGORY_CHIP_COLORS}
          />
          <span className="text-gray-300 dark:text-gray-600 text-xs">|</span>
          <ChipSelector
            options={allowedResolutions}
            value={draft.resolution.type}
            onChange={handleResolutionChange}
            colorMap={RESOLUTION_COLORS}
          />
        </div>

        {/* C. Resolution Detail */}
        <div className="space-y-1.5">
          {/* C-1: URL */}
          {draft.resolution.type === 'url' && (
            <div>
              <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">URL</label>
              <input
                type="text"
                value={draft.urlInput}
                onChange={(e) => setDraft(d => ({ ...d, urlInput: e.target.value }))}
                placeholder="http://localhost:3000/api"
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                         bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
              />
            </div>
          )}

          {/* C-2: Docker */}
          {draft.resolution.type === 'docker' && (
            <>
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Service</label>
                <input
                  type="text"
                  value={(draft.resolution as any).service || ''}
                  onChange={(e) => setDraft(d => ({
                    ...d,
                    resolution: { type: 'docker', service: e.target.value, port: (d.resolution as any).port } as ConnectionResolution,
                  }))}
                  placeholder="e.g. database, redis"
                  className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                           bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Connection</label>
                <input
                  type="text"
                  value={draft.connectionString}
                  onChange={(e) => setDraft(d => ({ ...d, connectionString: e.target.value }))}
                  placeholder="postgres://user:pw@host:5432/db"
                  className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                           bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                />
              </div>
            </>
          )}

          {/* C-3: Ant Project */}
          {draft.resolution.type === 'ant-project' && (
            <div className="space-y-1.5">
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Project</label>
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setDraft(d => ({
                      ...d,
                      name: d.name || 'self',
                      resolution: { type: 'ant-project', projectId: 'self', feature: 'self' },
                    }))}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors ${
                      draftProjectId === 'self'
                        ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    self
                  </button>
                  {loadingProjects ? (
                    <span className="text-[10px] text-gray-400 px-2 py-0.5 flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading...
                    </span>
                  ) : (
                    projects.map((p) => (
                      <button
                        key={p}
                        onClick={() => setDraft(d => ({
                          ...d,
                          name: d.name || p,
                          resolution: { type: 'ant-project', projectId: p, feature: '' },
                        }))}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors ${
                          draftProjectId === p
                            ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {p}
                      </button>
                    ))
                  )}
                </div>
              </div>
              {draftProjectId && draftProjectId !== 'self' && (
                <div>
                  <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Feature</label>
                  <div className="flex flex-wrap gap-1">
                    {loadingFeatures ? (
                      <span className="text-[10px] text-gray-400 px-2 py-0.5 flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading...
                      </span>
                    ) : features.length === 0 ? (
                      <span className="text-[10px] text-gray-400 px-2 py-0.5 italic">No features found</span>
                    ) : (
                      features.map((f) => (
                        <button
                          key={f.name}
                          onClick={() => setDraft(d => ({
                            ...d,
                            resolution: { type: 'ant-project', projectId: draftProjectId!, feature: f.name },
                          }))}
                          className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors ${
                            (draft.resolution as any).feature === f.name
                              ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          {f.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
              {draftProjectId && draftProjectId !== 'self' && (draft.resolution as any).feature && (
                <div>
                  <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Service <span className="text-gray-400 dark:text-gray-600">(optional)</span></label>
                  <input
                    type="text"
                    value={(draft.resolution as any).serviceName || ''}
                    onChange={(e) => setDraft(d => ({
                      ...d,
                      resolution: { ...d.resolution, serviceName: e.target.value || undefined } as any,
                    }))}
                    placeholder="e.g. api, redirect"
                    className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                             bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                  />
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
                <span>Proxy</span>
                <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {draftProjectId === 'self' ? '(auto)' : `/${draftProjectId}--${(draft.resolution as any).feature || '...'}${(draft.resolution as any).serviceName ? '--' + (draft.resolution as any).serviceName : ''}`}
                </code>
              </div>
            </div>
          )}
        </div>

        {/* D. Env Injection Preview */}
        <div className="rounded border border-dashed border-gray-300 dark:border-gray-600 px-2.5 py-1.5">
          <div className="text-[9px] text-gray-400 dark:text-gray-500 mb-1 font-medium uppercase tracking-wider">.env</div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={draft.envVar}
              onChange={(e) => setDraft(d => ({ ...d, envVar: e.target.value }))}
              className="w-32 px-1.5 py-0.5 text-[11px] font-mono rounded border border-gray-300 dark:border-gray-600
                       bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
              placeholder="ENV_VAR"
            />
            <span className="text-[11px] text-gray-400 font-mono">=</span>
            <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 break-all flex-1 min-w-0">
              {derivedValue || <span className="text-gray-300 dark:text-gray-600 italic">empty</span>}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Read-only mode
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-gray-800/50 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <CatIcon className={`w-3 h-3 ${catBadge.color} flex-shrink-0`} />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
            {conn.name}
          </span>
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${resClass}`}>
            {conn.resolution.type}
          </span>
          {conn.resolution.type !== 'url' && (
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${statusClass}`}>
              {conn.status || 'not-started'}
            </span>
          )}
          {(conn.missingAnnotation || conn.userModified) && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300"
              title={conn.userModified ? 'Changes not yet applied to project files' : 'Missing @connection annotation in .env.example'}
            >
              {conn.userModified ? 'modified' : '!annotation'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
          <code className="text-[10px] text-gray-500 dark:text-gray-400">
            {conn.envVar}
          </code>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">&rarr;</span>
          <code
            className="text-[10px] text-gray-500 dark:text-gray-400 break-all"
            title={conn.resolution.type !== 'url' && conn.value ? conn.value : undefined}
          >
            {getResolutionLabel(conn)}
          </code>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={onEdit}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
        {(conn.missingAnnotation || conn.userModified) && (
          <button
            onClick={() => {
              const source = conn.source && conn.source !== '*' ? conn.source + '/' : '';
              const lines: string[] = [`[Service Connection Fix: ${conn.name}]`, ''];
              let step = 1;

              // Annotation fix
              if (conn.missingAnnotation) {
                let annotationSuffix = '';
                if (conn.resolution.type === 'ant-project') {
                  const pid = conn.resolution.projectId;
                  const feat = conn.resolution.feature;
                  const svc = conn.resolution.serviceName;
                  annotationSuffix = (pid === 'self' && feat === 'self')
                    ? ' self'
                    : ` ant-project:${pid}:${feat}${svc ? ':' + svc : ''}`;
                }
                lines.push(
                  `${step}. ${source}.env.example 파일에서 ${conn.envVar} 위에 어노테이션을 추가해주세요:`,
                  `   # @connection ${conn.category} ${conn.id}${annotationSuffix}`,
                  `   ${conn.envVar}=${conn.value}`,
                  '',
                );
                step++;
              }

              // Env value sync based on resolution type
              if (conn.userModified) {
                if (conn.resolution.type === 'url') {
                  lines.push(
                    `${step}. ${source}.env 파일에서 ${conn.envVar}의 값을 업데이트해주세요:`,
                    `   ${conn.envVar}=${conn.value}`,
                    '',
                  );
                  step++;
                  lines.push(
                    `${step}. ${source}.env.example 파일에서도 ${conn.envVar}의 기본값을 업데이트해주세요:`,
                    `   ${conn.envVar}=${conn.value}`,
                    '',
                  );
                  step++;
                } else if (conn.resolution.type === 'docker') {
                  const service = conn.resolution.service;
                  lines.push(
                    `${step}. ${source}.env 파일에서 ${conn.envVar}의 값을 업데이트해주세요:`,
                    `   ${conn.envVar}=${conn.value}`,
                    '',
                  );
                  step++;
                  lines.push(
                    `${step}. ${source}.env.example 파일에서도 ${conn.envVar}의 기본값을 업데이트해주세요:`,
                    `   ${conn.envVar}=${conn.value}`,
                    '',
                  );
                  step++;
                  lines.push(
                    `${step}. docker-compose.yml에서 ${service} 서비스가 정의되어 있는지 확인해주세요.`,
                    '',
                  );
                  step++;
                } else if (conn.resolution.type === 'ant-project') {
                  const targetProject = conn.resolution.projectId;
                  const targetFeature = conn.resolution.feature;
                  const targetService = conn.resolution.serviceName;
                  const isSelf = targetProject === 'self' && targetFeature === 'self';
                  const annotationSuffix = isSelf
                    ? ' self'
                    : ` ant-project:${targetProject}:${targetFeature}${targetService ? ':' + targetService : ''}`;
                  lines.push(
                    `${step}. ${source}.env.example 파일에서 ${conn.envVar} 위에 어노테이션을 확인/추가해주세요:`,
                    `   # @connection ${conn.category} ${conn.id}${annotationSuffix}`,
                    `   ${conn.envVar}=(preview 시작 시 자동 주입)`,
                    '',
                  );
                  step++;
                  lines.push(
                    `${step}. ${source}.env 파일에서 ${conn.envVar}가 있는지 확인해주세요 (값은 preview 시작 시 자동 설정됩니다).`,
                    '',
                  );
                  step++;
                  if (!isSelf) {
                    lines.push(
                      `참고: 참조 대상 프로젝트(${targetProject}/${targetFeature})의 설정은 해당 프로젝트에서 관리됩니다.`,
                      '',
                    );
                  }
                }
              }

              onFix(lines.join('\n'));
              // Optimistic: clear userModified so Fix button hides immediately
              onUpdate({ userModified: false });
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                     bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300
                     hover:bg-yellow-200 dark:hover:bg-yellow-800/50 transition-colors"
            title="Apply changes to project files"
          >
            <MessageSquare className="w-3 h-3" />
            Fix
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * AddConnectionForm -- inline form for adding a new connection.
 * Same A-B-C-D layout as ConnectionRow edit mode.
 */
function AddConnectionForm({
  onAdd,
  onCancel,
}: {
  onAdd: (conn: ServiceConnection) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<'business' | 'infrastructure'>('business');
  const [name, setName] = useState('');
  const [envVar, setEnvVar] = useState('');
  const [resType, setResType] = useState<'url' | 'docker' | 'ant-project'>('url');
  const [urlInput, setUrlInput] = useState('');
  const [dockerService, setDockerService] = useState('');
  const [connectionString, setConnectionString] = useState('');

  const allowedRes = RESOLUTION_OPTIONS[category] || ['url'];

  const derivedValue = useMemo(() => {
    if (resType === 'url') return urlInput;
    if (resType === 'docker') return connectionString;
    if (resType === 'ant-project') return '(auto)';
    return '';
  }, [resType, urlInput, connectionString]);

  const handleCategoryChange = (cat: string) => {
    const c = cat as 'business' | 'infrastructure';
    setCategory(c);
    const allowed = RESOLUTION_OPTIONS[c] || ['url'];
    if (!allowed.includes(resType)) setResType(allowed[0] as any);
  };

  const handleSubmit = () => {
    if (!name || !envVar) return;
    let resolution: ConnectionResolution;
    let value = '';
    if (resType === 'docker') {
      resolution = { type: 'docker', service: dockerService || name };
      value = connectionString;
    } else if (resType === 'ant-project') {
      resolution = { type: 'ant-project', projectId: 'self', feature: 'self' };
    } else {
      resolution = { type: 'url', url: urlInput };
      value = urlInput;
    }
    onAdd({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      category,
      envVar,
      value,
      resolution,
      source: '*',
    });
  };

  return (
    <div className="px-2.5 py-2.5 rounded-md border border-dashed border-gray-300 dark:border-gray-600 space-y-2.5">
      {/* A. Name + Cancel */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 px-2 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600
                   bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
          placeholder="Connection name (e.g. PostgreSQL)"
        />
        <button onClick={onCancel} className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0" title="Cancel">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* B. Category + Resolution chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <ChipSelector
          options={['business', 'infrastructure']}
          value={category}
          onChange={handleCategoryChange}
          colorMap={CATEGORY_CHIP_COLORS}
        />
        <span className="text-gray-300 dark:text-gray-600 text-xs">|</span>
        <ChipSelector
          options={allowedRes}
          value={resType}
          onChange={(v) => setResType(v as any)}
          colorMap={RESOLUTION_COLORS}
        />
      </div>

      {/* C. Resolution Detail */}
      <div className="space-y-1.5">
        {resType === 'url' && (
          <div>
            <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">URL</label>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:3000/api"
              className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                       bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
            />
          </div>
        )}
        {resType === 'docker' && (
          <>
            <div>
              <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Service</label>
              <input
                type="text"
                value={dockerService}
                onChange={(e) => setDockerService(e.target.value)}
                placeholder="e.g. database, redis"
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                         bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Connection</label>
              <input
                type="text"
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
                placeholder="postgres://user:pw@host:5432/db"
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                         bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
              />
            </div>
          </>
        )}
        {resType === 'ant-project' && (
          <div className="text-[10px] text-gray-400 dark:text-gray-500 italic px-1">
            Project/feature will be configured after adding.
          </div>
        )}
      </div>

      {/* D. Env Injection Preview */}
      <div className="rounded border border-dashed border-gray-300 dark:border-gray-600 px-2.5 py-1.5">
        <div className="text-[9px] text-gray-400 dark:text-gray-500 mb-1 font-medium uppercase tracking-wider">.env</div>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={envVar}
            onChange={(e) => setEnvVar(e.target.value)}
            className="w-32 px-1.5 py-0.5 text-[11px] font-mono rounded border border-gray-300 dark:border-gray-600
                     bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
            placeholder="ENV_VAR"
          />
          <span className="text-[11px] text-gray-400 font-mono">=</span>
          <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 break-all flex-1 min-w-0">
            {derivedValue || <span className="text-gray-300 dark:text-gray-600 italic">empty</span>}
          </span>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!name || !envVar}
        className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded
                 bg-blue-600 text-white hover:bg-blue-700
                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add
      </button>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import {
  Check,
  X,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import type {
  ServiceConnection,
  ConnectionResolution,
  Feature,
  ServiceCategory,
} from '@/infrastructure/http/api';
import { fetchProjects, fetchFeatures } from '@/infrastructure/http/api';
import {
  STATUS_COLORS,
  RESOLUTION_COLORS,
  CATEGORY_BADGE,
  RESOLUTION_OPTIONS,
  CATEGORY_CHIP_COLORS,
} from '../constants';
import { getResolutionLabel, generateFixMessage } from '../utils';
import { ChipSelector } from './ChipSelector';

interface DraftState {
  name: string;
  category: ServiceCategory;
  envVar: string;
  resolution: ConnectionResolution;
  urlInput: string;
  connectionString: string;
}

export function ConnectionRow({
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
  const statusClass = STATUS_COLORS[conn.status || 'stopped'] || STATUS_COLORS['stopped'];
  const catBadge = CATEGORY_BADGE[conn.category] || CATEGORY_BADGE.business;
  const CatIcon = catBadge.icon;
  const resClass = RESOLUTION_COLORS[conn.resolution.type] || RESOLUTION_COLORS.url;

  const [draft, setDraft] = useState<DraftState>({
    name: conn.name,
    category: conn.category,
    envVar: conn.envVar,
    resolution: conn.resolution,
    urlInput: '',
    connectionString: '',
  });

  const [projects, setProjects] = useState<string[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingFeatures, setLoadingFeatures] = useState(false);

  const draftProjectId = draft.resolution.type === 'ant-project' ? draft.resolution.projectId : null;

  const derivedValue = useMemo(() => {
    if (draft.resolution.type === 'url') return draft.urlInput;
    if (draft.resolution.type === 'docker') return draft.connectionString;
    if (draft.resolution.type === 'ant-project') return '(auto)';
    return '';
  }, [draft.resolution.type, draft.urlInput, draft.connectionString]);

  const allowedResolutions = RESOLUTION_OPTIONS[draft.category] || ['url'];

  useEffect(() => {
    if (isEditing) {
      setDraft({
        name: conn.name,
        category: conn.category,
        envVar: conn.envVar,
        resolution: conn.resolution,
        urlInput: conn.resolution.type === 'url' ? (conn.value || conn.resolution.url || '') : '',
        connectionString: conn.resolution.type === 'docker' ? (conn.value || '') : '',
      });
    }
  }, [isEditing, conn.name, conn.category, conn.envVar, conn.value, conn.resolution]);

  useEffect(() => {
    if (isEditing && draft.resolution.type === 'ant-project') {
      setLoadingProjects(true);
      fetchProjects()
        .then((p) => setProjects(p))
        .catch(() => setProjects([]))
        .finally(() => setLoadingProjects(false));
    }
  }, [isEditing, draft.resolution.type]);

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
      const category = cat as ServiceCategory;
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
      if (type === 'docker') {
        const existingService = conn.resolution.type === 'docker' ? conn.resolution.service : conn.id;
        resolution = { type: 'docker', service: existingService };
      } else if (type === 'ant-project') {
        resolution = { type: 'ant-project', projectId: 'self', feature: 'self' };
      } else {
        resolution = { type: 'url', url: draft.urlInput || '' };
      }
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

          {draft.resolution.type === 'docker' && (
            <>
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Service</label>
                <input
                  type="text"
                  value={draft.resolution.service || ''}
                  onChange={(e) => setDraft(d => {
                    if (d.resolution.type !== 'docker') return d;
                    return {
                      ...d,
                      resolution: { type: 'docker', service: e.target.value, port: d.resolution.port },
                    };
                  })}
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

          {draft.resolution.type === 'ant-project' && (
            <AntProjectFields
              draft={draft}
              setDraft={setDraft}
              draftProjectId={draftProjectId}
              projects={projects}
              features={features}
              loadingProjects={loadingProjects}
              loadingFeatures={loadingFeatures}
            />
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
              {conn.status || 'stopped'}
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
              onFix(generateFixMessage(conn));
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

/** Ant-project resolution fields (extracted for readability) */
function AntProjectFields({
  draft,
  setDraft,
  draftProjectId,
  projects,
  features,
  loadingProjects,
  loadingFeatures,
}: {
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  draftProjectId: string | null;
  projects: string[];
  features: Feature[];
  loadingProjects: boolean;
  loadingFeatures: boolean;
}) {
  if (draft.resolution.type !== 'ant-project') return null;
  const res = draft.resolution;

  return (
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
                    res.feature === f.name
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
      {draftProjectId && draftProjectId !== 'self' && res.feature && (
        <div>
          <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Service <span className="text-gray-400 dark:text-gray-600">(optional)</span></label>
          <input
            type="text"
            value={res.serviceName || ''}
            onChange={(e) => setDraft(d => ({
              ...d,
              resolution: { ...d.resolution, serviceName: e.target.value || undefined } as ConnectionResolution,
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
          {draftProjectId === 'self' ? '(auto)' : `/${draftProjectId}--${res.feature || '...'}${res.serviceName ? '--' + res.serviceName : ''}`}
        </code>
      </div>
    </div>
  );
}

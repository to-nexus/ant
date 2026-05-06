import { Check, X, Trash2 } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type {
  ServiceConnection,
  ConnectionResolution,
  Feature,
} from '@/infrastructure/http/api';
import type { DraftState } from './useConnectionRowDraft';
import { ResolutionChips } from './ResolutionChips';
import { useConnectionRowDraft } from './useConnectionRowDraft';
import { useProjectFeatureLookup } from './useProjectFeatureLookup';
import { VirtualizationToggle } from './VirtualizationToggle';

/**
 * Edit-mode form for a connection row. All draft state is local until the
 * user confirms via the green check; cancellation is a no-op because the
 * underlying `conn` is never mutated until `onUpdate` is called.
 */
export function ConnectionRowEdit({
  conn,
  onCancel,
  onUpdate,
  onDelete,
  onToggleVirtualization,
}: {
  conn: ServiceConnection;
  onCancel: () => void;
  onUpdate: (updates: Partial<ServiceConnection>) => void;
  onDelete: () => void;
  onToggleVirtualization?: (active: boolean) => void;
}) {
  const { draft, setDraft, draftProjectId, derivedValue } = useConnectionRowDraft(conn, true);
  const { projects, features, loadingProjects, loadingFeatures } = useProjectFeatureLookup(
    true,
    draft.resolution.type,
    draftProjectId,
  );

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
    onCancel();
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
        {onToggleVirtualization && (
          <VirtualizationToggle conn={conn} onToggle={onToggleVirtualization} />
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={handleConfirm} className="p-0.5 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 transition-colors" title="Confirm">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={onCancel} className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors" title="Cancel">
            <X className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-0.5 text-red-400 hover:text-red-600 transition-colors" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* B. Category + Resolution chips */}
      <ResolutionChips conn={conn} draft={draft} setDraft={setDraft} />

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

/** Ant-project resolution fields (extracted for readability). */
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
              <Spinner size="sm" tone="inherit" /> Loading...
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
                <Spinner size="sm" tone="inherit" /> Loading...
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

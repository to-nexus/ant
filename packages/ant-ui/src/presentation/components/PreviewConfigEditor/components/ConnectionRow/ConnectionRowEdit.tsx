import { Check, X, Trash2 } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type {
  ServiceConnection,
  ConnectionResolution,
  Feature,
} from '@/infrastructure/http/api';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora';
import type { DraftState } from './useConnectionRowDraft';
import { ResolutionChips } from './ResolutionChips';
import { useConnectionRowDraft } from './useConnectionRowDraft';
import { useProjectFeatureLookup } from './useProjectFeatureLookup';
import { VirtualizationToggle } from './VirtualizationToggle';

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text-4)',
  letterSpacing: 1.2,
  textTransform: 'uppercase',
};

const iconBtnStyle = (tone: 'confirm' | 'cancel' | 'delete'): React.CSSProperties => {
  const color =
    tone === 'confirm'
      ? 'oklch(45% 0.16 155)'
      : tone === 'delete'
        ? 'var(--status-error-fg)'
        : 'var(--text-3)';
  return {
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-2)',
    borderRadius: 'var(--r-sm)',
    color,
    cursor: 'pointer',
    padding: 0,
  };
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '2px 9px',
  fontSize: 10,
  fontWeight: 700,
  borderRadius: 'var(--r-pill)',
  border: active ? '1px solid var(--violet-200)' : '1px solid var(--border-2)',
  background: active ? 'oklch(94% 0.06 290)' : 'var(--bg-surface-2)',
  color: active ? 'var(--violet-700)' : 'var(--text-3)',
  cursor: 'pointer',
});

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
    <div
      style={{
        padding: 12,
        background: 'var(--bg-surface)',
        border: '1.5px solid var(--violet-300)',
        borderRadius: 'var(--r-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* A. Name + Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AuroraInput
            value={draft.name}
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
            placeholder="Connection name"
          />
        </div>
        {onToggleVirtualization && (
          <VirtualizationToggle conn={conn} onToggle={onToggleVirtualization} />
        )}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={handleConfirm}
            style={iconBtnStyle('confirm')}
            title="Confirm"
          >
            <Check size={11} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={iconBtnStyle('cancel')}
            title="Cancel"
          >
            <X size={11} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            style={iconBtnStyle('delete')}
            title="Delete"
          >
            <Trash2 size={11} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* B. Category + Resolution chips */}
      <ResolutionChips conn={conn} draft={draft} setDraft={setDraft} />

      {/* C. Resolution Detail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft.resolution.type === 'url' && (
          <div>
            <label style={fieldLabelStyle}>URL</label>
            <AuroraInput
              value={draft.urlInput}
              onChange={(v) => setDraft((d) => ({ ...d, urlInput: v }))}
              placeholder="http://localhost:3000/api"
              mono
            />
          </div>
        )}

        {draft.resolution.type === 'docker' && (
          <>
            <div>
              <label style={fieldLabelStyle}>Service</label>
              <AuroraInput
                value={draft.resolution.service || ''}
                onChange={(v) =>
                  setDraft((d) => {
                    if (d.resolution.type !== 'docker') return d;
                    return {
                      ...d,
                      resolution: {
                        type: 'docker',
                        service: v,
                        port: d.resolution.port,
                      },
                    };
                  })
                }
                placeholder="e.g. database, redis"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Connection</label>
              <AuroraInput
                value={draft.connectionString}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, connectionString: v }))
                }
                placeholder="postgres://user:pw@host:5432/db"
                mono
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
      <div
        style={{
          padding: '8px 10px',
          border: '1px dashed var(--border-2)',
          borderRadius: 'var(--r-md)',
          background: 'var(--bg-surface-2)',
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--text-4)',
            marginBottom: 4,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          .env
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 140, flexShrink: 0 }}>
            <AuroraInput
              value={draft.envVar}
              onChange={(v) => setDraft((d) => ({ ...d, envVar: v }))}
              placeholder="ENV_VAR"
              mono
            />
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-4)',
            }}
          >
            =
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-3)',
              wordBreak: 'break-all',
            }}
          >
            {derivedValue || (
              <span
                style={{
                  color: 'var(--text-4)',
                  fontStyle: 'italic',
                }}
              >
                empty
              </span>
            )}
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

  const loadingTextStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: 10,
    color: 'var(--text-4)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <label style={fieldLabelStyle}>Project</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button
            type="button"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                name: d.name || 'self',
                resolution: {
                  type: 'ant-project',
                  projectId: 'self',
                  feature: 'self',
                },
              }))
            }
            style={chipStyle(draftProjectId === 'self')}
          >
            self
          </button>
          {loadingProjects ? (
            <span style={loadingTextStyle}>
              <Spinner size="sm" tone="inherit" /> Loading...
            </span>
          ) : (
            projects.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    name: d.name || p,
                    resolution: {
                      type: 'ant-project',
                      projectId: p,
                      feature: '',
                    },
                  }))
                }
                style={chipStyle(draftProjectId === p)}
              >
                {p}
              </button>
            ))
          )}
        </div>
      </div>
      {draftProjectId && draftProjectId !== 'self' && (
        <div>
          <label style={fieldLabelStyle}>Feature</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {loadingFeatures ? (
              <span style={loadingTextStyle}>
                <Spinner size="sm" tone="inherit" /> Loading...
              </span>
            ) : features.length === 0 ? (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-4)',
                  fontStyle: 'italic',
                  padding: '2px 8px',
                }}
              >
                No features found
              </span>
            ) : (
              features.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      resolution: {
                        type: 'ant-project',
                        projectId: draftProjectId!,
                        feature: f.name,
                      },
                    }))
                  }
                  style={chipStyle(res.feature === f.name)}
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
          <label style={fieldLabelStyle}>
            Service{' '}
            <span
              style={{
                color: 'var(--text-4)',
                fontWeight: 600,
                textTransform: 'none',
                letterSpacing: 0,
              }}
            >
              (optional)
            </span>
          </label>
          <AuroraInput
            value={res.serviceName || ''}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                resolution: {
                  ...d.resolution,
                  serviceName: v || undefined,
                } as ConnectionResolution,
              }))
            }
            placeholder="e.g. api, redirect"
          />
        </div>
      )}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10,
          color: 'var(--text-4)',
        }}
      >
        <span>Proxy</span>
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            padding: '1px 7px',
            borderRadius: 'var(--r-sm)',
            background: 'var(--bg-surface-2)',
            color: 'var(--text-3)',
            border: '1px solid var(--border-2)',
          }}
        >
          {draftProjectId === 'self'
            ? '(auto)'
            : `/${draftProjectId}--${res.feature || '...'}${
                res.serviceName ? '--' + res.serviceName : ''
              }`}
        </code>
      </div>
    </div>
  );
}

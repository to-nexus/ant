import { useState, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import type { ServiceConnection, ConnectionResolution } from '@/infrastructure/http/api';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora';
import { RESOLUTION_OPTIONS } from '../constants';

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text-4)',
  letterSpacing: 1.2,
  textTransform: 'uppercase',
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
  transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
  textTransform: 'capitalize',
});

export function AddConnectionForm({
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
    if (!allowed.includes(resType)) setResType(allowed[0] as typeof resType);
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

  const submitDisabled = !name || !envVar;

  return (
    <div
      style={{
        padding: 12,
        border: '1px dashed var(--violet-300)',
        borderRadius: 'var(--r-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--bg-surface)',
      }}
    >
      {/* A. Name + Cancel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AuroraInput
            value={name}
            onChange={setName}
            placeholder="Connection name (e.g. PostgreSQL)"
          />
        </div>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          style={{
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--r-sm)',
            color: 'var(--text-3)',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <X size={11} strokeWidth={2.4} />
        </button>
      </div>

      {/* B. Category + Resolution chips */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {(['business', 'infrastructure'] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => handleCategoryChange(c)}
            style={chipStyle(category === c)}
          >
            {c}
          </button>
        ))}
        <span style={{ color: 'var(--border-2)', fontSize: 11 }}>|</span>
        {allowedRes.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setResType(r as typeof resType)}
            style={chipStyle(resType === r)}
          >
            {r}
          </button>
        ))}
      </div>

      {/* C. Resolution Detail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {resType === 'url' && (
          <div>
            <label style={fieldLabelStyle}>URL</label>
            <AuroraInput
              value={urlInput}
              onChange={setUrlInput}
              placeholder="http://localhost:3000/api"
              mono
            />
          </div>
        )}
        {resType === 'docker' && (
          <>
            <div>
              <label style={fieldLabelStyle}>Service</label>
              <AuroraInput
                value={dockerService}
                onChange={setDockerService}
                placeholder="e.g. database, redis"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Connection</label>
              <AuroraInput
                value={connectionString}
                onChange={setConnectionString}
                placeholder="postgres://user:pw@host:5432/db"
                mono
              />
            </div>
          </>
        )}
        {resType === 'ant-project' && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-4)',
              fontStyle: 'italic',
              padding: '0 2px',
            }}
          >
            Project/feature will be configured after adding.
          </div>
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
              value={envVar}
              onChange={setEnvVar}
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

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitDisabled}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 'var(--r-md)',
          border: 'none',
          background: submitDisabled
            ? 'var(--bg-surface-2)'
            : 'var(--gradient-aurora)',
          color: submitDisabled ? 'var(--text-4)' : 'white',
          cursor: submitDisabled ? 'not-allowed' : 'pointer',
          alignSelf: 'flex-start',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          boxShadow: submitDisabled
            ? 'none'
            : '0 4px 12px -6px oklch(55% 0.18 290 / 0.4)',
        }}
      >
        <Plus size={12} strokeWidth={2.2} />
        Add
      </button>
    </div>
  );
}

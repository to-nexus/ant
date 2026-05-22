import type { ServiceCategory, ConnectionResolution, ServiceConnection } from '@/infrastructure/http/api';
import { RESOLUTION_OPTIONS } from '../../constants';
import type { DraftState } from './useConnectionRowDraft';

function AuroraChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {options.map((opt) => {
        const isActive = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              padding: '2px 9px',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 'var(--r-pill)',
              border: isActive
                ? '1px solid transparent'
                : '1px solid var(--border-2)',
              background: isActive
                ? 'var(--gradient-violet-pink)'
                : 'var(--bg-surface-2)',
              color: isActive ? 'white' : 'var(--text-3)',
              cursor: 'pointer',
              transition:
                'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
              letterSpacing: '0.02em',
              textTransform: 'capitalize',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Category + resolution chip selectors for edit mode. Encapsulates the
 * resolution type transition rules (changing category may force a
 * compatible resolution type, since infrastructure→ant-project and
 * business→docker are illegal pairings).
 */
export function ResolutionChips({
  conn,
  draft,
  setDraft,
}: {
  conn: ServiceConnection;
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
}) {
  const allowedResolutions = RESOLUTION_OPTIONS[draft.category] || ['url'];

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
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      <AuroraChipRow
        options={['business', 'infrastructure'] as const}
        value={draft.category}
        onChange={(v) => handleCategoryChange(v)}
      />
      <span
        aria-hidden
        style={{
          width: 1,
          height: 12,
          background: 'var(--border-2)',
          display: 'inline-block',
        }}
      />
      <AuroraChipRow
        options={allowedResolutions as readonly string[]}
        value={draft.resolution.type}
        onChange={(v) => handleResolutionChange(v)}
      />
    </div>
  );
}

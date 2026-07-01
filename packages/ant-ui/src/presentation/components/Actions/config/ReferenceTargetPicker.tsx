import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReferenceTarget } from '@ant/shared';
import { fetchReferenceCatalog, type ReferenceCatalogEntry } from '@/infrastructure/http/api/projects';

interface ReferenceTargetPickerProps {
  /** Current project — excluded from the catalog. */
  excludeProject?: string;
  selected: ReferenceTarget[];
  onChange: (next: ReferenceTarget[]) => void;
}

function isSelected(selected: ReferenceTarget[], project: string, branch: string): boolean {
  return selected.some((t) => t.project === project && (t.branch ?? 'main') === branch);
}

/**
 * Cross-project reference picker — lets the user attach sibling ANT projects
 * (at a chosen git ref) to the action. Selection is written to
 * `actionMetadata.referenceTargets`; the code/design job then reads that
 * project's source read-only via the reference-codebase tools.
 */
export function ReferenceTargetPicker({ excludeProject, selected, onChange }: ReferenceTargetPickerProps) {
  const { t } = useTranslation('actions');
  const [catalog, setCatalog] = useState<ReferenceCatalogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setFailed(false);
    fetchReferenceCatalog(excludeProject)
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [excludeProject]);

  const toggle = (project: string, branch: string) => {
    if (isSelected(selected, project, branch)) {
      onChange(selected.filter((tt) => !(tt.project === project && (tt.branch ?? 'main') === branch)));
    } else {
      // Store `main` as an undefined branch so the entry stays stable regardless
      // of the repo's default-branch name; other refs are stored verbatim.
      onChange([...selected, { project, branch: branch === 'main' ? undefined : branch }]);
    }
  };

  if (failed) {
    return (
      <p className="text-xs italic px-1" style={{ color: 'var(--text-3)' }}>
        {t('referenceCodebase.error')}
      </p>
    );
  }

  if (catalog === null) {
    return (
      <p className="text-xs italic px-1" style={{ color: 'var(--text-3)' }}>
        {t('referenceCodebase.loading')}
      </p>
    );
  }

  if (catalog.length === 0) {
    return (
      <p className="text-xs italic px-1" style={{ color: 'var(--text-3)' }}>
        {t('referenceCodebase.none')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs px-1" style={{ color: 'var(--text-3)' }}>
        {t('referenceCodebase.hint')}
      </p>
      {catalog.map((entry) => (
        <div key={entry.project} className="rounded-md px-2 py-1.5" style={{ background: 'var(--surface-2)' }}>
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-1)' }}>
            {entry.project}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {entry.branches.map((branch) => {
              const on = isSelected(selected, entry.project, branch);
              return (
                <button
                  key={branch}
                  type="button"
                  onClick={() => toggle(entry.project, branch)}
                  className="text-[11px] rounded px-2 py-0.5 border transition-colors"
                  style={{
                    borderColor: on ? 'var(--emerald-500)' : 'var(--border-2)',
                    background: on ? 'var(--emerald-500)' : 'transparent',
                    color: on ? 'white' : 'var(--text-2)',
                  }}
                  aria-pressed={on}
                >
                  {branch}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

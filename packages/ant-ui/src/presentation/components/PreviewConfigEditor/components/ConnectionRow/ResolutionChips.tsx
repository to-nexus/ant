import type { ServiceCategory, ConnectionResolution, ServiceConnection } from '@/infrastructure/http/api';
import {
  RESOLUTION_OPTIONS,
  RESOLUTION_COLORS,
  CATEGORY_CHIP_COLORS,
} from '../../constants';
import { ChipSelector } from '../ChipSelector';
import type { DraftState } from './useConnectionRowDraft';

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
  );
}

/**
 * The save-time advisories a definition carries, live (the shared collectors
 * over the draft) and as the server answered them on the last save. Amber,
 * never blocking: these are findings a person weighs.
 *
 * They live behind a HEADER badge, not in a strip above the canvas — a strip
 * that appears, and then grows when expanded, resizes the canvas twice. The
 * popover scrolls instead, so the list needs no collapse and nothing is one
 * click further away than it was.
 */

import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { Badge } from '../aurora';
import { Tooltip } from '../common/Tooltip';

export interface AdvisoryStripItem {
  id: string;
  message: string;
  stepId?: string;
  source: 'live' | 'saved';
}

export function AdvisoryList({ items, onSelectStep }: { items: AdvisoryStripItem[]; onSelectStep?: (stepId: string) => void }) {
  const { t } = useTranslation('pipelines');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 320, maxHeight: 320, overflowY: 'auto', textAlign: 'left' }}>
      {items.map((item) => {
        const clickable = !!item.stepId && !!onSelectStep;
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            {item.source === 'saved' && (
              <Badge size="sm" tone="warning" title={t('advisory.savedHint', 'Returned by the server on the last save')}>
                {t('advisory.saved', 'Saved')}
              </Badge>
            )}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => item.stepId && onSelectStep?.(item.stepId)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                textAlign: 'left',
                fontSize: 12,
                lineHeight: 1.55,
                color: 'var(--text-2)',
                cursor: clickable ? 'pointer' : 'default',
                overflowWrap: 'anywhere',
              }}
            >
              {item.message}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Header badge — `⚠ n`, opening the list. Renders nothing when there are none. */
export function AdvisoryBadge({ items, onSelectStep }: { items: AdvisoryStripItem[]; onSelectStep?: (stepId: string) => void }) {
  const { t } = useTranslation('pipelines');
  if (items.length === 0) return null;
  return (
    <Tooltip
      content={<AdvisoryList items={items} onSelectStep={onSelectStep} />}
      placement="bottom"
      surface="var(--intent-amber-bg)"
      borderColor="var(--amber-500)"
    >
      <Badge tone="warning" size="sm" style={{ flexShrink: 0, cursor: 'pointer' }} title={t('advisory.title', '{{n}} advisories', { n: items.length })}>
        <TriangleAlert size={10} style={{ marginRight: 3 }} />
        {items.length}
      </Badge>
    </Tooltip>
  );
}

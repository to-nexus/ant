/**
 * AdvisoryStrip — the save-time advisories a definition carries, live (the
 * shared collectors over the draft) and as the server answered them on the
 * last save. Amber, never blocking: these are findings a person weighs.
 * Clicking an item selects the step it names.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { Badge } from '../aurora';

export interface AdvisoryStripItem {
  id: string;
  message: string;
  stepId?: string;
  source: 'live' | 'saved';
}

const COLLAPSED_ROWS = 4;

export function AdvisoryStrip({ items, onSelectStep }: { items: AdvisoryStripItem[]; onSelectStep?: (stepId: string) => void }) {
  const { t } = useTranslation('pipelines');
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, COLLAPSED_ROWS);
  const hidden = items.length - shown.length;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 10,
        padding: '8px 14px 8px 12px',
        background: 'var(--intent-amber-bg)',
        borderLeft: '2px solid var(--amber-500)',
        borderBottom: '1px solid var(--border-1)',
      }}
    >
      <TriangleAlert size={14} style={{ color: 'var(--amber-500)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>{t('advisory.title', '{{n}} advisories', { n: items.length })}</span>
        {shown.map((item) => {
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
                  fontSize: 12.5,
                  lineHeight: 1.5,
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
        {(hidden > 0 || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, fontSize: 11.5, color: 'var(--violet-500)', cursor: 'pointer' }}
          >
            {expanded ? t('advisory.less', 'Show fewer') : t('advisory.more', '{{n}} more', { n: hidden })}
          </button>
        )}
      </div>
    </div>
  );
}

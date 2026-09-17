/**
 * An item-path input (`$.issues`, `$.fields['x'].value`) — validated by the
 * shared grammar as you type, with a "pick in response" action that arms the
 * explorer, and the value the path resolves to in the sample shown beside it
 * so a wrong path is visibly wrong before any poll.
 */

import { useTranslation } from 'react-i18next';
import { MousePointerClick } from 'lucide-react';
import { AuroraInput } from '../../../ConfigEditor/aurora';
import { pathError } from '../fetch/fetchMapping';
import { LINK_BUTTON_STYLE } from './KeyValueRows';

export interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** What the path selects in the sample, when a sample exists. */
  resolved?: string;
  /** Present when a sample exists: arms the explorer's pick mode. */
  onPick?: () => void;
  picking?: boolean;
  /** Test/automation handle for the pick button (`data-pick`). */
  pickId?: string;
  accent?: string;
  disabled?: boolean;
}

export function PathInput({ value, onChange, placeholder = '$.', resolved, onPick, picking, pickId, accent = 'var(--violet-500)', disabled }: PathInputProps) {
  const { t } = useTranslation('pipelines');
  const error = value.trim() ? pathError(value) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AuroraInput mono value={value} disabled={disabled} hasError={error !== null} placeholder={placeholder} onChange={onChange} />
        </div>
        {onPick && (
          <button
            type="button"
            onClick={onPick}
            disabled={disabled}
            aria-pressed={picking}
            data-pick={pickId}
            style={{ ...LINK_BUTTON_STYLE, color: picking ? accent : 'var(--violet-500)', whiteSpace: 'nowrap', padding: '0 4px' }}
          >
            <MousePointerClick size={11} /> {picking ? t('trigger.fetch.picking', 'Click in the response…') : t('trigger.fetch.pick', 'Pick')}
          </button>
        )}
      </div>
      {error ? (
        <span style={{ fontSize: 10.5, color: 'var(--status-error-fg)' }}>{error}</span>
      ) : resolved !== undefined ? (
        <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          → {resolved || t('trigger.fetch.resolvesNothing', 'nothing in the sample')}
        </span>
      ) : null}
    </div>
  );
}

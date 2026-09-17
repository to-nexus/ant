/**
 * The inspector's ONE name → value row editor. Headers, query parameters and
 * item fields are the same shape (a small map an author types by hand), and
 * each used to carry its own copy of the add link, the trash button and the
 * 1fr/2fr grid. `renderValue` lets a caller swap the value cell for something
 * richer (a secret-ref field, a path input) without forking the rows.
 */

import type { ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { AuroraInput } from '../../../ConfigEditor/aurora';
import { FieldHint } from '../../../ConfigEditor/aurora';
import { setRow, type KeyValueRow } from './keyValue';

export interface KeyValueRowsProps {
  rows: readonly KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  namePlaceholder: string;
  valuePlaceholder?: string;
  addLabel: string;
  removeLabel: string;
  /** Row seed when Add is pressed. */
  newRow?: KeyValueRow;
  /** A name the validator would refuse — the cell renders in error state. */
  nameInvalid?: (name: string) => boolean;
  /** Custom value cell; default is a mono text input. */
  renderValue?: (row: KeyValueRow, setValue: (value: string) => void, index: number) => ReactNode;
  /** Shown under the rows when there are none. */
  emptyHint?: string;
  /** Grid columns of name/value (the trash column is appended). Default `1fr 2fr`. */
  columns?: string;
  disabled?: boolean;
  'data-rows'?: string;
}

export const LINK_BUTTON_STYLE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--violet-500)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 11,
  fontWeight: 600,
  padding: 0,
};

const ICON_BUTTON_STYLE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-3)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  padding: 4,
  borderRadius: 6,
};

export function AddRowButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...LINK_BUTTON_STYLE, opacity: disabled ? 0.5 : 1 }}>
      <Plus size={11} /> {label}
    </button>
  );
}

export function KeyValueRows({
  rows,
  onChange,
  namePlaceholder,
  valuePlaceholder,
  addLabel,
  removeLabel,
  newRow = ['', ''],
  nameInvalid,
  renderValue,
  emptyHint,
  columns = '1fr 2fr',
  disabled,
  'data-rows': dataRows,
}: KeyValueRowsProps) {
  return (
    <div data-rows={dataRows} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((row, i) => (
        <div key={i} data-row={i} style={{ display: 'grid', gridTemplateColumns: `${columns} auto`, gap: 6, alignItems: 'start' }}>
          <AuroraInput
            mono
            value={row[0]}
            disabled={disabled}
            hasError={row[0].length > 0 && (nameInvalid?.(row[0]) ?? false)}
            placeholder={namePlaceholder}
            onChange={(v) => onChange(setRow(rows, i, { name: v }))}
          />
          {renderValue ? (
            renderValue(row, (value) => onChange(setRow(rows, i, { value })), i)
          ) : (
            <AuroraInput mono value={row[1]} disabled={disabled} placeholder={valuePlaceholder} onChange={(v) => onChange(setRow(rows, i, { value: v }))} />
          )}
          <button type="button" aria-label={removeLabel} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ ...ICON_BUTTON_STYLE, marginTop: 6 }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {rows.length === 0 && emptyHint && <FieldHint tone="muted">{emptyHint}</FieldHint>}
      <div>
        <AddRowButton label={addLabel} disabled={disabled} onClick={() => onChange([...rows, newRow])} />
      </div>
    </div>
  );
}

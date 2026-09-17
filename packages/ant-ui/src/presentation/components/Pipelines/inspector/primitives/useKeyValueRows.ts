import { useEffect, useRef, useState } from 'react';
import { recordToRows, rowsToRecord, type KeyValueRow } from './keyValue';

/**
 * Local row state over a record in the definition. Rows may hold a blank
 * name while the author types (the record cannot), so the rows are the edit
 * buffer and the record is what they commit to; an external change to the
 * record (undo, another field) re-seeds the rows.
 */
export function useKeyValueRows(record: Record<string, string | number | boolean> | undefined, commit: (next: Record<string, string> | undefined) => void): [KeyValueRow[], (rows: KeyValueRow[]) => void] {
  const [rows, setRows] = useState<KeyValueRow[]>(() => recordToRows(record));
  const lastCommitted = useRef(JSON.stringify(rowsToRecord(rows) ?? null));
  const incoming = JSON.stringify(record && Object.keys(record).length > 0 ? Object.fromEntries(Object.entries(record).map(([k, v]) => [k, String(v)])) : null);
  useEffect(() => {
    if (incoming !== lastCommitted.current) {
      setRows(recordToRows(record));
      lastCommitted.current = incoming;
    }
  }, [incoming, record]);
  const update = (next: KeyValueRow[]) => {
    setRows(next);
    const rec = rowsToRecord(next);
    lastCommitted.current = JSON.stringify(rec ?? null);
    commit(rec);
  };
  return [rows, update];
}

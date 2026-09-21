/**
 * Fan-out cases — the `<cases>` seal of a step declaring `discovers` (doc 46 §2).
 *
 * A discovering step's turn finds what needs handling by whatever its
 * definition and directive say; the ONE thing the runtime reads back is this
 * list — `key` (the case's stable business identity, the claim key) plus the
 * declared field vocabulary. Same bounds as a fetch item: the two are the same
 * per-case run, discovered by a different executor.
 */

import {
  PIPELINE_FETCH_FIELD_NAME_PATTERN,
  PIPELINE_FETCH_ITEMS_SCAN_MAX,
  PIPELINE_ITEM_FIELD_MAX_CHARS,
  PIPELINE_ITEM_KEY_PATTERN,
  type PipelineRunItem,
  type StepDiscoveryDef,
} from '@ant/shared';

/** The LAST `<cases>` of a reply is the one that counts (verdict precedent). */
const CASES_TAG = /<cases>\s*([\s\S]*?)\s*<\/cases>/gi;

export interface ParsedCases {
  cases: PipelineRunItem[];
  /** Array elements inspected (after the scan cap). */
  seen: number;
  /** Elements dropped: unusable key (missing, non-scalar, out of pattern) or duplicate key. */
  skipped: number;
  /** The tag was present but its body was not a JSON array — the step's contract is unmet. */
  error?: string;
}

function scalarText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * Parse the LAST `<cases>` tag. `undefined` = no tag at all (the fan-out's
 * `onMissing` policy decides); a present tag always yields a result — an
 * explicit `[]` is "nothing to do", a non-array body is an `error`. Element
 * shape: `{ key, fields? }`; scalar siblings of `key` outside `fields` are
 * read as fields too (a flat object is the natural way to write one).
 */
export function parseCaseNominations(text: string | undefined | null): ParsedCases | undefined {
  if (!text) return undefined;
  const matches = [...text.matchAll(CASES_TAG)];
  if (matches.length === 0) return undefined;
  const body = matches[matches.length - 1][1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { cases: [], seen: 0, skipped: 0, error: 'the <cases> body is not valid JSON' };
  }
  if (!Array.isArray(parsed)) {
    return { cases: [], seen: 0, skipped: 0, error: `the <cases> body must be a JSON array (got: ${parsed === null ? 'null' : typeof parsed})` };
  }
  const scanned = parsed.slice(0, PIPELINE_FETCH_ITEMS_SCAN_MAX);
  const cases: PipelineRunItem[] = [];
  const keys = new Set<string>();
  let skipped = 0;
  for (const raw of scanned) {
    const obj = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
    const keyValue = obj ? obj.key : raw;
    const key = typeof keyValue === 'string' || typeof keyValue === 'number' ? String(keyValue).trim() : undefined;
    if (key === undefined || !PIPELINE_ITEM_KEY_PATTERN.test(key) || keys.has(key)) {
      skipped += 1;
      continue;
    }
    keys.add(key);
    const fields: Record<string, string> = {};
    const source: Record<string, unknown> = {
      ...Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => k !== 'key' && k !== 'fields')),
      ...(obj && typeof obj.fields === 'object' && obj.fields !== null && !Array.isArray(obj.fields) ? (obj.fields as Record<string, unknown>) : {}),
    };
    for (const [name, value] of Object.entries(source)) {
      if (!PIPELINE_FETCH_FIELD_NAME_PATTERN.test(name)) continue;
      const text = scalarText(value);
      if (text === undefined) continue;
      fields[name] = text.length > PIPELINE_ITEM_FIELD_MAX_CHARS ? text.slice(0, PIPELINE_ITEM_FIELD_MAX_CHARS) : text;
    }
    cases.push(Object.keys(fields).length > 0 ? { key, fields } : { key });
  }
  return { cases, seen: scanned.length, skipped };
}

/**
 * The step's contract applied: only the DECLARED field vocabulary rides the
 * case run (an undeclared field would render nowhere and is source-shaped
 * text the author never sized for). Pure; the seal keeps what the model said.
 */
export function filterCaseFields(cases: readonly PipelineRunItem[], discovers: Pick<StepDiscoveryDef, 'fields'> | undefined): PipelineRunItem[] {
  const declared = new Set(discovers?.fields ?? []);
  return cases.map((c) => {
    if (!c.fields) return { key: c.key };
    const fields = Object.fromEntries(Object.entries(c.fields).filter(([k]) => declared.has(k)));
    return Object.keys(fields).length > 0 ? { key: c.key, fields } : { key: c.key };
  });
}

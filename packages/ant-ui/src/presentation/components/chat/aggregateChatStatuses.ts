/**
 * aggregateChatStatuses — pure, render-time coalescer for chat status cards.
 *
 * Goal: reduce the verbosity of long runs of the same tool-family status
 * card (Read, Listed, Grepped, ...) by merging adjacent slots into a
 * single expandable card. This is a presentation-only transform — the
 * underlying chat.jsonl SSOT is untouched, so live stream and replay
 * produce the identical collapsed view.
 *
 * Phase 11 chat-SSOT — operates directly on `ChatStatusLine[]` (the
 * SSOT type) instead of the legacy `MessageContent[]` envelope. The
 * input is one section's status lines; non-status items (thinking,
 * assistant_message, choice) are filtered out before this function
 * is called by the TurnItem renderer.
 *
 * Behaviour summary
 *   [read A, read B, read C]              -> Read: 3 files  (expand: A,B,C)
 *   [read A, read B, reading C]           -> Reading: 3 files + detail "In flight: C" (expand: A,B)
 *   [read A, listed X, read B]            -> 3 separate cards (non-adjacent)
 *   [read A, read B(error), read C]       -> 3 separate cards (error = boundary)
 *   [listed(pat=src), listed(pat=tests)]  -> 2 separate cards (scope mismatch)
 *
 * Non-aggregatable status types pass through unchanged (the merged
 * status type stays the same as the seed slot).
 */

import type { ChatStatusLine, ChatStatusType } from '@ant/shared';

export interface AggregatedEntry {
  /** Synthesised line — the merged metadata is attached here. */
  line: ChatStatusLine;
  originalIndex: number;
  /**
   * Number of source slots rolled into this entry. `1` for pass-through
   * entries, `>= 2` for merged aggregates. Useful for downstream renderers
   * that may want to style "this is a collapsed summary" differently —
   * WorkingCard currently derives expandability from `filesList` alone,
   * so this field is informational.
   */
  mergedCount: number;
}

// -----------------------------------------------------------------------------
// Family configuration
// -----------------------------------------------------------------------------

type FamilyKey =
  | 'read'
  | 'read_source'
  | 'list'
  | 'grep'
  | 'search_code'
  | 'retrieve'
  | 'explore';

interface FamilyConfig {
  inFlight: ChatStatusType;
  completed: ChatStatusType;
  /**
   * Scope identifiers that must match for two adjacent slots to be
   * considered mergeable. `undefined` values are treated as equal to
   * `undefined` (BE may or may not set the field). `null` and string
   * values compare by equality.
   */
  scopeKeys: readonly string[];
}

/**
 * Per-file entry preserved across aggregation. Single-shot `read` /
 * `read_source` slots carry a `(filePath, startLine, endLine, totalLines)`
 * payload in their metadata; without this richer entry shape, the
 * aggregator would collapse them to `string[]` and the expandable drawer
 * could only show paths — line ranges visible on a non-aggregated card
 * header would silently vanish the moment two reads merged. List/grep/
 * explore families that carry only paths land here as `{ path }`.
 */
interface AggregatedFileEntry {
  path: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
}

interface MergedMetadata {
  filesList: AggregatedFileEntry[]; // dedup'd file entries (path + optional line range)
  filesCount: number;        // sum of filesCount across merged slots
  totalFiles: number;        // sum of totalFiles across merged slots
  totalMatches: number;      // sum of totalMatches (searched_code)
  currentFilePath?: string;  // path being processed (trailing-progress only)
  mergedCount: number;       // number of source slots merged
}

const FAMILIES: Record<FamilyKey, FamilyConfig> = {
  read: {
    inFlight: 'reading',
    completed: 'read',
    scopeKeys: [],
  },
  read_source: {
    inFlight: 'reading_source',
    completed: 'read_source',
    scopeKeys: [],
  },
  list: {
    inFlight: 'listing_files',
    completed: 'listed_files',
    scopeKeys: ['pattern'],
  },
  grep: {
    inFlight: 'grepping',
    completed: 'grepped',
    scopeKeys: [],
  },
  search_code: {
    inFlight: 'searching_code',
    completed: 'searched_code',
    scopeKeys: [],
  },
  retrieve: {
    inFlight: 'retrieving',
    completed: 'retrieved',
    scopeKeys: [],
  },
  explore: {
    inFlight: 'exploring',
    completed: 'explored',
    scopeKeys: [],
  },
};

// Reverse lookup: ChatStatusType -> FamilyKey (undefined if non-aggregatable)
const TYPE_TO_FAMILY: Partial<Record<ChatStatusType, FamilyKey>> = {};
for (const [key, cfg] of Object.entries(FAMILIES) as Array<[FamilyKey, FamilyConfig]>) {
  TYPE_TO_FAMILY[cfg.inFlight] = key;
  TYPE_TO_FAMILY[cfg.completed] = key;
}

function familyOf(type: ChatStatusType): FamilyKey | undefined {
  return TYPE_TO_FAMILY[type];
}

function isCompleted(family: FamilyKey, type: ChatStatusType): boolean {
  return FAMILIES[family].completed === type;
}

// -----------------------------------------------------------------------------
// Merge state — one instance per open bucket in the output list
// -----------------------------------------------------------------------------

interface BucketState {
  family: FamilyKey;
  outIndex: number;          // position in the output array
  originalIndex: number;     // first source slot's index (for React key stability)
  seedLine: ChatStatusLine;  // captured to preserve identity fields (cardId / ts / turnId)
  merged: MergedMetadata;
  // Scope lock — captured from the first slot and enforced on subsequent
  // merges. Scope value of `undefined` is a valid lock (match only other
  // undefined slots) to avoid accidentally merging "no pattern" with
  // "pattern=foo" buckets.
  scope: Record<string, unknown>;
  // Was the last observed slot a completed state? Determines the state
  // of the output card. Flipped to `false` when a trailing progress slot
  // is absorbed.
  lastWasCompleted: boolean;
}

function makeEmptyMerged(): MergedMetadata {
  return {
    filesList: [],
    filesCount: 0,
    totalFiles: 0,
    totalMatches: 0,
    mergedCount: 0,
  };
}

function captureScope(
  line: ChatStatusLine,
  scopeKeys: readonly string[],
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  const meta = line.metadata as Record<string, unknown> | undefined;
  for (const key of scopeKeys) {
    scope[key] = meta?.[key];
  }
  return scope;
}

function scopeMatches(
  bucket: BucketState,
  line: ChatStatusLine,
): boolean {
  const cfg = FAMILIES[bucket.family];
  const meta = line.metadata as Record<string, unknown> | undefined;
  for (const key of cfg.scopeKeys) {
    if (bucket.scope[key] !== meta?.[key]) return false;
  }
  return true;
}

function hasError(line: ChatStatusLine): boolean {
  return !!(line.metadata && (line.metadata as { error?: unknown }).error);
}

function pushUniqueFileEntry(
  list: AggregatedFileEntry[],
  entry: AggregatedFileEntry | undefined,
): void {
  if (!entry || !entry.path) return;
  // Dedup on path; if the same path arrives again with a different line
  // range we keep the first (chronologically earliest) entry — replay
  // semantics match `selectTurns.foldSection`'s last-write-wins for status
  // cards, but line ranges within an aggregation usually identify
  // distinct slices of the same file, so first-write keeps the most
  // representative one. Callers normalise BE metadata into entries.
  if (list.some((e) => e.path === entry.path)) return;
  list.push(entry);
}

function pushUniqueFileEntries(
  list: AggregatedFileEntry[],
  add: ReadonlyArray<string | AggregatedFileEntry> | undefined,
): void {
  if (!add || add.length === 0) return;
  for (const item of add) {
    if (typeof item === 'string') {
      pushUniqueFileEntry(list, { path: item });
    } else if (item && typeof item === 'object' && typeof item.path === 'string') {
      pushUniqueFileEntry(list, item);
    }
  }
}

/**
 * Build the rendered ChatStatusLine for a bucket given its current state.
 *
 * Aggregate cards override `statusType` and rebuild `metadata` — the
 * underlying source slot's original values are intentionally replaced by
 * the merged summary view. Single-slot buckets (pass-through) are never
 * rebuilt and keep the BE-authored line verbatim, preserving SSOT for
 * the common case.
 */
function renderBucketLine(bucket: BucketState): ChatStatusLine {
  const cfg = FAMILIES[bucket.family];
  const statusType = bucket.lastWasCompleted ? cfg.completed : cfg.inFlight;

  const metadata: Record<string, unknown> = {
    ...bucket.scope,
    filesList: [...bucket.merged.filesList],
    filesCount: bucket.merged.filesCount,
    totalFiles: bucket.merged.totalFiles,
  };
  if (bucket.family === 'search_code') {
    metadata.totalMatches = bucket.merged.totalMatches;
  }
  if (!bucket.lastWasCompleted && bucket.merged.currentFilePath) {
    metadata.currentFilePath = bucket.merged.currentFilePath;
    metadata.detail = `In flight: ${bucket.merged.currentFilePath}`;
  }
  // Mark this line as an aggregated summary — downstream renderers
  // (e.g. WorkingCard) can read this if they need to differentiate.
  metadata.aggregated = true;
  metadata.aggregatedCount = bucket.merged.mergedCount;

  return {
    ...bucket.seedLine,
    statusType,
    metadata,
  };
}

/**
 * Absorb a ChatStatusLine into an existing bucket. The bucket's
 * scope and family have already been verified to match.
 */
function mergeInto(bucket: BucketState, line: ChatStatusLine): void {
  const meta = line.metadata as Record<string, unknown> | undefined;
  const family = bucket.family;
  const completedNow = isCompleted(family, line.statusType);

  bucket.merged.mergedCount += 1;

  // Completed slot -> push its path (if any) to the dedup'd file list.
  if (completedNow) {
    // filePath + optional line range from read / read_source.
    const filePath = meta?.filePath as string | undefined;
    if (filePath) {
      pushUniqueFileEntry(bucket.merged.filesList, {
        path: filePath,
        startLine: meta?.startLine as number | undefined,
        endLine: meta?.endLine as number | undefined,
        totalLines: meta?.totalLines as number | undefined,
      });
    }

    // filesList may also be carried by list/grep/search/explore etc.
    // Accept both legacy `string[]` shape and the new entry shape so
    // upstream tools can opt into richer entries incrementally.
    const incomingList = meta?.filesList as ReadonlyArray<string | AggregatedFileEntry> | undefined;
    pushUniqueFileEntries(bucket.merged.filesList, incomingList);

    // Count/stat summation for list-like families. For read/read_source,
    // BE does not populate filesCount per call, so filesList.length is
    // the authoritative count (see renderBucketLine).
    const incomingFilesCount = (meta?.filesCount as number | undefined) ?? 0;
    const incomingTotalFiles = (meta?.totalFiles as number | undefined) ?? 0;
    const incomingMatches = (meta?.totalMatches as number | undefined) ?? 0;
    if (family === 'read' || family === 'read_source') {
      bucket.merged.filesCount = bucket.merged.filesList.length;
    } else {
      bucket.merged.filesCount += incomingFilesCount;
      bucket.merged.totalFiles += incomingTotalFiles;
      bucket.merged.totalMatches += incomingMatches;
    }

    bucket.merged.currentFilePath = undefined;
    bucket.lastWasCompleted = true;
    return;
  }

  // In-flight slot -> capture the file path as "currently in flight"
  // without promoting it to filesList yet. Keeps the drawer showing only
  // confirmed completions.
  const filePath = meta?.filePath as string | undefined;
  bucket.merged.currentFilePath = filePath;

  // Some in-flight types carry progress counts (e.g. exploring supplies
  // filesCount/totalFiles snapshots). Prefer the latest snapshot over
  // summation to avoid double-counting progress noise.
  const snapFilesCount = meta?.filesCount as number | undefined;
  const snapTotalFiles = meta?.totalFiles as number | undefined;
  if (typeof snapFilesCount === 'number' && bucket.merged.filesCount < snapFilesCount) {
    bucket.merged.filesCount = snapFilesCount;
  }
  if (typeof snapTotalFiles === 'number' && bucket.merged.totalFiles < snapTotalFiles) {
    bucket.merged.totalFiles = snapTotalFiles;
  }

  bucket.lastWasCompleted = false;
}

// -----------------------------------------------------------------------------
// Public entry
// -----------------------------------------------------------------------------

/**
 * Collapse adjacent same-family chat status lines into aggregated entries.
 *
 * Guarantees:
 * - Pure: no mutation of input lines or their `metadata` objects.
 * - Order-preserving: non-mergeable slots retain their original position.
 * - Stable React keys: each output entry exposes the `originalIndex` of
 *   the first source slot it represents.
 * - Error-safe: any line carrying `metadata.error` is a boundary and
 *   passes through unchanged.
 */
export function aggregateChatStatuses(
  lines: ChatStatusLine[],
): AggregatedEntry[] {
  const out: AggregatedEntry[] = [];
  let bucket: BucketState | null = null;

  // The inline merge path re-renders `out[bucket.outIndex]` on every
  // absorbed slot, so closing a bucket is just a state reset.
  const closeBucket = () => {
    bucket = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Error slot: boundary + pass-through.
    if (hasError(line)) {
      closeBucket();
      out.push({ line, originalIndex: i, mergedCount: 1 });
      continue;
    }

    const family = familyOf(line.statusType);
    if (!family) {
      closeBucket();
      out.push({ line, originalIndex: i, mergedCount: 1 });
      continue;
    }

    // Same family as open bucket AND scope matches -> merge.
    if (bucket && bucket.family === family && scopeMatches(bucket, line)) {
      mergeInto(bucket, line);
      // Re-render the aggregate entry at its position.
      out[bucket.outIndex] = {
        line: renderBucketLine(bucket),
        originalIndex: bucket.originalIndex,
        mergedCount: bucket.merged.mergedCount,
      };
      continue;
    }

    // Different family or no open bucket -> start a new bucket for this
    // family, seeded by the current line. Push the original line as-is;
    // it is only replaced by `renderBucketLine` once a second slot
    // actually merges in (see the merge branch above).
    closeBucket();

    const cfg = FAMILIES[family];
    const newBucket: BucketState = {
      family,
      outIndex: out.length,
      originalIndex: i,
      seedLine: line,
      merged: makeEmptyMerged(),
      scope: captureScope(line, cfg.scopeKeys),
      lastWasCompleted: isCompleted(family, line.statusType),
    };
    mergeInto(newBucket, line); // seeds filesList / counts from slot 0
    bucket = newBucket;

    out.push({ line, originalIndex: i, mergedCount: 1 });
  }

  return out;
}

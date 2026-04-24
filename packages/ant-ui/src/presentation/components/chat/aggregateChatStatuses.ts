/**
 * aggregateChatStatuses — pure, render-time coalescer for chat status cards.
 *
 * Goal: reduce the verbosity of long runs of the same tool-family status
 * card (Read, Listed, Grepped, ...) by merging adjacent slots into a
 * single expandable card. This is a presentation-only transform — the
 * underlying `MessageContent[]` (and `chat.jsonl`) is untouched, so live
 * stream and replay produce the identical collapsed view.
 *
 * Behaviour summary
 *   [read A, read B, read C]              -> Read: 3 files  (expand: A,B,C)
 *   [read A, read B, reading C]           -> Reading: 3 files + detail "In flight: C" (expand: A,B)
 *   [read A, listed X, read B]            -> 3 separate cards (non-adjacent)
 *   [read A, read B(error), read C]       -> 3 separate cards (error = boundary)
 *   [listed(pat=src), listed(pat=tests)]  -> 2 separate cards (scope mismatch)
 *
 * Non-aggregatable content types pass through unchanged.
 *
 * See the parent plan for the rationale of the FE-only merge strategy.
 */

import type { MessageContent, MessageContentType } from '@/domain/models/chat';

export interface AggregatedEntry {
  content: MessageContent;
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
  inFlight: MessageContentType;
  completed: MessageContentType;
  /**
   * Scope identifiers that must match for two adjacent slots to be
   * considered mergeable. `undefined` values are treated as equal to
   * `undefined` (BE may or may not set the field). `null` and string
   * values compare by equality.
   */
  scopeKeys: readonly string[];
  /** Label for completed aggregate card. */
  formatCompleted: (merged: MergedMetadata, scope: Scope) => string;
  /** Label for in-flight aggregate card (trailing-progress). */
  formatInFlight: (merged: MergedMetadata, scope: Scope) => string;
}

type Scope = Record<string, unknown>;

interface MergedMetadata {
  filesList: string[];       // dedup'd file paths collected so far
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
    formatCompleted: (m) => `Read: ${m.filesList.length || m.mergedCount} files`,
    formatInFlight: (m) => `Reading: ${m.filesList.length + 1} files`,
  },
  read_source: {
    inFlight: 'reading_source',
    completed: 'read_source',
    scopeKeys: [],
    formatCompleted: (m) => `Read source: ${m.filesList.length || m.mergedCount} files`,
    formatInFlight: (m) => `Reading source: ${m.filesList.length + 1} files`,
  },
  list: {
    inFlight: 'listing_files',
    completed: 'listed_files',
    scopeKeys: ['pattern'],
    formatCompleted: (m, s) => {
      const base = `Listed: ${m.filesCount}/${m.totalFiles} files`;
      return s.pattern ? `${base} (${s.pattern})` : base;
    },
    formatInFlight: (m, s) => {
      const suffix = s.pattern ? ` (${s.pattern})` : '';
      if (m.filesCount > 0) {
        return `📂 Listing files${suffix}: ${m.filesCount}/${m.totalFiles} so far...`;
      }
      return `📂 Listing files${suffix}...`;
    },
  },
  grep: {
    inFlight: 'grepping',
    completed: 'grepped',
    scopeKeys: [],
    formatCompleted: (m) => `Grepped: ${m.filesCount} files`,
    formatInFlight: (m) =>
      m.filesCount > 0
        ? `Searching local files: ${m.filesCount} files so far...`
        : 'Searching local files...',
  },
  search_code: {
    inFlight: 'searching_code',
    completed: 'searched_code',
    scopeKeys: [],
    formatCompleted: (m) =>
      m.totalMatches > 0
        ? `Found: ${m.totalMatches} matches in ${m.filesCount} files`
        : `Found: ${m.filesCount} files`,
    formatInFlight: () => '🔍 Searching code...',
  },
  retrieve: {
    inFlight: 'retrieving',
    completed: 'retrieved',
    scopeKeys: [],
    formatCompleted: (m) => `Retrieved: ${m.filesCount} files from Vector DB`,
    formatInFlight: () => 'Retrieving from Vector DB...',
  },
  explore: {
    inFlight: 'exploring',
    completed: 'explored',
    scopeKeys: [],
    formatCompleted: (m) => `Explored: ${m.filesCount} files with uncommitted changes`,
    formatInFlight: (m) =>
      m.filesCount > 0
        ? `Exploring: ${m.filesCount}/${m.totalFiles} files`
        : 'Exploring: codebase...',
  },
};

// Reverse lookup: MessageContentType -> FamilyKey (null if non-aggregatable)
const TYPE_TO_FAMILY: Partial<Record<MessageContentType, FamilyKey>> = {};
for (const [key, cfg] of Object.entries(FAMILIES) as Array<[FamilyKey, FamilyConfig]>) {
  TYPE_TO_FAMILY[cfg.inFlight] = key;
  TYPE_TO_FAMILY[cfg.completed] = key;
}

function familyOf(type: MessageContentType): FamilyKey | undefined {
  return TYPE_TO_FAMILY[type];
}

function isCompleted(family: FamilyKey, type: MessageContentType): boolean {
  return FAMILIES[family].completed === type;
}

// -----------------------------------------------------------------------------
// Merge state — one instance per open bucket in the output list
// -----------------------------------------------------------------------------

interface BucketState {
  family: FamilyKey;
  outIndex: number;          // position in the output array
  originalIndex: number;     // first source slot's index (for React key stability)
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
  content: MessageContent,
  scopeKeys: readonly string[],
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  const meta = content.metadata as Record<string, unknown> | undefined;
  for (const key of scopeKeys) {
    scope[key] = meta?.[key];
  }
  return scope;
}

function scopeMatches(
  bucket: BucketState,
  content: MessageContent,
): boolean {
  const cfg = FAMILIES[bucket.family];
  const meta = content.metadata as Record<string, unknown> | undefined;
  for (const key of cfg.scopeKeys) {
    if (bucket.scope[key] !== meta?.[key]) return false;
  }
  return true;
}

function hasError(content: MessageContent): boolean {
  return !!(content.metadata && (content.metadata as { error?: unknown }).error);
}

function pushUniqueFilePath(list: string[], path: string | undefined): void {
  if (!path) return;
  if (list.includes(path)) return;
  list.push(path);
}

function pushUniqueFilePaths(list: string[], add: string[] | undefined): void {
  if (!add || add.length === 0) return;
  for (const path of add) pushUniqueFilePath(list, path);
}

/**
 * Build the rendered MessageContent for a bucket given its current state.
 *
 * Aggregate cards override `content`/`type`/`metadata` — the underlying
 * source slot's original values are intentionally replaced by the merged
 * summary view. Single-slot buckets (pass-through) are never rebuilt and
 * keep the BE-authored `content` verbatim, preserving SSOT for the common
 * case.
 */
function renderBucketContent(bucket: BucketState): MessageContent {
  const cfg = FAMILIES[bucket.family];
  const type = bucket.lastWasCompleted ? cfg.completed : cfg.inFlight;
  const format = bucket.lastWasCompleted
    ? cfg.formatCompleted
    : cfg.formatInFlight;

  const text = format(bucket.merged, bucket.scope);

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
  // Mark this content as an aggregated summary — downstream renderers
  // (e.g. WorkingCard) can read this if they need to differentiate.
  metadata.aggregated = true;
  metadata.aggregatedCount = bucket.merged.mergedCount;

  return {
    type: type as MessageContent['type'],
    content: text,
    metadata: metadata as MessageContent['metadata'],
  };
}

/**
 * Absorb a MessageContent slot into an existing bucket. The bucket's
 * scope and family have already been verified to match.
 */
function mergeInto(bucket: BucketState, content: MessageContent): void {
  const meta = content.metadata as Record<string, unknown> | undefined;
  const family = bucket.family;
  const completedNow = isCompleted(family, content.type);

  bucket.merged.mergedCount += 1;

  // Completed slot -> push its path (if any) to the dedup'd file list.
  if (completedNow) {
    // filePath from read / read_source
    const filePath = meta?.filePath as string | undefined;
    pushUniqueFilePath(bucket.merged.filesList, filePath);

    // filesList may also be carried by list/grep/search/explore etc.
    const incomingList = meta?.filesList as string[] | undefined;
    pushUniqueFilePaths(bucket.merged.filesList, incomingList);

    // Count/stat summation for list-like families. For read/read_source,
    // BE does not populate filesCount per call, so filesList.length is
    // the authoritative count (see renderBucketContent).
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
 * Collapse adjacent same-family chat status slots into aggregated cards.
 *
 * Guarantees:
 * - Pure: no mutation of input `MessageContent[]` or their `metadata` objects.
 * - Order-preserving: non-mergeable slots retain their original position.
 * - Stable React keys: each output entry exposes the `originalIndex` of
 *   the first source slot it represents.
 * - Error-safe: any slot carrying `metadata.error` is a boundary and
 *   passes through unchanged.
 */
export function aggregateChatStatuses(
  contents: MessageContent[],
): AggregatedEntry[] {
  const out: AggregatedEntry[] = [];
  let bucket: BucketState | null = null;

  // The inline merge path re-renders `out[bucket.outIndex]` on every
  // absorbed slot, so closing a bucket is just a state reset.
  const closeBucket = () => {
    bucket = null;
  };

  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];
    if (!content) continue;

    // Error / cancelled slot: boundary + pass-through.
    if (content.type === 'cancelled' || hasError(content)) {
      closeBucket();
      out.push({ content, originalIndex: i, mergedCount: 1 });
      continue;
    }

    const family = familyOf(content.type);
    if (!family) {
      closeBucket();
      out.push({ content, originalIndex: i, mergedCount: 1 });
      continue;
    }

    // Same family as open bucket AND scope matches -> merge.
    if (bucket && bucket.family === family && scopeMatches(bucket, content)) {
      mergeInto(bucket, content);
      // Re-render the aggregate entry at its position.
      out[bucket.outIndex] = {
        content: renderBucketContent(bucket),
        originalIndex: bucket.originalIndex,
        mergedCount: bucket.merged.mergedCount,
      };
      continue;
    }

    // Different family or no open bucket -> start a new bucket for this
    // family, seeded by the current slot. Push the original content as-is;
    // it is only replaced by `renderBucketContent` once a second slot
    // actually merges in (see the merge branch above).
    closeBucket();

    const cfg = FAMILIES[family];
    const newBucket: BucketState = {
      family,
      outIndex: out.length,
      originalIndex: i,
      merged: makeEmptyMerged(),
      scope: captureScope(content, cfg.scopeKeys),
      lastWasCompleted: isCompleted(family, content.type),
    };
    mergeInto(newBucket, content); // seeds filesList / counts from slot 0
    bucket = newBucket;

    out.push({ content, originalIndex: i, mergedCount: 1 });
  }

  return out;
}

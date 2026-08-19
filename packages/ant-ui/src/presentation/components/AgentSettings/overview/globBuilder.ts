/**
 * Artifact-glob model for the hook editor — pure and React-free so the
 * raw ⇄ builder round-trip and the natural-language description are testable
 * without a DOM. The hook entry's raw glob string stays the SSOT
 * (`validateStopHookEntry` from @ant/shared is the validation authority);
 * this module only projects it into editable parts and a human-readable
 * preview.
 *
 * Two projections, one string:
 *   • `splitGlob ⇄ joinGlob` — the editor's shape: ONE location (root / a
 *     nested folder path / `*` / `**`) + ONE file name. A deep directory is
 *     typed as a path in a single field, never as one control per level.
 *   • `parseGlob ⇄ composeGlob` — the per-segment view the description and
 *     the segment-level charset rules are built on.
 */

import { ARTIFACT_GLOB_CHARSET } from '@ant/shared';

export type GlobSegment =
  | { kind: 'globstar' } // '**' — any depth (whole segment only)
  | { kind: 'any' } // '*' — exactly one path segment, any name
  | { kind: 'pattern'; text: string }; // literal or mixed (e.g. '*-weekly.md')

/** Total: any raw string round-trips (`composeGlob(parseGlob(raw)) === raw`). */
export function parseGlob(raw: string): GlobSegment[] {
  return raw.split('/').map((s): GlobSegment => {
    if (s === '**') return { kind: 'globstar' };
    if (s === '*') return { kind: 'any' };
    return { kind: 'pattern', text: s };
  });
}

export function composeGlob(segments: readonly GlobSegment[]): string {
  return segments
    .map((s) => (s.kind === 'globstar' ? '**' : s.kind === 'any' ? '*' : s.text))
    .join('/');
}

/** Per-segment slice of the shared H3/H5 rules — for painting the offending chip red. */
export function isSegmentValid(segment: GlobSegment): boolean {
  if (segment.kind !== 'pattern') return true;
  const { text } = segment;
  if (text === '' || text === '.' || text === '..') return false;
  if (text.includes('**')) return false; // '**' must stand as a whole segment
  return ARTIFACT_GLOB_CHARSET.test(text);
}

// ── editor projection: location + file name ──────────────────────────────────

/**
 * Where the file must land. `folder` carries a nested path in ONE value
 * (`a/b/c`); `root` is the artifact root, and it is a first-class choice in
 * the same picker rather than "delete every folder chip".
 */
export type GlobLocationKind = 'root' | 'folder' | 'any' | 'anyDepth';

export interface GlobParts {
  location: GlobLocationKind;
  /** Folder path, possibly nested. Meaningful only for `location === 'folder'`. */
  dir: string;
  /** Last path segment — the file-name pattern. */
  file: string;
}

/** Total: every raw string splits (the last `/` divides folders from the name). */
export function splitGlob(raw: string): GlobParts {
  const cut = raw.lastIndexOf('/');
  if (cut < 0) return { location: 'root', dir: '', file: raw };
  const dir = raw.slice(0, cut);
  const file = raw.slice(cut + 1);
  if (dir === '*') return { location: 'any', dir: '', file };
  if (dir === '**') return { location: 'anyDepth', dir: '', file };
  return { location: 'folder', dir, file };
}

/**
 * Compose the parts back into a glob. A `folder` location whose path is still
 * empty composes as root rather than as the invalid `/name` — the picker keeps
 * showing the folder field (that state lives in the component), so clearing the
 * path never yields a value the validator has to reject.
 */
export function joinGlob({ location, dir, file }: GlobParts): string {
  if (location === 'any') return `*/${file}`;
  if (location === 'anyDepth') return `**/${file}`;
  if (location === 'folder') {
    const path = dir.replace(/^\/+|\/+$/g, '');
    return path === '' ? file : `${path}/${file}`;
  }
  return file;
}

/** One typed segment: the `*` / `**` tokens stand whole, anything else is a pattern. */
function isTypedSegmentValid(text: string): boolean {
  if (text === '*' || text === '**') return true;
  return isSegmentValid({ kind: 'pattern', text });
}

/**
 * Folder-path field validity — empty is "not typed yet", never red. A nested
 * path is judged segment by segment, so a whole `**` level passes while a
 * segment like `x**y` does not.
 */
export function isDirPathValid(dir: string): boolean {
  if (dir === '') return true;
  return dir.split('/').every(isTypedSegmentValid);
}

/** File-name field validity — empty is "not typed yet", `*` / `**` are tokens. */
export function isFileNameValid(file: string): boolean {
  if (file === '') return true;
  return isTypedSegmentValid(file);
}

// ── natural-language description ─────────────────────────────────────────────

export type GlobFileDesc =
  | { kind: 'any-name' } // '*'
  | { kind: 'any-depth' } // trailing '**'
  | { kind: 'exact'; name: string }
  | { kind: 'ends-with'; suffix: string }
  | { kind: 'starts-with'; prefix: string }
  | { kind: 'starts-ends'; prefix: string; suffix: string }
  | { kind: 'matching'; pattern: string };

export type GlobDirDesc = { kind: 'literal'; name: string } | { kind: 'any' } | { kind: 'globstar' };

export type GlobDescription =
  | { kind: 'empty' }
  | { kind: 'any-file-anywhere' } // the bare '**'
  | { kind: 'located'; dirs: GlobDirDesc[]; file: GlobFileDesc };

function describeFileSegment(segment: GlobSegment): GlobFileDesc {
  if (segment.kind === 'globstar') return { kind: 'any-depth' };
  if (segment.kind === 'any') return { kind: 'any-name' };
  const { text } = segment;
  const stars = text.split('*').length - 1;
  if (stars === 0) return { kind: 'exact', name: text };
  if (stars > 1) return { kind: 'matching', pattern: text };
  const [prefix, suffix] = text.split('*');
  if (prefix === '') return { kind: 'ends-with', suffix };
  if (suffix === '') return { kind: 'starts-with', prefix };
  return { kind: 'starts-ends', prefix, suffix };
}

/**
 * Structured description of what the glob matches — the component renders it
 * through i18n (so e.g. the Korean word order stays natural), tests assert
 * the structure directly.
 */
export function describeGlob(raw: string): GlobDescription {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  if (trimmed === '**') return { kind: 'any-file-anywhere' };
  const segments = parseGlob(trimmed);
  const file = describeFileSegment(segments[segments.length - 1]);
  const dirs = segments.slice(0, -1).map((s): GlobDirDesc => {
    if (s.kind === 'globstar') return { kind: 'globstar' };
    if (s.kind === 'any') return { kind: 'any' };
    return { kind: 'literal', name: s.text };
  });
  return { kind: 'located', dirs, file };
}

/** Preset examples offered as one-click chips (each passes the shared validator). */
export const GLOB_PRESETS = ['reports/*-weekly.md', 'output/**', 'docs/*.md', '**'] as const;

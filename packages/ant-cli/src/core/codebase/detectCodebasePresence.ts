/**
 * detectCodebasePresence — filesystem SSOT for "does this codebase root hold a
 * real project?".
 *
 * Manifest-based: a depth-1 dependency/build manifest (or workspace marker)
 * must be present. A folder with only `README.md`/notes — or an empty folder —
 * is NOT a codebase. Path-only (never reads file bodies). The pure decision
 * lives in `@ant/shared`'s {@link containsCodebaseManifest}; this wrapper only
 * supplies the directory listing.
 *
 * Single source consumed by both `WorkspaceState.hasCodebase`
 * (triage/workspaceAnalyzer) and `GitSnapshot.hasCodebase` (GitService).
 */

import * as fs from 'fs';
import { containsCodebaseManifest } from '@ant/shared';

/**
 * @param codebaseAbs Absolute path to the codebase root (e.g. `<feature>/codebase`).
 * @returns `true` iff a recognized manifest exists at depth 1.
 */
export function detectCodebasePresence(codebaseAbs: string): boolean {
  if (!fs.existsSync(codebaseAbs)) return false;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(codebaseAbs, { withFileTypes: true });
  } catch {
    return false;
  }

  return containsCodebaseManifest(
    entries.filter(e => !e.name.startsWith('.')).map(e => e.name),
  );
}

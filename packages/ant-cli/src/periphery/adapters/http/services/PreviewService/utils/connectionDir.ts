/**
 * Connection `source` → package directory resolution.
 *
 * `ServiceConnection.source` is the monorepo subdirectory a connection belongs
 * to (`'apps/web'`, or `'*'` for workspace-global). It arrives from the preview
 * config panel — i.e. it is user input — and is then joined onto the workspace
 * root to locate the `.env` / `.env.example` this service writes. Joining it
 * unchecked lets a `../`-bearing source steer those writes at another
 * workspace, so every join goes through here.
 */

import * as path from 'path';

import { assertWithinRoot } from '../../../../../../core/config/pathContainment';

/**
 * Resolve the package directory a connection's `source` designates.
 *
 * @returns the absolute directory
 * @throws when `source` is absolute or escapes `workspaceRoot`
 */
export function resolveConnectionDir(workspaceRoot: string, source?: string): string {
  const root = path.resolve(workspaceRoot);
  if (!source || source === '*') return root;

  // Kept ahead of the SSOT guard: `assertWithinRoot` accepts an absolute path
  // that happens to sit inside the root, but no legitimate connection source is
  // ever absolute.
  if (path.isAbsolute(source)) {
    throw new Error(`Invalid connection source (absolute path): ${JSON.stringify(source)}`);
  }

  // The containment SSOT walks up to the nearest EXISTING ancestor. The local
  // check this replaced only realpath'd a target that already existed, so
  // `jump/new-package` under an escaping symlink passed — and the writers then
  // created the directory and its `.env` outside the workspace (H-003).
  try {
    return assertWithinRoot(root, source);
  } catch {
    throw new Error(`Invalid connection source (escapes workspace): ${JSON.stringify(source)}`);
  }
}

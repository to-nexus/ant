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

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve the package directory a connection's `source` designates.
 *
 * @returns the absolute directory
 * @throws when `source` is absolute or escapes `workspaceRoot`
 */
export function resolveConnectionDir(workspaceRoot: string, source?: string): string {
  const root = path.resolve(workspaceRoot);
  if (!source || source === '*') return root;

  if (path.isAbsolute(source)) {
    throw new Error(`Invalid connection source (absolute path): ${JSON.stringify(source)}`);
  }

  const target = path.resolve(root, source);
  const rel = path.relative(root, target);
  if (rel !== '' && (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel))) {
    throw new Error(`Invalid connection source (escapes workspace): ${JSON.stringify(source)}`);
  }

  // An existing directory could still be a symlink out of the workspace.
  try {
    if (fs.existsSync(target)) {
      const realRel = path.relative(fs.realpathSync(root), fs.realpathSync(target));
      if (realRel !== '' && (realRel.startsWith('..' + path.sep) || realRel === '..' || path.isAbsolute(realRel))) {
        throw new Error(`Invalid connection source (symlink escapes workspace): ${JSON.stringify(source)}`);
      }
    }
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.startsWith('Invalid connection source')) throw err;
    // realpath failure on a transient path — the string check above already held
  }

  return target;
}

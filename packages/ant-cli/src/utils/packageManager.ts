import * as fs from 'fs';
import * as path from 'path';

export type PackageManager = 'pnpm' | 'yarn' | 'npm';

/**
 * Detect the package manager for a directory by lockfile presence.
 * Falls back to npm when no lockfile is found.
 */
export function detectPackageManager(dir: string): PackageManager {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Climb parent directories from `startDir` to the workspace root, identified
 * by `pnpm-workspace.yaml`, a lockfile, or a `package.json` with `workspaces`.
 * Falls back to `startDir` when no marker is found.
 *
 * Detecting the package manager at the root (not at a sub-package dir, which
 * has no lockfile) is what lets `detectPackageManager(findProjectRoot(dir))`
 * pick `pnpm` for a workspace member instead of falling back to `npm` — npm
 * cannot resolve the `workspace:*` protocol.
 */
export function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    if (
      fs.existsSync(path.join(current, 'pnpm-lock.yaml')) ||
      fs.existsSync(path.join(current, 'yarn.lock')) ||
      fs.existsSync(path.join(current, 'package-lock.json'))
    ) {
      return current;
    }
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces) return current;
      } catch {
        // ignore malformed package.json
      }
    }
    current = path.dirname(current);
  }
  return startDir;
}

/**
 * Build the dependency-install invocation for preview (dev server) and deploy
 * (production build) alike.
 *
 * Invariant: the install MUST always include devDependencies, independent of
 * NODE_ENV. The preview dev server (`next dev` / `vite`) needs them at runtime,
 * and the deploy build (`next build`) needs them at build time. The cloud
 * process inherits NODE_ENV=production, so each package manager is given its
 * explicit force-dev flag rather than relying on NODE_ENV.
 */
export interface InstallCommandOptions {
  /**
   * Skip every dependency and project lifecycle script (`preinstall`,
   * `install`, `postinstall`, `prepare`).
   *
   * This is what makes a credential-bearing install safe: the pass that holds a
   * user's GitHub PAT (as `GIT_CONFIG_KEY_0`) fetches and links the tree and
   * runs no attacker-authored code, and a second, credential-free pass runs the
   * lifecycle (M-NEW-001). See `runCredentialSafeInstall`.
   */
  ignoreScripts?: boolean;
}

export function buildInstallCommand(
  pm: PackageManager,
  opts: InstallCommandOptions = {},
): { command: string; args: string[] } {
  const ignore = opts.ignoreScripts ? ['--ignore-scripts'] : [];
  switch (pm) {
    case 'pnpm':
      return {
        command: 'pnpm',
        args: ['install', '--prod=false', '--config.confirm-modules-purge=false', ...ignore],
      };
    case 'yarn':
      return { command: 'yarn', args: ['install', '--production=false', ...ignore] };
    case 'npm':
      return { command: 'npm', args: ['install', '--include=dev', ...ignore] };
  }
}

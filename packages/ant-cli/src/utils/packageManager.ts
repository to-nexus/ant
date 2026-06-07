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
 * Build the dependency-install invocation for preview (dev server) and deploy
 * (production build) alike.
 *
 * Invariant: the install MUST always include devDependencies, independent of
 * NODE_ENV. The preview dev server (`next dev` / `vite`) needs them at runtime,
 * and the deploy build (`next build`) needs them at build time. The cloud
 * process inherits NODE_ENV=production, so each package manager is given its
 * explicit force-dev flag rather than relying on NODE_ENV.
 */
export function buildInstallCommand(pm: PackageManager): { command: string; args: string[] } {
  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', args: ['install', '--prod=false', '--config.confirm-modules-purge=false'] };
    case 'yarn':
      return { command: 'yarn', args: ['install', '--production=false'] };
    case 'npm':
      return { command: 'npm', args: ['install', '--include=dev'] };
  }
}

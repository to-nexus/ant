/**
 * Package manager detection — SSOT.
 * BuildRunner / PreviewService / CodebaseAnalyzer keep their own variants
 * (different return shapes, non-Node scopes).
 */

import * as path from 'path';
import * as fs from 'fs';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export async function detectPackageManager(
  featureRootPath: string,
): Promise<PackageManager | null> {
  const codebasePath = path.join(featureRootPath, 'codebase');
  try {
    const files = await fs.promises.readdir(codebasePath);
    if (files.includes('pnpm-lock.yaml')) return 'pnpm';
    if (files.includes('yarn.lock')) return 'yarn';
    if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun';
    if (files.includes('package-lock.json')) return 'npm';

    const pkgPath = path.join(codebasePath, 'package.json');
    try {
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));
      if (pkg.packageManager) {
        const pm = pkg.packageManager as string;
        if (pm.startsWith('pnpm')) return 'pnpm';
        if (pm.startsWith('yarn')) return 'yarn';
        if (pm.startsWith('bun')) return 'bun';
        if (pm.startsWith('npm')) return 'npm';
      }
    } catch {}
  } catch {}
  return null;
}

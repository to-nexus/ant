/**
 * BuildRunner
 * 
 * Detects project framework, injects base path, and runs production build.
 * Supports: Vite, CRA, Next.js, generic static.
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import type { DeployFramework } from '../../core/ports/portRegistry';
import { detectPackageManager, buildInstallCommand, findProjectRoot } from '../../utils/packageManager';

export interface BuildResult {
  success: boolean;
  framework: DeployFramework;
  outputDir: string;
  error?: string;
  logs: string[];
}

/**
 * Detect the frontend framework by inspecting package.json dependencies.
 */
export function detectFramework(workspacePath: string): DeployFramework {
  const pkgPath = path.join(workspacePath, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'static';

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['next']) return 'nextjs';
    if (deps['vite']) return 'vite';
    if (deps['react-scripts']) return 'cra';

    // Fallback: check for build script
    if (pkg.scripts?.build) return 'unknown';
    return 'static';
  } catch {
    return 'static';
  }
}

/**
 * Resolve expected build output directory for each framework.
 */
export function getBuildOutputDir(workspacePath: string, framework: DeployFramework): string {
  switch (framework) {
    case 'vite': return path.join(workspacePath, 'dist');
    case 'cra': return path.join(workspacePath, 'build');
    case 'nextjs': return path.join(workspacePath, '.next');
    default: {
      // Check common output dirs
      const candidates = ['dist', 'build', 'out', 'public'];
      for (const dir of candidates) {
        const full = path.join(workspacePath, dir);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
      }
      return path.join(workspacePath, 'dist');
    }
  }
}

/**
 * Build environment variables for base path injection.
 */
function buildEnvWithBasePath(basePath: string, framework: DeployFramework): Record<string, string> {
  const env: Record<string, string> = {};

  switch (framework) {
    case 'vite':
      env['BASE_URL'] = basePath;
      break;
    case 'cra':
      env['PUBLIC_URL'] = basePath;
      env['HOMEPAGE'] = basePath;
      break;
    case 'nextjs':
      env['NEXT_PUBLIC_BASE_PATH'] = basePath;
      break;
  }

  return env;
}

const INSTALL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Ensure dependencies (including devDependencies) are installed before building.
 * The install always includes devDependencies (build tools like typescript live
 * there) regardless of NODE_ENV — see utils/packageManager.buildInstallCommand.
 *
 * Fast path: in the deploy workspace, `node_modules` is a symlink pointing
 * at the dev codebase's already-installed `node_modules` (see
 * DeployWorkspace.syncDeployWorkspace). PreviewService runs a Redis-locked
 * install for preview dev, so deps are already present and correct —
 * running install again here would race with that lock (and with any
 * live `next dev` file watcher). Skip when we can verify deps are ready.
 */
async function ensureDependencies(
  workspacePath: string,
  onLog?: (line: string) => void
): Promise<void> {
  const nodeModulesPath = path.join(workspacePath, 'node_modules');
  const nodeModulesStat = await fs.promises.lstat(nodeModulesPath).catch(() => null);

  if (nodeModulesStat?.isSymbolicLink()) {
    onLog?.(`📦 node_modules is a symlink (shared with dev codebase) — skipping install`);
    return;
  }

  // Heuristic for the non-symlink case: if node_modules exists and contains
  // a resolvable next binary (or any .bin), deps are almost certainly
  // installed. Treat as no-op to avoid redundant reinstalls.
  if (nodeModulesStat?.isDirectory()) {
    const binDir = path.join(nodeModulesPath, '.bin');
    if (fs.existsSync(binDir)) {
      onLog?.(`📦 node_modules already populated — skipping install`);
      return;
    }
  }

  // Detect the PM at the workspace root, not the per-package dir — a workspace
  // member has no lockfile of its own, so detecting here would fall back to npm
  // and fail on `workspace:*` deps. `pnpm install` from a sub-package installs
  // the whole workspace correctly.
  const pm = detectPackageManager(findProjectRoot(workspacePath));
  const { command, args } = buildInstallCommand(pm);

  onLog?.(`📦 Installing dependencies (${pm})...`);

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const child = spawn(command, args, {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        onLog?.(`❌ ${pm} install timed out (3 minutes)`);
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 5000);
        reject(new Error(`${pm} install timed out`));
      }
    }, INSTALL_TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => onLog?.(line));
    });

    child.stderr?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => onLog?.(line));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        onLog?.(`✅ Dependencies installed`);
        resolve();
      } else {
        const err = `${pm} install failed with exit code ${code}`;
        onLog?.(`❌ ${err}`);
        reject(new Error(err));
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onLog?.(`❌ Install error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Build CLI args for base path injection.
 */
function buildArgsWithBasePath(basePath: string, framework: DeployFramework): string[] {
  switch (framework) {
    case 'vite':
      return ['--base', basePath];
    default:
      return [];
  }
}

/**
 * Run production build for a project.
 */
export async function runBuild(
  workspacePath: string,
  basePath: string,
  onLog?: (line: string) => void
): Promise<BuildResult> {
  const framework = detectFramework(workspacePath);
  const outputDir = getBuildOutputDir(workspacePath, framework);
  const logs: string[] = [];

  const log = (line: string) => {
    logs.push(line);
    onLog?.(line);
  };

  log(`🔍 Detected framework: ${framework}`);
  log(`📂 Build output: ${outputDir}`);
  log(`🔗 Base path: ${basePath}`);

  // Static sites: no build needed, just verify directory exists
  if (framework === 'static') {
    if (fs.existsSync(outputDir)) {
      log('✅ Static directory found, no build needed');
      return { success: true, framework, outputDir, logs };
    }
    return { success: false, framework, outputDir, error: 'No static build output found', logs };
  }

  // Ensure dependencies are installed before building
  try {
    await ensureDependencies(workspacePath, log);
  } catch (err: any) {
    return { success: false, framework, outputDir, error: `Dependency install failed: ${err.message}`, logs };
  }

  // Check for package.json build script
  const pkgPath = path.join(workspacePath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { success: false, framework, outputDir, error: 'No package.json found', logs };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  if (!pkg.scripts?.build) {
    return { success: false, framework, outputDir, error: 'No build script in package.json', logs };
  }

  // Build command
  const envVars = buildEnvWithBasePath(basePath, framework);
  const extraArgs = buildArgsWithBasePath(basePath, framework);

  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['run', 'build', '--', ...extraArgs];

  log(`🏗️  Running: ${npmBin} ${args.join(' ')}`);

  const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

  return new Promise<BuildResult>((resolve) => {
    let resolved = false;
    const done = (result: BuildResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(npmBin, args, {
      cwd: workspacePath,
      env: { ...process.env, ...envVars, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    const timer = setTimeout(() => {
      log('❌ Build timed out (10 minutes)');
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, 5000);
      done({ success: false, framework, outputDir, error: 'Build timed out (10 minutes)', logs });
    }, BUILD_TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line: string) => log(line));
    });

    child.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line: string) => log(line));
    });

    child.on('close', (code) => {
      if (code === 0) {
        log('✅ Build completed successfully');
        let finalOutputDir = outputDir;
        if (framework === 'nextjs') {
          const outDir = path.join(workspacePath, 'out');
          if (fs.existsSync(outDir)) {
            finalOutputDir = outDir;
            log('📦 Detected Next.js static export (out/)');
          }
        }
        done({ success: true, framework, outputDir: finalOutputDir, logs });
      } else {
        const error = `Build failed with exit code ${code}`;
        log(`❌ ${error}`);
        done({ success: false, framework, outputDir, error, logs });
      }
    });

    child.on('error', (err) => {
      const error = `Build process error: ${err.message}`;
      log(`❌ ${error}`);
      done({ success: false, framework, outputDir, error, logs });
    });
  });
}

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
        done({ success: true, framework, outputDir, logs });
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

import { spawn } from 'child_process';
import * as path from 'path';
import { logger } from '../../../../../../utils/logger';
import type { LogCallback, PackageInfo } from '../types';
import { ServiceConnection } from '../../../../../../core/ports/portRegistry';
import { buildPackageEnv } from './envAssembly';
import type { PreviewManifestResult } from './previewManifest';

/**
 * ProvisioningManager
 *
 * Runs post-infrastructure setup commands (DB schema migration / seed / custom)
 * AFTER docker-compose is healthy and BEFORE the dev server is spawned. This is
 * the slot the preview lifecycle previously lacked: `docker compose up` brings
 * up an EMPTY database, so without this step every query against an
 * un-migrated schema fails.
 *
 * Command resolution is **declared-only** — the single source is the preview
 * manifest (`<projectRoot>/ant.manifest.json`, read by `readPreviewManifest`).
 * ANT infra is ORM/stack-agnostic: it executes the commands the code-gen LLM
 * declared, it does NOT infer them. There is no ORM auto-detection and no
 * Redis fallback.
 *   - Root commands (`preview.setupCommands`) run at the project root cwd with
 *     all connections (`packageSource='*'`).
 *   - Per-package commands (`preview.packages[src].setupCommands`) run in that
 *     package's cwd (matched by `packageSource = path.relative(root, pkg.path)`)
 *     with that package's resolved env, so a `prisma migrate deploy` sees the
 *     exact `DATABASE_URL` the app will use.
 *
 * Preview infra is ephemeral (volumes wiped each start), so declared commands
 * are expected to be idempotent — they run on EVERY start.
 *
 * Standalone (no PreviewService coupling) so a future deploy-side backend
 * runtime can reuse it verbatim.
 */

export interface ResolvedSetupCommand {
  /** Human-readable label for logs (the declared command string). */
  label: string;
  command: string;
  args: string[];
  cwd: string;
  /** Package subdir relative to project root (drives connection env filtering). */
  packageSource: string;
  /** Declared commands are free-form and always run through a shell. */
  shell: boolean;
}

export interface ProvisioningResult {
  ok: boolean;
  detail?: string;
  ranLabels: string[];
}

export class ProvisioningManager {
  private readonly COMMAND_TIMEOUT = 120_000;

  /**
   * Resolve the ordered setup commands for a project from the declared
   * manifest only. Root commands run at the project root; per-package commands
   * run in the matching package's cwd. A per-package key that matches no
   * detected package is skipped (logged) — its cwd/env cannot be resolved.
   */
  resolveSetupCommands(
    packages: PackageInfo[],
    projectRoot: string,
    manifest: PreviewManifestResult,
  ): ResolvedSetupCommand[] {
    const resolved: ResolvedSetupCommand[] = [];

    // Root-level commands: project root cwd, all connections (packageSource '*').
    for (const cmd of manifest.root) {
      resolved.push({
        label: cmd,
        command: cmd,
        args: [],
        cwd: projectRoot,
        packageSource: '*',
        shell: true,
      });
    }

    // Per-package commands: match the manifest key (packageSource) to a detected
    // package so the command runs in that package's cwd with its filtered env.
    for (const [src, cmds] of Object.entries(manifest.byPackage)) {
      const pkg = packages.find(p => (path.relative(projectRoot, p.path) || '*') === src);
      if (!pkg) {
        logger.warn(
          `[ProvisioningManager] Manifest package "${src}" matches no detected package — skipped`,
          { component: 'ProvisioningManager' },
        );
        continue;
      }
      for (const cmd of cmds) {
        resolved.push({
          label: cmd,
          command: cmd,
          args: [],
          cwd: pkg.path,
          packageSource: src,
          shell: true,
        });
      }
    }

    return resolved;
  }

  /**
   * Run all resolved setup commands sequentially. Fatal on first failure — the
   * caller fails the preview at the `provisioning` stage rather than spawning
   * the app against an un-provisioned DB.
   */
  async runProvisioning(
    packages: PackageInfo[],
    projectRoot: string,
    connections: ServiceConnection[],
    manifest: PreviewManifestResult,
    onLog: LogCallback,
    signal?: AbortSignal,
  ): Promise<ProvisioningResult> {
    const commands = this.resolveSetupCommands(packages, projectRoot, manifest);
    if (commands.length === 0) return { ok: true, ranLabels: [] };

    const ranLabels: string[] = [];
    for (const cmd of commands) {
      if (signal?.aborted) return { ok: false, detail: 'cancelled', ranLabels };

      onLog('stdout', `🗄️  Provisioning: ${cmd.label}\n`);
      const result = await this.runOne(cmd, projectRoot, connections, onLog, signal);
      if (!result.ok) {
        return { ok: false, detail: `${cmd.label}: ${result.detail ?? 'failed'}`, ranLabels };
      }
      ranLabels.push(cmd.label);
    }

    onLog('stdout', '✅ Provisioned\n');
    return { ok: true, ranLabels };
  }

  private runOne(
    cmd: ResolvedSetupCommand,
    projectRoot: string,
    connections: ServiceConnection[],
    onLog: LogCallback,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; detail?: string }> {
    return new Promise((resolve) => {
      const env = {
        ...process.env,
        ...buildPackageEnv({ pkgPath: cmd.cwd, projectRoot, connections, packageSource: cmd.packageSource }),
      };

      const child = spawn(cmd.command, cmd.args, {
        cwd: cmd.cwd,
        shell: cmd.shell,
        stdio: 'pipe',
        env,
      });

      let stderr = '';
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
        resolve({ ok: false, detail: 'cancelled' });
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        const msg = `❌ Provisioning command timed out after ${this.COMMAND_TIMEOUT / 1000}s: ${cmd.label}`;
        logger.warn(msg, { component: 'ProvisioningManager' });
        onLog('stderr', msg + '\n');
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        resolve({ ok: false, detail: `timed out after ${this.COMMAND_TIMEOUT / 1000}s` });
      }, this.COMMAND_TIMEOUT);

      child.stdout?.on('data', (d: Buffer) => onLog('stdout', d.toString()));
      child.stderr?.on('data', (d: Buffer) => { const s = d.toString(); stderr += s; onLog('stderr', s); });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        if (code === 0) {
          resolve({ ok: true });
        } else {
          const tail = stderr.slice(-500).trim();
          logger.warn(`Provisioning failed (${cmd.label}) code=${code}: ${tail}`, { component: 'ProvisioningManager' });
          resolve({ ok: false, detail: tail || `exit code ${code}` });
        }
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        logger.warn(`Provisioning spawn error (${cmd.label}): ${error.message}`, { component: 'ProvisioningManager' });
        resolve({ ok: false, detail: error.message });
      });
    });
  }
}

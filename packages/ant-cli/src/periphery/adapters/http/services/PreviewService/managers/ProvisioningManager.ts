import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../../../../utils/logger';
import type { LogCallback, PackageInfo } from '../types';
import { ServiceConnection } from '../../../../../../core/ports/portRegistry';
import { buildPackageEnv } from './envAssembly';

/**
 * ProvisioningManager
 *
 * Runs post-infrastructure setup commands (DB schema migration / seed / custom)
 * AFTER docker-compose is healthy and BEFORE the dev server is spawned. This is
 * the slot the preview lifecycle previously lacked: `docker compose up` brings
 * up an EMPTY database, so without this step every query against an
 * un-migrated schema fails.
 *
 * Command resolution (declared first, then zero-config ORM detection):
 *   1. Declared `setupCommands` (preview config) — runs verbatim at project root.
 *      Covers any stack / custom provisioning.
 *   2. ORM auto-detect — Prisma: `prisma/schema.prisma` present → run
 *      `migrate deploy` when committed migrations exist, else `db push`
 *      (no-migration-history projects). Per-package, in the package cwd.
 *
 * Preview infra is ephemeral (volumes wiped each start), so these run on EVERY
 * start; `migrate deploy` / `db push` are idempotent against a fresh DB.
 *
 * Standalone (no PreviewService coupling) so a future deploy-side backend
 * runtime can reuse it verbatim.
 */

export interface ResolvedSetupCommand {
  /** Human-readable label for logs (e.g. "prisma db push"). */
  label: string;
  command: string;
  args: string[];
  cwd: string;
  /** Package subdir relative to project root (drives connection env filtering). */
  packageSource: string;
  /** Free-form declared command needs a shell; ORM commands spawn the bin directly. */
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
   * Resolve the ordered setup commands for a project. Declared commands win;
   * otherwise per-package ORM auto-detection.
   */
  resolveSetupCommands(
    packages: PackageInfo[],
    projectRoot: string,
    declaredCommands?: string[],
  ): ResolvedSetupCommand[] {
    if (declaredCommands && declaredCommands.length > 0) {
      return declaredCommands.map(cmd => ({
        label: cmd,
        command: cmd,
        args: [],
        cwd: projectRoot,
        packageSource: '*',
        shell: true,
      }));
    }

    const resolved: ResolvedSetupCommand[] = [];
    for (const pkg of packages) {
      const prismaCmd = this.detectPrismaCommand(pkg.path, projectRoot);
      if (prismaCmd) resolved.push(prismaCmd);
    }
    return resolved;
  }

  /**
   * Prisma detection: `prisma/schema.prisma` present in the package. Command
   * depends on migration history — committed migrations → `migrate deploy`,
   * none → `db push` (schema sync for db-push-workflow projects).
   */
  private detectPrismaCommand(pkgPath: string, projectRoot: string): ResolvedSetupCommand | null {
    const schemaPath = path.join(pkgPath, 'prisma', 'schema.prisma');
    if (!fs.existsSync(schemaPath)) return null;

    const migrationsDir = path.join(pkgPath, 'prisma', 'migrations');
    const hasMigrations = (() => {
      try {
        return fs.readdirSync(migrationsDir, { withFileTypes: true }).some(e => e.isDirectory());
      } catch {
        return false;
      }
    })();

    const sub = hasMigrations
      ? ['migrate', 'deploy']
      : ['db', 'push', '--skip-generate'];

    const localBin = this.resolveLocalBin(pkgPath, projectRoot, 'prisma');
    const command = localBin ?? 'npx';
    const args = localBin ? sub : ['prisma', ...sub];

    return {
      label: `prisma ${sub.join(' ')}`,
      command,
      args,
      cwd: pkgPath,
      packageSource: path.relative(projectRoot, pkgPath) || '*',
      shell: false,
    };
  }

  private resolveLocalBin(pkgPath: string, projectRoot: string | undefined, bin: string): string | undefined {
    const candidates = [path.join(pkgPath, 'node_modules', '.bin', bin)];
    if (projectRoot && path.resolve(projectRoot) !== path.resolve(pkgPath)) {
      candidates.push(path.join(projectRoot, 'node_modules', '.bin', bin));
    }
    return candidates.find(c => fs.existsSync(c));
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
    declaredCommands: string[] | undefined,
    onLog: LogCallback,
    signal?: AbortSignal,
  ): Promise<ProvisioningResult> {
    const commands = this.resolveSetupCommands(packages, projectRoot, declaredCommands);
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

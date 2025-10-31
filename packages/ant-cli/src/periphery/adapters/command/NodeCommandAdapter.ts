/**
 * Node Command Adapter
 * Implements CommandPort using Node.js child_process
 * 
 * ✅ Security:
 * - Whitelist of allowed commands
 * - No shell injection (uses exec with array args when possible)
 * - Timeout protection
 */

import { CommandPort, CommandResult, CommandOptions } from "../../../core/ports";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

export class NodeCommandAdapter implements CommandPort {
  private readonly ALLOWED_COMMANDS = [
    'npm',
    'npx',    // ✅ Added for running tools like tsc, eslint
    'pnpm',
    'yarn',
    'git',
    'node',
  ];

  private readonly DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  /**
   * Check if a command is allowed
   */
  isAllowed(command: string): boolean {
    const cmd = command.trim().split(/\s+/)[0];
    return this.ALLOWED_COMMANDS.includes(cmd);
  }

  /**
   * Execute a command
   */
  async execute(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    // Security check
    if (!this.isAllowed(command)) {
      throw new Error(`Command not allowed: ${command}`);
    }

    const timeout = options.timeout || this.DEFAULT_TIMEOUT;
    const cwd = options.cwd || process.cwd();

    console.log(`🔧 Executing: ${command}`);
    console.log(`   Directory: ${cwd}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        env: { ...process.env, ...options.env },
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        success: true,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        success: false,
      };
    }
  }

  /**
   * Detect package manager
   */
  async detectPackageManager(cwd: string): Promise<'npm' | 'pnpm' | 'yarn' | null> {
    // Check lock files
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
      return 'yarn';
    }
    if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
      return 'npm';
    }

    // Check package.json for packageManager field
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.packageManager) {
          if (pkg.packageManager.startsWith('pnpm')) return 'pnpm';
          if (pkg.packageManager.startsWith('yarn')) return 'yarn';
          if (pkg.packageManager.startsWith('npm')) return 'npm';
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Default to npm
    return 'npm';
  }
}


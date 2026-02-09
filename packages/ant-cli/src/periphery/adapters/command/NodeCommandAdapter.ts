/**
 * Node Command Adapter
 * Implements CommandPort using Node.js child_process
 * 
 * ✅ Security:
 * - Whitelist of allowed commands
 * - No shell injection (uses exec with array args when possible)
 * - Timeout protection with proper process group cleanup
 * 
 * ✅ Timeout Fix:
 * - Uses spawn instead of exec to properly kill process groups
 * - npm run commands spawn child processes that must be killed together
 * - exec's timeout only kills parent, leaving orphaned children
 */

import { CommandPort, CommandResult, CommandOptions } from "../../../core/ports";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { isProcessGroupAlive } from "./processTree";

export class NodeCommandAdapter implements CommandPort {
  /**
   * Emergency escape hatch.
   *
   * When true, disables command allowlist checks entirely.
   * This is useful in controlled environments where allowlist false-positives
   * block legitimate workflows.
   *
   * NOTE: This increases risk (shell execution). Prefer extending allowlist first.
   */
  private readonly ALLOW_ALL_COMMANDS =
    process.env.ANT_UNSAFE_ALLOW_ALL_COMMANDS === 'true' ||
    process.env.ANT_UNSAFE_ALLOW_ALL_COMMANDS === '1';

  private readonly ALLOWED_COMMANDS = [
    // Package managers
    'npm',
    'npx',
    'pnpm',
    'yarn',
    
    // Version control
    'git',
    
    // Runtime
    'node',
    
    // File operations
    'rm',      // File/directory removal
    'rmdir',   // Remove empty directories
    'mkdir',   // Directory creation
    'cp',      // Copy files
    'mv',      // Move files
    'touch',   // Create empty files
    'cd',      // Change directory
    
    // File inspection
    'ls',      // List directory contents
    'cat',     // Display file contents
    'head',    // Display file start
    'tail',    // Display file end
    'wc',      // Count lines/words/bytes
    'file',    // Identify file type
    'diff',    // Compare files
    
    // File searching
    'find',    // Search for files
    'grep',    // Search text patterns
    'which',   // Locate command
    
    // Text processing
    'echo',    // Print text
    'sort',    // Sort lines
    'uniq',    // Remove duplicates
    'awk',     // Text processing
    'sed',     // Stream editor
    
    // Network
    'curl',    // HTTP requests / API testing
    'wget',    // Download files
    
    // Containers
    'docker',  // Docker CLI (docker compose up/down for infrastructure services)
    
    // System info
    'pwd',     // Print working directory
    'tree',    // Directory tree (if installed)
    
    // Process management
    'lsof',    // List open files (for port checking)
    'kill',    // Kill processes
    'xargs',   // Build and execute commands from stdin

    // Common shell builtins / env helpers used in compound commands
    'env',
    'export',
    'unset',
  ];

  private readonly DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  /**
   * Check if a command is allowed
   */
  isAllowed(command: string): boolean {
    // If the project explicitly opted out of allowlisting, allow everything.
    if (this.ALLOW_ALL_COMMANDS) return true;

    const normalized = command.trim();
    if (!normalized) return false;

    // Split on common shell operators to validate each segment.
    // This is not a full shell parser, but prevents the common false-positive
    // where a safe command is preceded by "cd dir &&".
    const segments = normalized.split(/\s*(?:&&|\|\||;|\|)\s*/g);

    const isAssignment = (token: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

    const firstExecutableToken = (segment: string): string | null => {
      const tokens = segment.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return null;

      // Skip leading env var assignments: FOO=bar npm install
      let i = 0;
      while (i < tokens.length && isAssignment(tokens[i])) i++;
      if (i >= tokens.length) return null;

      // Allow common builtins explicitly (export/unset)
      if (tokens[i] === 'export' || tokens[i] === 'unset') return tokens[i];

      // Strip wrapping parentheses occasionally used in subshell-like patterns
      const token = tokens[i].replace(/^\(+/, '').replace(/\)+$/, '');
      return token || null;
    };

    for (const seg of segments) {
      const cmd = firstExecutableToken(seg);
      if (!cmd) continue;
      if (!this.ALLOWED_COMMANDS.includes(cmd)) return false;
    }

    return true;
  }

  /**
   * Execute a command with proper timeout and process group cleanup
   * 
   * Uses spawn instead of exec to ensure:
   * 1. Child processes (e.g., npm run -> tsx watch) are killed together
   * 2. Timeout is enforced by killing entire process group
   * 3. SIGTERM -> SIGKILL escalation for stubborn processes
   */
  async execute(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    // Security check
    if (!this.isAllowed(command)) {
      throw new Error(`Command not allowed: ${command}`);
    }

    const timeout = options.timeout || this.DEFAULT_TIMEOUT;
    let cwd = options.cwd || process.cwd();
    
    // ✅ Expand ~ to home directory
    if (cwd.startsWith('~')) {
      const os = await import('os');
      cwd = cwd.replace(/^~/, os.homedir());
    }

    console.log(`🔧 Executing: ${command}`);
    console.log(`   Directory: ${cwd}`);
    console.log(`   Timeout: ${timeout}ms`);

    return new Promise((resolve) => {
      const trimmed = command.trim();
      if (!trimmed) {
        resolve({ stdout: '', stderr: 'Empty command', exitCode: 1, success: false });
        return;
      }

      // If the command includes shell operators / redirection / pipelines, we MUST run it as a single
      // shell string. Splitting into [cmd, ...args] and enabling shell=true breaks constructs like:
      //   cd codebase && npm install
      // because the shell only receives "cd" as the -c string.
      const needsShell =
        /(\|\||&&|;|\||[<>])/.test(trimmed) ||
        /^\s*cd\b/.test(trimmed);

      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd' : 'sh';
      const shellArgs = isWindows ? ['/c', trimmed] : ['-lc', trimmed];

      const [cmd, ...args] = needsShell ? [shell, ...shellArgs] : trimmed.split(/\s+/);
      
      // ✅ CRITICAL: Filter out ant-cli environment variables to prevent pollution
      // Do NOT pass ant-cli's PORT (4100) to user's commands!
      const cleanEnv = Object.entries(process.env).reduce((acc, [key, value]) => {
        // Exclude ant-cli specific env vars (except ANT_* which are intentional)
        if (key === 'PORT') {
          return acc;  // Don't pass ant-cli's PORT to user commands
        }
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);
      
      // ✅ Spawn with a dedicated process group for proper cleanup
      const child = spawn(cmd, args, {
        cwd,
        env: { ...cleanEnv, ...options.env },
        // We only use an explicit shell process when needed; otherwise spawn directly.
        // This avoids subtle quoting bugs and improves safety.
        shell: false,
        detached: process.platform !== 'win32', // create new process group (POSIX)
      });

      let stdout = '';
      let stderr = '';
      let timeoutOccurred = false;
      let timeoutId: NodeJS.Timeout | null = null;
      let sigkillTimer: NodeJS.Timeout | null = null;
      let forceResolveTimer: NodeJS.Timeout | null = null;
      let settled = false;

      // Collect stdout
      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        options.onStdout?.(chunk);
      });

      // Collect stderr
      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        options.onStderr?.(chunk);
      });

      const cleanupTimers = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
        if (sigkillTimer) clearTimeout(sigkillTimer);
        sigkillTimer = null;
        if (forceResolveTimer) clearTimeout(forceResolveTimer);
        forceResolveTimer = null;
      };

      const finish = (result: CommandResult) => {
        if (settled) return;
        settled = true;
        cleanupTimers();
        resolve(result);
      };

      const isProcessGroupAlive = (pid: number): boolean => {
        return isProcessGroupAlive(pid);
      };

      const signalProcessTree = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          console.log(`⏰ Timeout (${timeout}ms) - sending ${signal} to PID ${child.pid}`);
          try {
            process.kill(-child.pid, signal); // process group (preferred)
          } catch {
            child.kill(signal); // fallback
          }
        } catch (error) {
          console.error(`Failed to kill process:`, error);
        }
      };

      // Set timeout
      timeoutId = setTimeout(() => {
        timeoutOccurred = true;

        // 1) Try graceful termination
        signalProcessTree('SIGTERM');

        // 2) Escalate to SIGKILL if still alive after a short grace period
        sigkillTimer = setTimeout(() => {
          if (child.pid && isProcessGroupAlive(child.pid)) {
            console.log(`⚠️  Process didn't respond to SIGTERM, escalating to SIGKILL`);
            signalProcessTree('SIGKILL');
          }
        }, 2000);

        // 3) Absolute safety: never hang waiting for 'close' if kill didn't work
        forceResolveTimer = setTimeout(() => {
          if (child.pid && isProcessGroupAlive(child.pid)) {
            console.log(`⚠️  Process still alive after SIGKILL attempt; returning timeout result to avoid hang`);
          }
          finish({
            stdout: stdout.trim(),
            stderr: `Command timed out after ${timeout}ms\n${stderr}`.trim(),
            exitCode: 124,
            success: false,
          });
        }, 8000);
      }, timeout);

      // Handle process exit
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        cleanupTimers();

        const exitCode = code ?? (signal ? 1 : 0);
        options.onExit?.(exitCode);

        if (timeoutOccurred) {
          // Timeout occurred
          finish({
            stdout: stdout.trim(),
            stderr: `Command timed out after ${timeout}ms\n${stderr}`.trim(),
            exitCode: 124,  // Standard timeout exit code
            success: false,
          });
        } else {
          // Normal exit
          finish({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode,
            success: exitCode === 0,
          });
        }
      });

      // Handle errors
      child.on('error', (error: Error) => {
        cleanupTimers();

        finish({
          stdout: stdout.trim(),
          stderr: error.message,
          exitCode: 1,
          success: false,
        });
      });
    });
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


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
import { splitOnShellOperators, tokenizeShellSegment } from "../../../core/utils/shellParser";

/**
 * Build a sanitized copy of process.env for user command execution.
 * Strips ant-cli internal variables (PORT, NODE_ENV) that would pollute
 * user projects.  Shared by NodeCommandAdapter.execute() and
 * handleLongRunningCommand() in runCommand.ts.
 */
export function cleanCommandEnv(extra?: Record<string, string>): Record<string, string> {
  const base = Object.entries(process.env).reduce((acc, [key, value]) => {
    if (key === 'PORT' || key === 'NODE_ENV') return acc;
    if (value !== undefined) acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
  return extra ? { ...base, ...extra } : base;
}

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
    
    // Runtime - Node.js
    'node',
    'tsx',       // TypeScript execution (tsx server.ts, tsx watch)
    'nodemon',   // Node.js auto-restart daemon
    
    // Runtime - Go
    'go',        // go build, go run, go mod tidy, go vet, go test, go get
    'air',       // Go hot-reload dev server (cosmtrek/air)
    
    // Runtime - Rust
    'cargo',     // cargo run, cargo build, cargo test
    
    // Runtime - Bun
    'bun',       // bun run, bun build, bun test
    
    // Build tools
    'make',      // Makefile targets (build, lint, test, run, etc.)
    'tsc',       // TypeScript compiler (direct invocation)
    'turbo',     // Turborepo (direct invocation)
    'vite',      // Vite dev server / build (direct invocation)
    
    // File operations
    'rm',        // File/directory removal
    'rmdir',     // Remove empty directories
    'mkdir',     // Directory creation
    'cp',        // Copy files
    'mv',        // Move files
    'touch',     // Create empty files
    'cd',        // Change directory
    
    // File inspection
    'ls',        // List directory contents
    'cat',       // Display file contents
    'head',      // Display file start
    'tail',      // Display file end
    'wc',        // Count lines/words/bytes
    'file',      // Identify file type
    'diff',      // Compare files
    
    // File searching
    'find',      // Search for files
    'grep',      // Search text patterns
    'which',     // Locate command
    
    // Text processing
    'echo',      // Print text
    'sort',      // Sort lines
    'uniq',      // Remove duplicates
    'awk',       // Text processing
    'sed',       // Stream editor
    
    // Network
    'curl',      // HTTP requests / API testing
    'wget',      // Download files
    
    // Containers
    'docker',    // Docker CLI (docker compose up/down for infrastructure services)
    
    // System info
    'pwd',       // Print working directory
    'tree',      // Directory tree (if installed)
    
    // Process management
    'lsof',      // List open files (for port checking)
    'kill',      // Kill processes
    'xargs',     // Build and execute commands from stdin

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
    if (this.ALLOW_ALL_COMMANDS) return true;

    const normalized = command.trim();
    if (!normalized) return false;

    const segments = splitOnShellOperators(normalized);

    const isAssignment = (token: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

    const firstExecutableToken = (segment: string): string | null => {
      const tokens = tokenizeShellSegment(segment.trim());
      if (tokens.length === 0) return null;

      let i = 0;
      while (i < tokens.length && isAssignment(tokens[i])) i++;
      if (i >= tokens.length) return null;

      if (tokens[i] === 'export' || tokens[i] === 'unset') return tokens[i];

      const token = tokens[i].replace(/^\(+/, '').replace(/\)+$/, '');
      return token || null;
    };

    for (const seg of segments) {
      const cmd = firstExecutableToken(seg);
      if (!cmd) continue;
      if (this.ALLOWED_COMMANDS.includes(cmd)) continue;
      if (this.isAllowedRelativeBinary(cmd)) continue;
      return false;
    }

    return true;
  }

  /**
   * Allow ./relative-path binaries produced by compile-and-run workflows
   * (e.g., `go build -o app && ./app`). Only simple names are permitted —
   * no path traversal, no subdirectories, no flags.
   */
  private isAllowedRelativeBinary(cmd: string): boolean {
    return /^\.\/[a-zA-Z_][\w.-]*$/.test(cmd);
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
      // ✅ CRITICAL: For compound shell commands, prepend `set -e;` so the shell exits
      // immediately when ANY sub-command fails. Without this, `sh -lc` only reports the
      // exit code of the LAST foreground command, silently masking intermediate failures.
      // Example: `timeout 10 curl ...; echo done` → without set -e, exit code is 0 (echo)
      //          even though `timeout` failed with "command not found".
      // The LLM can still use `|| true` to explicitly ignore expected failures.
      //
      // ✅ CRITICAL: `set -o pipefail` makes pipeline exit code reflect the rightmost
      // non-zero exit code, not just the last command. Without this, `build | tail -80`
      // reports exit 0 (tail) even when build fails. The `2>/dev/null || true` prefix
      // is safe: pipefail is enabled on bash/zsh, silently skipped on dash/POSIX sh,
      // and placed before set -e so the fallback doesn't trigger an early exit.
      // SIGPIPE (exit 141) from `cmd | head` is handled separately in runCommand.ts.
      const shellCommand = (!isWindows && needsShell)
        ? `set -o pipefail 2>/dev/null || true; set -e; ${trimmed}`
        : trimmed;
      const shellArgs = isWindows ? ['/c', trimmed] : ['-lc', shellCommand];

      const [cmd, ...args] = needsShell ? [shell, ...shellArgs] : trimmed.split(/\s+/);
      
      const envForChild = cleanCommandEnv(options.env);
      
      // ✅ Spawn with a dedicated process group for proper cleanup
      const child = spawn(cmd, args, {
        cwd,
        env: envForChild,
        // We only use an explicit shell process when needed; otherwise spawn directly.
        // This avoids subtle quoting bugs and improves safety.
        shell: false,
        detached: process.platform !== 'win32', // create new process group (POSIX)
        // stdin closed: prevents interactive prompts from hanging forever.
        // Shell-internal pipes (cmd1 | cmd2) and heredocs are unaffected
        // as the shell handles them via -c argument, not spawn's stdin.
        stdio: ['ignore', 'pipe', 'pipe'],
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

      let exitGraceTimer: NodeJS.Timeout | null = null;

      const cleanupTimers = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
        if (sigkillTimer) clearTimeout(sigkillTimer);
        sigkillTimer = null;
        if (forceResolveTimer) clearTimeout(forceResolveTimer);
        forceResolveTimer = null;
        if (exitGraceTimer) clearTimeout(exitGraceTimer);
        exitGraceTimer = null;
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

      // Handle shell process exit
      // 'exit' fires when the shell process terminates, but pipes may still be open
      // if background processes (started with &) inherit them.
      // Grace period: if 'close' doesn't fire within 5s after 'exit', force resolve
      // to prevent hanging on background processes that keep pipes open.
      child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        exitGraceTimer = setTimeout(() => {
          if (settled) return;
          console.log(`⚠️  [CommandAdapter] Shell exited (code=${code}) but pipes still open after 5s — forcing resolve (background process likely holding pipe)`);
          // Kill the process group to clean up orphaned background processes
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGTERM');
              console.log(`   🧹 Killed process group (pgid=${child.pid}) to clean up background children`);
            } catch {
              // Process group already gone
            }
          }
          cleanupTimers();
          const exitCode = code ?? (signal ? 1 : 0);
          options.onExit?.(exitCode);
          finish({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode,
            success: exitCode === 0,
          });
        }, 5000);
      });

      // Handle process close (fires when all stdio pipes are closed)
      // For normal commands, this fires shortly after 'exit'.
      // For commands with background processes, this may be delayed — the exit grace timer above handles that.
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        cleanupTimers();

        const exitCode = code ?? (signal ? 1 : 0);
        options.onExit?.(exitCode);

        if (timeoutOccurred) {
          finish({
            stdout: stdout.trim(),
            stderr: `Command timed out after ${timeout}ms\n${stderr}`.trim(),
            exitCode: 124,
            success: false,
          });
        } else {
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


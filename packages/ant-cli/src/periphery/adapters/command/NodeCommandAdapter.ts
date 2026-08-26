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
import { isProcessGroupAlive } from "./processTree";
import { splitOnShellOperators, tokenizeShellSegment, maskQuotedRegions } from "../../../core/utils/shellParser";
import { composeCommandChildEnv } from "../../../core/config/childEnv";
import { childSpawnIdentity, assertUserCodeIsolationOrThrow } from "../../../core/config/childIdentity";

/**
 * Build the environment for a user command child.
 *
 * The command is LLM-chosen and runs the user's own project (`npm run`, `node
 * -e`, lifecycle scripts), and its stdout/stderr goes back to the chat card and
 * into the next LLM turn as a tool result. So it gets the same composed
 * allowlist as preview/deploy children rather than the job runner's own
 * `process.env`, which holds provider API keys and the Redis URL.
 *
 * On top of that: `PORT`/`NODE_ENV` stay stripped (ant-cli internals that would
 * pollute a user project — `NODE_ENV` otherwise rides the `NODE_` namespace),
 * and `extra` still wins, so a caller's explicit execution settings are kept.
 */
export function cleanCommandEnv(extra?: Record<string, string>): Record<string, string> {
  const composed = composeCommandChildEnv();
  delete composed.PORT;
  delete composed.NODE_ENV;

  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(composed)) {
    if (value !== undefined) base[key] = value;
  }
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

    // Runtime - Python
    'python3',   // python3 script.py / python3 -m …
    'python',    // distro alias for python3
    'uv',        // uv run / uv sync (install locality guarded by codeCommandPolicy)

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
    'cmp',       // Byte-compare two files (read-only)
    'stat',      // File metadata (read-only)
    'readlink',  // Resolve a symlink target (read-only)
    'realpath',  // Canonicalize a path (read-only)
    'basename',  // Strip path to filename (pure string)
    'dirname',   // Strip filename to dir (pure string)
    'du',        // Disk usage (read-only diagnostics)
    'df',        // Filesystem free space (read-only diagnostics)

    // Read-only conditionals (POSIX test) — diagnostics like `test -d x && echo y`
    'test',
    '[',

    // File searching
    'find',      // Search for files
    'grep',      // Search text patterns
    'which',     // Locate command

    // Text processing (read-only: stdin → stdout)
    'echo',      // Print text
    'sort',      // Sort lines
    'uniq',      // Remove duplicates
    'awk',       // Text processing
    'sed',       // Stream editor
    'cut',       // Select columns/fields
    'tr',        // Translate/squeeze characters
    'nl',        // Number lines
    'tac',       // Reverse line order
    'rev',       // Reverse characters per line
    'column',    // Columnate lists
    'jq',        // JSON query/transform (read-only without -i)
    'yq',        // YAML/JSON query (read-only without -i)
    'printenv',  // Print environment variables (read-only)
    'date',      // Current date/time (read-only)
    'printf',    // Formatted print (same risk class as echo)

    // Encoding / binary inspection (read-only: stdin/file → stdout)
    'base64',    // Encode/decode (e.g. embed binary assets as data URIs)
    'od',        // Octal/hex dump
    'xxd',       // Hex dump
    'sha256sum', // Checksum verification
    'shasum',    // Checksum verification (macOS/perl variant)
    'md5sum',    // Checksum verification

    // Archives (curl/wget are allowed; downloads must be extractable)
    'tar',
    'gzip',
    'gunzip',
    'unzip',
    'zip',

    // Network
    'curl',      // HTTP requests / API testing
    'wget',      // Download files
    
    // Containers
    'docker',    // Docker CLI (docker compose up/down for infrastructure services)
    
    // System info
    'pwd',       // Print working directory
    'tree',      // Directory tree (if installed)
    'uname',     // Kernel/arch (read-only)
    'id',        // Current uid/gid (read-only)
    'whoami',    // Current user (read-only)
    'hostname',  // Host name (read-only)
    'nproc',     // CPU count (read-only)
    
    // Process management
    'ps',        // Process listing (procps full ps replaces busybox mini-ps)
    'pgrep',     // Find PID by name (DevProcessControl pgrep BFS)
    'pkill',     // Kill by name (LLM cleanup of leaked dev servers)
    'lsof',      // List open files (for port checking)
    'kill',      // Kill processes
    'xargs',     // Build and execute commands from stdin

    // Network/port diagnostics
    'ss',        // Socket statistics (iproute2, replaces netstat)
    'netstat',   // Legacy port listing (net-tools, fallback if ss unavailable)
    'fuser',     // Identify processes using files/sockets (psmisc)

    // Sleep/no-op (common in kill chains: `pkill X; sleep 1; lsof -ti :PORT`)
    'sleep',
    'true',
    'false',
    'timeout',   // Bounded runs (`timeout 30 go test ./...`)

    // Common shell builtins / env helpers used in compound commands
    'env',
    'export',
    'unset',
  ];

  /**
   * Shell control-flow keywords that prefix the command they run — the
   * prefixed command head must itself pass the allowlist (`while true; do
   * base64 "$f"; done` validates `true` and `base64`). Quoted keywords keep
   * their quotes through `tokenizeShellSegment`, so they can never be
   * mistaken for these. `case`/`select`/`function`/`[[` stay unlisted →
   * rejected (case pattern arms cannot be parsed by a stateless segmenter).
   */
  private static readonly CONTROL_FLOW_SKIP = new Set([
    'do', 'then', 'else', 'elif', 'while', 'until', 'if', '!',
    // Closers/no-ops: nothing executable may follow in valid shell; if
    // something does, it is validated as a head like any other token.
    'done', 'fi', 'esac', '}',
  ]);

  /**
   * Check if a command is allowed
   */
  isAllowed(command: string): boolean {
    if (this.ALLOW_ALL_COMMANDS) return true;
    return this.firstDisallowedHead(command) === null;
  }

  /**
   * The first segment head that fails the allowlist, or `null` when the
   * whole command is allowed. Exposed on the port so rejection messages can
   * name the offending token instead of echoing the full command.
   */
  firstDisallowedHead(command: string): string | null {
    const normalized = command.trim();
    if (!normalized) return '(empty command)';

    for (const line of this.splitStatementLines(normalized)) {
      const segments = splitOnShellOperators(line);
      for (const seg of segments) {
        const cmd = this.firstExecutableToken(seg);
        if (!cmd) continue;
        if (this.ALLOWED_COMMANDS.includes(cmd)) continue;
        if (this.isAllowedRelativeBinary(cmd)) continue;
        return cmd;
      }
    }

    return null;
  }

  /**
   * Unquoted newlines are statement boundaries (multi-line `for`/`while`
   * bodies must expose their command heads for validation) — but backslash
   * line-continuations join lines, and heredoc bodies are data, so a command
   * containing `<<` keeps today's single-string treatment (head-only check).
   * Validation-only split: `execute` always runs the original string.
   */
  private splitStatementLines(command: string): string[] {
    if (!command.includes('\n')) return [command];
    const masked = maskQuotedRegions(command);
    if (masked.includes('<<')) return [command];

    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < masked.length; i++) {
      if (masked[i] !== '\n') continue;
      if (i > 0 && masked[i - 1] === '\\') continue;
      lines.push(command.slice(start, i));
      start = i + 1;
    }
    lines.push(command.slice(start));
    return lines;
  }

  private firstExecutableToken(segment: string): string | null {
    const tokens = tokenizeShellSegment(segment.trim());
    if (tokens.length === 0) return null;

    const isAssignment = (token: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (isAssignment(tok)) { i++; continue; }
      // `for NAME in words…` — the header is data (never executed); the loop
      // body arrives as its own `;`/newline-delimited segments and is
      // validated there. No worse than status quo for `$(…)` words, which are
      // unvalidated on every path today.
      if (tok === 'for') return null;
      if (NodeCommandAdapter.CONTROL_FLOW_SKIP.has(tok)) { i++; continue; }
      break;
    }
    if (i >= tokens.length) return null;

    if (tokens[i] === 'export' || tokens[i] === 'unset') return tokens[i];

    // `env` / `timeout` are wrappers — the command they run must pass the
    // allowlist itself, so skip the wrapper and its own arguments.
    while (i < tokens.length && (tokens[i] === 'env' || tokens[i] === 'timeout')) {
      const wrapper = tokens[i];
      i++;
      while (i < tokens.length && (tokens[i].startsWith('-') || isAssignment(tokens[i]))) i++;
      if (wrapper === 'timeout' && i < tokens.length && /^\d+(\.\d+)?[smhd]?$/.test(tokens[i])) i++;
      if (i >= tokens.length) return wrapper;
    }

    const token = tokens[i].replace(/^\(+/, '').replace(/\)+$/, '');
    return token || null;
  }

  /**
   * One-line guidance appended to allowlist rejections so the model can
   * re-plan onto an allowed binary instead of blind-retrying variants.
   */
  notAllowedGuidance(): string {
    return (
      `Each command segment (split on |, &&, ||, ;) must start with an allowlisted binary. ` +
      `Allowed: ${this.ALLOWED_COMMANDS.join(', ')}. ` +
      `Also allowed: ./<binary>, node_modules/.bin/<name>.`
    );
  }

  /**
   * Allow relative-path binaries the project produces or installs:
   * - `./app` — compile-and-run output (e.g. `go build -o app && ./app`)
   * - `(./)node_modules/.bin/<name>` — a locally-installed CLI the LLM invokes
   *   directly (e.g. `node_modules/.bin/vitest --version`) instead of via `pnpm exec`.
   * Both forbid path traversal / nested subdirectories / flags in the token itself.
   */
  private isAllowedRelativeBinary(cmd: string): boolean {
    return (
      /^\.\/[a-zA-Z_][\w.-]*$/.test(cmd) ||
      /^(?:\.\/)?node_modules\/\.bin\/[a-zA-Z_][\w.-]*$/.test(cmd)
    );
  }

  /**
   * Execute a command. The caller owns timeout/watchdog policy via
   * `options.signal`; this adapter only spawns, streams, and runs the
   * kill-cleanup chain when the signal is aborted.
   *
   * Uses spawn (not exec) to ensure:
   * 1. Child processes (e.g., npm run -> tsx watch) are killed together
   * 2. SIGTERM → SIGKILL escalation for stubborn processes
   * 3. Force-resolve safety net if the process group refuses to die
   */
  async execute(command: string, options: CommandOptions): Promise<CommandResult> {
    // Security check
    if (!this.isAllowed(command)) {
      throw new Error(`Command not allowed: ${command}\n${this.notAllowedGuidance()}`);
    }

    let cwd = options.cwd || process.cwd();

    // ✅ Expand ~ to home directory
    if (cwd.startsWith('~')) {
      const os = await import('os');
      cwd = cwd.replace(/^~/, os.homedir());
    }

    console.log(`🔧 Executing: ${command}`);
    console.log(`   Directory: ${cwd}`);

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
        /(\|\||&&|;|\||[<>]|\n)/.test(trimmed) ||
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
      // reports exit 0 (tail) even when build fails.
      //
      // ⚠️ PORTABILITY: `pipefail` is a bash/zsh option. POSIX sh (dash, Alpine busybox
      // `ash` — what production `node:22-alpine` workers run) does NOT support it, and
      // `set -o pipefail` there is an *illegal option to a special builtin*, which makes
      // a non-interactive shell EXIT IMMEDIATELY (exit 2) — before any inline guard like
      // `2>/dev/null || true` can run, and before `${trimmed}` executes. A bare
      // `set -o pipefail 2>/dev/null || true` therefore aborts EVERY operator command on
      // POSIX sh with an empty-output exit 2. The dev box (macOS /bin/sh is bash-family)
      // hides this. Fix: run the probe in a SUBSHELL so the special-builtin abort is
      // contained — on POSIX sh the subshell dies, `&&` short-circuits, and the parent
      // continues without pipefail; on bash/zsh the subshell succeeds and pipefail is
      // enabled in the parent. SIGPIPE (exit 141) from `cmd | head` is handled
      // separately in runCommand.ts and does not depend on pipefail.
      const shellCommand = (!isWindows && needsShell)
        ? `( set -o pipefail ) 2>/dev/null && set -o pipefail; set -e; ${trimmed}`
        : trimmed;
      const shellArgs = isWindows ? ['/c', trimmed] : ['-lc', shellCommand];

      const [cmd, ...args] = needsShell ? [shell, ...shellArgs] : trimmed.split(/\s+/);
      
      const envForChild = cleanCommandEnv(options.env);

      // LLM-chosen command against a user workspace: fail closed in cloud if the
      // OS identity drop is unavailable, so it cannot read the worker's /proc
      // environment under the service UID (M-NEW-016).
      assertUserCodeIsolationOrThrow('run_command');

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
        // LLM-chosen command running against a user workspace — same OS identity
        // boundary as the preview children (C-001).
        ...childSpawnIdentity(),
      });

      let stdout = '';
      let stderr = '';
      let sigkillTimer: NodeJS.Timeout | null = null;
      let forceResolveTimer: NodeJS.Timeout | null = null;
      let settled = false;
      let abortListener: (() => void) | null = null;

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
        if (sigkillTimer) clearTimeout(sigkillTimer);
        sigkillTimer = null;
        if (forceResolveTimer) clearTimeout(forceResolveTimer);
        forceResolveTimer = null;
        if (exitGraceTimer) clearTimeout(exitGraceTimer);
        exitGraceTimer = null;
        if (abortListener) {
          options.signal.removeEventListener('abort', abortListener);
          abortListener = null;
        }
      };

      const finish = (result: CommandResult) => {
        if (settled) return;
        settled = true;
        cleanupTimers();
        resolve(result);
      };

      const signalProcessTree = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          console.log(`🔪 Sending ${signal} to PID ${child.pid}`);
          try {
            process.kill(-child.pid, signal); // process group (preferred)
          } catch {
            child.kill(signal); // fallback
          }
        } catch (error) {
          console.error(`Failed to kill process:`, error);
        }
      };

      // Kill chain (caller-driven via AbortSignal):
      //   1. SIGTERM the process group (graceful)
      //   2. After 2s, SIGKILL if still alive (stubborn processes)
      //   3. After 8s, force-resolve if the group refuses to die (last-resort safety net)
      //
      // Note: this chain only runs after the caller aborts. Watchdog/timeout
      // decisions are owned by the caller (ProgressSupervisor), not this adapter.
      const initiateKill = () => {
        if (settled) return;
        if (sigkillTimer || forceResolveTimer) return; // already in progress

        signalProcessTree('SIGTERM');

        sigkillTimer = setTimeout(() => {
          if (child.pid && isProcessGroupAlive(child.pid)) {
            console.log(`⚠️  Process didn't respond to SIGTERM, escalating to SIGKILL`);
            signalProcessTree('SIGKILL');
          }
        }, 2000);

        forceResolveTimer = setTimeout(() => {
          if (child.pid && isProcessGroupAlive(child.pid)) {
            console.log(`⚠️  Process still alive after SIGKILL attempt; force-resolving to avoid hang`);
          }
          finish({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: 124,
            success: false,
          });
        }, 8000);
      };

      // Subscribe to caller's abort signal
      if (options.signal.aborted) {
        initiateKill();
      } else {
        abortListener = () => initiateKill();
        options.signal.addEventListener('abort', abortListener, { once: true });
      }

      // Handle shell process exit. Foreground process exited but stdio pipes
      // may still be open if a background child inherited them. If 'close'
      // doesn't follow within 5s, force-resolve and reap the process group —
      // this is orthogonal to the abort-driven kill chain above (different
      // scenario: clean foreground exit + lingering background pipe holder).
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

      // Handle process close (fires when all stdio pipes are closed).
      // For normal commands this fires shortly after 'exit'. For commands
      // with background processes it may be delayed — the exit grace timer
      // above handles that. Caller-driven aborts surface here as a non-zero
      // exit code (signal-killed); the caller (ProgressSupervisor) provides
      // the LLM-facing termination message via renderTermination.
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        cleanupTimers();

        const exitCode = code ?? (signal ? 1 : 0);
        options.onExit?.(exitCode);

        finish({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
          success: exitCode === 0,
        });
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

}


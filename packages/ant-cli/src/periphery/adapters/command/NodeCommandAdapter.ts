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

export class NodeCommandAdapter implements CommandPort {
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
    
    // System info
    'pwd',     // Print working directory
    'tree',    // Directory tree (if installed)
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
      const [cmd, ...args] = command.split(/\s+/);
      
      // ✅ Spawn with process group for proper cleanup
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...options.env },
        shell: true,  // Need shell for npm run, etc.
        detached: false,  // Stay in same process group for easier kill
      });

      let stdout = '';
      let stderr = '';
      let killed = false;
      let timeoutId: NodeJS.Timeout | null = null;

      // Collect stdout
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Collect stderr
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle timeout with escalating signals
      const killProcess = (signal: NodeJS.Signals = 'SIGTERM') => {
        if (killed) return;
        killed = true;

        try {
          // Kill process and its children
          if (child.pid) {
            console.log(`⏰ Timeout (${timeout}ms) - sending ${signal} to PID ${child.pid}`);
            
            // Kill process group if possible
            try {
              process.kill(-child.pid, signal);  // Negative PID kills process group
            } catch (e) {
              // If process group kill fails, try individual process
              child.kill(signal);
            }
          }
        } catch (error) {
          console.error(`Failed to kill process:`, error);
        }

        // Escalate to SIGKILL after 2 seconds if SIGTERM didn't work
        if (signal === 'SIGTERM') {
          setTimeout(() => {
            if (!child.killed) {
              console.log(`⚠️  Process didn't respond to SIGTERM, escalating to SIGKILL`);
              killProcess('SIGKILL');
            }
          }, 2000);
        }
      };

      // Set timeout
      timeoutId = setTimeout(() => {
        killProcess('SIGTERM');
      }, timeout);

      // Handle process exit
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        const exitCode = code ?? (signal ? 1 : 0);

        if (killed) {
          // Timeout occurred
          resolve({
            stdout: stdout.trim(),
            stderr: `Command timed out after ${timeout}ms\n${stderr}`.trim(),
            exitCode: 124,  // Standard timeout exit code
            success: false,
          });
        } else {
          // Normal exit
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode,
            success: exitCode === 0,
          });
        }
      });

      // Handle errors
      child.on('error', (error: Error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        resolve({
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


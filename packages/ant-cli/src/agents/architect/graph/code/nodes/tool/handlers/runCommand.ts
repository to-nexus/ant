/**
 * Handle run_command tool
 * 
 * Supports both:
 * - Short-lived commands (build, test, lint) - wait for completion
 * - Long-running commands (npm start, dev servers) - verify startup then terminate (default)
 * 
 * Long-running behavior:
 * 1. Start the process
 * 2. Early error check: fail fast if error within 3 seconds
 * 3. Startup verification: wait up to 5 seconds for successful startup
 * 4. If no error, consider it "started successfully"
 * 5. Terminate process and return success (unless keep_running=true)
 * 
 * This allows verification of "does the server start?" without hanging forever.
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { RunCommandArgs, ServerProcess } from '../types';
import { checkOrchestratorPortSafeguard } from '../utils/helpers';
import { terminateProcessTree } from '../../../../../../../periphery/adapters/command/processTree';
import { 
  LONG_RUNNING_PATTERNS, 
  ERROR_PATTERNS, 
  COMMAND_TIMEOUT,
  EARLY_ERROR_TIMEOUT,
  STARTUP_VERIFICATION_TIMEOUT,
  ORCHESTRATOR_PORT 
} from '../constants';

// 🚨 INTERACTIVE COMMAND DETECTION: Commands that require user input will hang forever
// These patterns detect commands that typically prompt for input (cross-language)
const INTERACTIVE_COMMAND_PATTERNS = [
  // Node.js
  /\bnpm\s+init\b(?!\s+(-y|--yes))/i,    // npm init without -y
  /\byarn\s+init\b(?!\s+(-y|--yes))/i,   // yarn init without -y
  // Go (go mod init requires module name argument)
  /\bgo\s+mod\s+init\s*$/i,              // go mod init without module name
];

export async function handleRunCommand(
  state: ArchitectGraphState,
  args: RunCommandArgs
): Promise<string> {
  const { command, working_directory, keep_running } = args;
  const commandPort = state.deps?.command;
  const fileSystem = state.deps?.fileSystem;
  
  if (!commandPort) {
    throw new Error('CommandPort not available');
  }
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  // 🚨 CRITICAL SAFEGUARD: Prevent killing orchestrator port
  checkOrchestratorPortSafeguard(command, ORCHESTRATOR_PORT);
  
  // 🚨 SAFEGUARD: Warn about potentially interactive commands
  // Only block commands that are DEFINITIVELY interactive (no -y flag)
  // This is a minimal safeguard - the real solution is in prompts
  const isDefinitelyInteractive = INTERACTIVE_COMMAND_PATTERNS.some(pattern => pattern.test(command));
  if (isDefinitelyInteractive) {
    console.warn(`\n   ⚠️ [WARNING] Potentially interactive command detected: ${command}`);
    console.warn(`   This command may require user input. Consider adding -y or --yes flag.\n`);
    
    return `⚠️ COMMAND MAY HANG: ${command}

This command typically requires interactive input, which will cause the process to hang.

✅ Add -y or --yes flag to skip prompts:
- \`npm init -y\` instead of \`npm init\`
- \`yarn init -y\` instead of \`yarn init\`

Or use a different approach that doesn't require initialization.`;
  }
  
  const chatAPI = getChatAPIClient();
  
  // ✅ UI: Show command_running status (loading card)
  // Normalize install commands to avoid "vite missing" when npm is configured with omit=dev.
  // Many environments set: npm config set omit dev
  // If user did not explicitly request production-only, force dev deps for install/ci.
  const shouldForceIncludeDev =
    /\bnpm\s+(ci|install)\b/.test(command) &&
    !/\s--include=dev\b/.test(command) &&
    !/\s--omit=/.test(command) &&
    !/\s--production\b/.test(command) &&
    !/\s--only=prod\b/.test(command);

  const normalizedCommand = shouldForceIncludeDev
    ? `${command} --include=dev`
    : command;

  const mergeIndex = await chatAPI.commandStart(normalizedCommand);
  
  // ✅ FIXED: Test against full command (handles "cd dir && npm run dev")
  const isLongRunning = LONG_RUNNING_PATTERNS.some(pattern => pattern.test(normalizedCommand));

  // Longer timeouts for dependency installation (frequently > 10 minutes on cold caches)
  const isInstallCommand = /\b(npm|pnpm|yarn)\s+(ci|install)\b/.test(normalizedCommand) ||
                           /\bgo\s+mod\s+(tidy|download)\b/.test(normalizedCommand);
  const effectiveTimeout = isInstallCommand ? 20 * 60 * 1000 : COMMAND_TIMEOUT;
  
  // ✅ Resolve working directory - PROJECT ROOT is the base
  // All paths are relative to project root (e.g., ant-ogf/)
  // - codebase/... for code
  // - features/<feature>/inputs/assets/... for assets
  const p = await import('path');
  const projectPath = fileSystem.getRootPath();  // Feature root (scope root for file operations)
  
  const workingDir = working_directory 
    ? (p.isAbsolute(working_directory) ? working_directory : p.join(projectPath, working_directory))
    : projectPath;
  
  console.log(`\n   🔧 Running command: ${normalizedCommand}`);
  console.log(`   📁 Working directory: ${workingDir}`);
  if (isLongRunning) {
    console.log(`   ⏱️  Long-running command detected - will verify startup (10s timeout)\n`);
  } else {
    console.log('');
  }
  
  let streamedStdout = '';
  let streamedStderr = '';
  
  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Long-running command: verify startup, then terminate (default)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (isLongRunning) {
      return await handleLongRunningCommand(
        state,
        normalizedCommand,
        workingDir,
        mergeIndex || 0,
        chatAPI,
        Boolean(keep_running)
      );
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Normal command: wait for completion
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const result = await commandPort.execute(normalizedCommand, {
      cwd: workingDir,
      timeout: effectiveTimeout,
      onStdout: (chunk: string) => {
        streamedStdout += chunk;
        console.log(chunk);
      },
      onStderr: (chunk: string) => {
        streamedStderr += chunk;
        console.error(chunk);
      },
      onExit: (code: number) => {
        console.log(`   Exit code: ${code}`);
      },
    });
    
    // ✅ Use result from execute (more reliable than callbacks)
    const { stdout, stderr, exitCode, success } = result;
    const output = stdout + stderr;
    
    if (success) {
      console.log(`\n   ✅ Command succeeded (exit code: ${exitCode})\n`);
    } else {
      console.error(`\n   ❌ Command failed (exit code: ${exitCode})\n`);
    }
    
    // ✅ UI notification: command complete
    await chatAPI.commandComplete(normalizedCommand, success, exitCode, output, mergeIndex);
    
    // ✅ Format result - emphasize errors for LLM attention
    if (!success) {
      // ❌ BUILD FAILED - Return error-first format
      return `❌ COMMAND FAILED: ${normalizedCommand}
Exit Code: ${exitCode}

📋 ERROR OUTPUT:
${output}

⚠️  You MUST read the error above and fix the specific issue mentioned.
DO NOT guess - the error tells you exactly what's wrong.`;
    }
    
    // ✅ CRITICAL: Detect false-positive success — exit code 0 but stderr contains critical errors.
    // Compound shell commands can mask intermediate failures (e.g., background process crash,
    // "command not found" followed by a succeeding command). Warn the LLM so it doesn't
    // falsely assume the entire operation succeeded.
    const criticalErrorPatterns: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /command not found/i, label: 'command not found' },
      { pattern: /EADDRINUSE|address already in use/i, label: 'port already in use' },
      { pattern: /connection refused/i, label: 'connection refused' },
      { pattern: /panic:/i, label: 'runtime panic' },
      { pattern: /FATAL|fatal error/i, label: 'fatal error' },
      { pattern: /segmentation fault/i, label: 'segmentation fault' },
      { pattern: /out of memory/i, label: 'out of memory' },
    ];
    
    const detectedIssues = criticalErrorPatterns
      .filter(({ pattern }) => pattern.test(stderr) || pattern.test(stdout))
      .map(({ label }) => label);
    
    if (detectedIssues.length > 0) {
      console.warn(`\n   ⚠️  Command exit code 0 but output contains errors: ${detectedIssues.join(', ')}\n`);
      return `⚠️ COMMAND SUCCEEDED (exit code 0) BUT OUTPUT CONTAINS ERRORS: ${normalizedCommand}

⚠️ DETECTED ISSUES IN OUTPUT:
${detectedIssues.map(issue => `- ${issue}`).join('\n')}

Full Output:
${output}

WARNING: Exit code was 0 but the output contains error indicators.
The command may have PARTIALLY FAILED. You MUST check the output carefully
and verify that the intended operation actually succeeded.`;
    }
    
    // ✅ SUCCESS - Return with output (may contain useful warnings/info)
    const hasOutput = output.trim().length > 0;
    
    if (hasOutput) {
      return `✅ COMMAND SUCCEEDED: ${normalizedCommand}
Exit Code: 0

Output:
${output}`;
    } else {
      return `✅ COMMAND SUCCEEDED: ${normalizedCommand}
Exit Code: 0
(No output)`;
    }
  } catch (error) {
    // ✅ Handle timeout or execution errors
    const errorMessage = (error as Error).message;
    console.error(`\n   ❌ Command execution error: ${errorMessage}\n`);
    
    // ✅ UI notification: command failed
    await chatAPI.commandComplete(normalizedCommand, false, -1, errorMessage, mergeIndex);
    
    // ✅ Timeout/execution error - Return error-first format
    return `❌ COMMAND EXECUTION ERROR: ${normalizedCommand}
Error: ${errorMessage}

Captured output:
${streamedStdout}
${streamedStderr}

⚠️  The command timed out or failed to execute. Check the error above.`;
  }
}

/**
 * Handle long-running command (e.g., dev servers)
 */
async function handleLongRunningCommand(
  state: ArchitectGraphState,
  command: string,
  workingDir: string,
  mergeIndex: number,
  chatAPI: any,
  keepRunning: boolean
): Promise<string> {
  const { spawn } = await import('child_process');
  
  return new Promise((resolve, reject) => {
    // ✅ FIXED: Use shell to execute compound commands (cd ... && ...)
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd' : 'sh';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];
    
    console.log(`   🐚 Spawning: ${shell} ${shellArgs[0]} "${command}"`);
    
    const child = spawn(shell, shellArgs, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // ✅ Important: create a new process group so we can terminate the whole tree later
      detached: process.platform !== 'win32'
    });
    
    console.log(`   📋 Process spawned with PID: ${child.pid}`);
    
    let stdout = '';
    let stderr = '';
    let hasError = false;
    let resolved = false;  // ✅ Prevent double resolve/reject
    
    // ✅ Helper to safely resolve/reject once
    const safeResolve = async (message: string, shouldKill = false) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      clearTimeout(earlyErrorTimeout);
      
      // ✅ Only kill if needed (errors or early completion)
      if (shouldKill) {
        if (child.pid) {
          await terminateProcessTree(child.pid);
        } else {
          child.kill('SIGTERM');
        }
      }
      // Otherwise, leave it running (will be cleaned up in learn node)
      
      resolve(message);
    };
    
    const safeReject = async (error: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      clearTimeout(earlyErrorTimeout);
      // Always kill on errors
      if (child.pid) {
        await terminateProcessTree(child.pid);
      } else {
        child.kill('SIGTERM');
      }
      reject(error);
    };
    
    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      console.log(chunk);
      
      // ✅ Also check stdout for errors (some tools print to stdout)
      if (ERROR_PATTERNS.test(chunk)) {
        hasError = true;
      }
    });
    
    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      console.error(chunk);
      
      // ✅ Check for common error patterns
      if (ERROR_PATTERNS.test(chunk)) {
        hasError = true;
      }
    });
    
    child.on('error', (err) => {
      hasError = true;
      stderr += err.message;
      console.error(`   ❌ [SPAWN ERROR] ${err.message}`);
      
      // ✅ Immediate rejection for spawn errors (command not found, etc.)
      safeReject(new Error(`❌ FAILED TO SPAWN PROCESS: ${command}

Spawn error: ${err.message}

This usually means:
- Command not found in PATH
- Permission denied
- Invalid working directory

Working directory: ${workingDir}`));
    });
    
    // ✅ Early error detection: if error detected within 3 seconds, likely startup failure
    const earlyErrorTimeout = setTimeout(() => {
      if (hasError) {
        console.error(`\n   ❌ Early startup error detected (within 3s) - failing fast\n`);
        chatAPI.commandComplete(command, false, 1, `Early error:\n${stderr}\n${stdout}`, mergeIndex);
        safeReject(new Error(`❌ SERVER FAILED TO START: ${command}

Early startup failure detected (within 3 seconds).

Error output:
${stderr.slice(0, 2000)}

Stdout:
${stdout.slice(0, 1000)}`));
      }
    }, EARLY_ERROR_TIMEOUT);
    
    // ✅ Wait 5 seconds for startup verification (most servers start within 2-4s)
    const startupTimeout = setTimeout(async () => {
      // If still running after 5s with no errors = success
      if (!hasError && child.exitCode === null) {
        console.log(`\n   ✅ Server process started, verifying page render...`);
        
        // Extract port from stdout (e.g., "localhost:3000", "port 8080")
        const portMatch = stdout.match(/localhost:(\d+)|port\s+(\d+)|:(\d{4,5})\b/i);
        const port = portMatch ? (portMatch[1] || portMatch[2] || portMatch[3]) : '3000';
        
        // HTTP test to verify page actually renders (catches runtime-only errors)
        let httpTestResult: { ok: boolean; error?: string } = { ok: true };
        try {
          const http = await import('http');
          httpTestResult = await new Promise<{ ok: boolean; error?: string }>((resolveHttp) => {
            const req = http.request({
              hostname: 'localhost',
              port: parseInt(port),
              path: '/',
              method: 'GET',
              timeout: 5000
            }, (res) => {
              let body = '';
              res.on('data', (chunk) => body += chunk);
              res.on('end', () => {
                if (res.statusCode === 200) {
                  resolveHttp({ ok: true });
                } else {
                  // Extract meaningful error from response
                  const errorMatch = body.match(/Error:([^<]+)/i) || body.match(/<pre>([^<]+)<\/pre>/i);
                  const errorMsg = errorMatch ? errorMatch[1].trim().slice(0, 500) : `HTTP ${res.statusCode}`;
                  resolveHttp({ ok: false, error: errorMsg });
                }
              });
            });
            req.on('error', (err) => resolveHttp({ ok: false, error: err.message }));
            req.on('timeout', () => { req.destroy(); resolveHttp({ ok: false, error: 'Request timeout' }); });
            req.end();
          });
        } catch (httpError) {
          // HTTP module error - still consider server started
          console.warn(`   ⚠️  Could not verify page render: ${httpError instanceof Error ? httpError.message : httpError}`);
        }
        
        if (!httpTestResult.ok && httpTestResult.error) {
          // Server started but page render failed - this catches runtime errors!
          console.error(`\n   ❌ Server started but page render failed: ${httpTestResult.error}\n`);
          await chatAPI.commandComplete(command, false, 1, 
            `Server started but page render failed!\n\nStartup output:\n${stdout}\n\n❌ HTTP Test Failed: ${httpTestResult.error}\n\nThis error only appears at runtime. Fix the configuration or code issue.`,
            mergeIndex
          );
          safeReject(new Error(`❌ SERVER STARTED BUT PAGE RENDER FAILED: ${command}

The server process started, but loading the page failed.
This indicates a runtime error (e.g., config incompatibility, missing runtime dependency).

HTTP Test Error: ${httpTestResult.error}

Startup output:
${stdout.slice(0, 1500)}

⚠️ IMPORTANT: If 'npm run build' already succeeded, this dev server issue is environment-specific and NOT blocking.
   For final-verification: Build success = task complete. Output <done>true</done> now.`));
          return;
        }
        
        console.log(`   ✅ Page rendered successfully`);
        if (keepRunning) {
          console.log(`   🔄 Server will continue running (PID: ${child.pid})`);
          console.log(`   🧹 Will be automatically cleaned up when task completes\n`);
        } else {
          console.log(`   🧹 Server will be terminated after verification (PID: ${child.pid})\n`);
        }
        
        // ✅ Store server process for cleanup later (keepRunning only)
        if (keepRunning && child.pid) {
          const serverProcess: ServerProcess = {
            pid: child.pid,
            command,
            workingDir,
            startedAt: Date.now()
          };
          
          state.runningServers = state.runningServers || [];
          state.runningServers.push(serverProcess);
          
          console.log(`   📋 Registered server for cleanup: PID ${child.pid}`);
          console.log(`   Total running servers: ${state.runningServers.length}\n`);
        }
        
        await chatAPI.commandComplete(command, true, 0, 
          keepRunning
            ? `Server started successfully.\n\nStartup output:\n${stdout}\n\n✅ Server is running in background (PID: ${child.pid}).\n✅ Page render verified.\n🧹 Will be automatically cleaned up when task completes.`
            : `Server started successfully.\n\nStartup output:\n${stdout}\n\n✅ Server started without errors.\n✅ Page render verified.\n🧹 Server was terminated after verification.`,
          mergeIndex
        );

        if (keepRunning) {
          safeResolve(`✅ SERVER STARTED SUCCESSFULLY: ${command}

The server started without errors and is running in background.
✅ Page render verified (HTTP 200)

PID: ${child.pid}
Working Directory: ${workingDir}

Startup output:
${stdout.slice(0, 2000)}${stdout.length > 2000 ? '\n...(truncated)' : ''}

✅ The server will continue running for testing.
🧹 It will be automatically cleaned up when the task completes.`);
        } else {
          safeResolve(`✅ SERVER STARTED SUCCESSFULLY: ${command}

The server started without errors.
✅ Page render verified (HTTP 200)

PID: ${child.pid}
Working Directory: ${workingDir}

Startup output:
${stdout.slice(0, 2000)}${stdout.length > 2000 ? '\n...(truncated)' : ''}

🧹 Server was terminated after verification (default behavior).`, true);
        }
      } else if (hasError) {
        // ✅ If error detected but process still running after 10s, fail
        console.error(`\n   ❌ Error detected during startup - failing\n`);
        await chatAPI.commandComplete(command, false, 1, `Error:\n${stderr}\n${stdout}`, mergeIndex);
        safeReject(new Error(`❌ SERVER FAILED TO START: ${command}

Error detected during startup:
${stderr.slice(0, 2000)}

Stdout:
${stdout.slice(0, 1000)}`));
      }
    }, STARTUP_VERIFICATION_TIMEOUT);
    
    child.on('exit', async (code, signal) => {
      const output = stdout + stderr;
      
      // ✅ Early exit (before 10s) is usually an error
      if (code === 0 && !hasError) {
        await chatAPI.commandComplete(command, true, 0, output, mergeIndex);
        safeResolve(`✅ Command completed: ${command}\n\nOutput:\n${output.slice(0, 3000)}`, true);  // Ensure termination
      } else {
        // ✅ Non-zero exit or detected error
        await chatAPI.commandComplete(command, false, code || 1, output, mergeIndex);
        safeReject(new Error(`❌ SERVER FAILED TO START: ${command}

Exit code: ${code || 'killed'}
Signal: ${signal || 'none'}

Error output:
${stderr.slice(0, 2000)}

Stdout:
${stdout.slice(0, 1000)}`));
      }
    });
  });
}


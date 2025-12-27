/**
 * Handle run_command tool
 * 
 * Supports both:
 * - Short-lived commands (build, test, lint) - wait for completion
 * - Long-running commands (npm start, dev servers) - verify startup then terminate
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
import { 
  LONG_RUNNING_PATTERNS, 
  ERROR_PATTERNS, 
  COMMAND_TIMEOUT,
  EARLY_ERROR_TIMEOUT,
  STARTUP_VERIFICATION_TIMEOUT,
  ORCHESTRATOR_PORT 
} from '../constants';

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
  
  const chatAPI = getChatAPIClient();
  
  // ✅ UI: Show command_running status (loading card)
  const mergeIndex = await chatAPI.commandStart(command);
  
  // ✅ FIXED: Test against full command (handles "cd dir && npm run dev")
  const isLongRunning = LONG_RUNNING_PATTERNS.some(pattern => pattern.test(command));
  
  // Get project path from FileSystemPort
  const projectPath = fileSystem.getWorkspaceRoot();
  const workingDir = working_directory 
    ? `${projectPath}/${working_directory}`
    : projectPath;
  
  console.log(`\n   🔧 Running command: ${command}`);
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
    // Long-running command: verify startup, then terminate
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (isLongRunning && !keep_running) {
      return await handleLongRunningCommand(state, command, workingDir, mergeIndex || 0, chatAPI);
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Normal command: wait for completion
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const result = await commandPort.execute(command, {
      cwd: workingDir,
      timeout: COMMAND_TIMEOUT,
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
    await chatAPI.commandComplete(command, success, exitCode, output, mergeIndex);
    
    // ✅ Format result - emphasize errors for LLM attention
    if (!success) {
      // ❌ BUILD FAILED - Return error-first format
      return `❌ COMMAND FAILED: ${command}
Exit Code: ${exitCode}

📋 ERROR OUTPUT:
${output}

⚠️  You MUST read the error above and fix the specific issue mentioned.
DO NOT guess - the error tells you exactly what's wrong.`;
    }
    
    // ✅ SUCCESS - Return with output (may contain useful warnings/info)
    const hasOutput = output.trim().length > 0;
    
    if (hasOutput) {
      return `✅ COMMAND SUCCEEDED: ${command}
Exit Code: 0

Output:
${output}`;
    } else {
      return `✅ COMMAND SUCCEEDED: ${command}
Exit Code: 0
(No output)`;
    }
  } catch (error) {
    // ✅ Handle timeout or execution errors
    const errorMessage = (error as Error).message;
    console.error(`\n   ❌ Command execution error: ${errorMessage}\n`);
    
    // ✅ UI notification: command failed
    await chatAPI.commandComplete(command, false, -1, errorMessage, mergeIndex);
    
    // ✅ Timeout/execution error - Return error-first format
    return `❌ COMMAND EXECUTION ERROR: ${command}
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
  chatAPI: any
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
      stdio: ['ignore', 'pipe', 'pipe']
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
        child.kill('SIGTERM');
      }
      // Otherwise, leave it running (will be cleaned up in learn node)
      
      resolve(message);
    };
    
    const safeReject = async (error: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      clearTimeout(earlyErrorTimeout);
      child.kill('SIGTERM');  // Always kill on errors
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
        console.log(`\n   ✅ Server started successfully (verified 5s startup)`);
        console.log(`   🔄 Server will continue running (PID: ${child.pid})`);
        console.log(`   🧹 Will be automatically cleaned up when task completes\n`);
        
        // ✅ Store server process for cleanup later
        if (child.pid) {
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
          `Server started successfully.\n\nStartup output:\n${stdout}\n\n✅ Server is running in background (PID: ${child.pid}).\n🧹 Will be automatically cleaned up when task completes.`,
          mergeIndex
        );
        
        safeResolve(`✅ SERVER STARTED SUCCESSFULLY: ${command}

The server started without errors and is running in background.

PID: ${child.pid}
Working Directory: ${workingDir}

Startup output:
${stdout.slice(0, 2000)}${stdout.length > 2000 ? '\n...(truncated)' : ''}

✅ The server will continue running for testing.
🧹 It will be automatically cleaned up when the task completes.`);
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
        safeResolve(`✅ Command completed: ${command}\n\nOutput:\n${output.slice(0, 3000)}`, true);  // Kill on early completion
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


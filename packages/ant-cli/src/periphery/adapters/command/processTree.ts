/**
 * Process tree utilities (POSIX + Windows best-effort)
 *
 * Centralized here to avoid copy-pasted kill logic across adapters/handlers.
 */

export function isProcessGroupAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    // Negative PID checks the process group on POSIX
    process.kill(-pid, 0);
    return true;
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

export async function terminateProcessTree(pid: number): Promise<void> {
  if (!pid || pid <= 0) return;

  // Windows: best-effort kill process tree
  if (process.platform === 'win32') {
    try {
      const { spawn } = await import('child_process');
      await new Promise<void>((resolve) => {
        const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        child.on('exit', () => resolve());
        child.on('error', () => resolve());
      });
      return;
    } catch {
      // fall through to POSIX-ish best effort
    }
  }

  // POSIX: kill process group first (works well with detached=true)
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  // Give it a moment, then escalate
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    if (isProcessGroupAlive(pid)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    // already stopped
  }
}



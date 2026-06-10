/**
 * Idle-sleep assertion for the duration of a job-runner child.
 *
 * A busy Node process does NOT hold off OS idle sleep. When the host suspends,
 * the job child freezes, its LLM socket dies, and the BullMQ lock lapses — the
 * worker then tears the job down with reason `system_sleep`. Holding a power
 * assertion while a job child is alive prevents that for the common idle-sleep
 * case. Lid-close / forced sleep / unsupported platforms still fall through to
 * the platform-independent `system_sleep` resumable-pause path.
 *
 * Host-environment adapter, gated on OS capability (`process.platform`), not on
 * local/cloud mode — it does not fork the data plane. Dependency-free: every
 * branch shells out to a built-in tool, no native npm module.
 */

import { spawn, ChildProcess } from 'child_process';
import { logger } from '../../utils/logger';

// ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001)
const WIN_EXEC_STATE = '0x80000001';

/**
 * Hold an idle-sleep assertion tied to `pid`'s lifetime. The returned watchdog
 * child exits automatically when `pid` exits (so the assertion releases itself);
 * the caller may also `.kill()` it defensively. Returns `undefined` when the
 * platform is unsupported or spawning failed — it MUST never throw into the
 * job-spawn path.
 */
export function holdIdleSleepAssertion(pid: number): ChildProcess | undefined {
  try {
    const platform = process.platform;

    let command: string;
    let args: string[];

    if (platform === 'darwin') {
      // -i: prevent idle system sleep (works on battery, unlike -s).
      // -w <pid>: caffeinate exits when pid exits → assertion auto-releases.
      command = 'caffeinate';
      args = ['-i', '-w', String(pid)];
    } else if (platform === 'win32') {
      // SetThreadExecutionState holds while this PowerShell process lives;
      // Wait-Process ties that lifetime to the job child, and Windows clears
      // the thread execution state automatically when PowerShell exits.
      const script =
        `$s=Add-Type -MemberDefinition '[DllImport("kernel32.dll")]public static extern uint SetThreadExecutionState(uint e);' ` +
        `-Name P -Namespace W -PassThru; ` +
        `[void]$s::SetThreadExecutionState([uint32]'${WIN_EXEC_STATE}'); ` +
        `Wait-Process -Id ${pid}`;
      // Windows PowerShell 5.1 is always present; pwsh (7+) may be absent.
      command = 'powershell';
      args = ['-NoProfile', '-NonInteractive', '-Command', script];
    } else {
      // linux / others: cloud & K8s never idle-sleep; desktop degrades to #3.
      return undefined;
    }

    const guard = spawn(command, args, { stdio: 'ignore' });
    // Async spawn failure (e.g. binary missing) lands here, not as a throw.
    guard.on('error', (err) => {
      logger.debug(`Idle-sleep assertion unavailable (${command}): ${err.message}`, {
        component: 'SleepAssertion',
      });
    });
    return guard;
  } catch (err: any) {
    logger.debug(`Idle-sleep assertion skipped: ${err?.message ?? err}`, {
      component: 'SleepAssertion',
    });
    return undefined;
  }
}

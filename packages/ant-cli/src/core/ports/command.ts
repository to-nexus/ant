/**
 * Command Port
 * Interface for executing shell commands.
 *
 * The adapter owns spawn + kill-cleanup only. Timeout / watchdog semantics
 * live in `ProgressSupervisor` (handler layer). To abort an in-flight
 * command, the caller aborts the `AbortSignal` it passed in; the adapter
 * then runs SIGTERM → SIGKILL (2s grace) → force-resolve (8s safety net).
 */

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface CommandOptions {
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;

  /**
   * Abort channel. Required.
   *
   * When the caller aborts this signal, the adapter sends SIGTERM to the
   * spawned process group, escalates to SIGKILL after 2 seconds, and
   * force-resolves after 8 seconds if the process group is still alive.
   *
   * Watchdog / timeout decisions are made by the caller (typically
   * ProgressSupervisor); the adapter does not own any timeout policy.
   */
  signal: AbortSignal;

  /** Extra environment variables (merged with sanitized parent env). */
  env?: Record<string, string>;

  /** Real-time stdout streaming. */
  onStdout?: (chunk: string) => void;

  /** Real-time stderr streaming. */
  onStderr?: (chunk: string) => void;

  /** Fires once when the child process exits (before stdio close). */
  onExit?: (code: number) => void;
}

export interface CommandPort {
  /** Execute a command and resolve once the child has fully closed. */
  execute(command: string, options: CommandOptions): Promise<CommandResult>;

  /** Check if a command is allowed to run (allowlist policy). */
  isAllowed(command: string): boolean;
}

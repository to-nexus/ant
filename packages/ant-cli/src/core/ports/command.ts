/**
 * Command Port
 * Interface for executing shell commands
 * 
 * Used for:
 * - Package installation (npm/pnpm/yarn install)
 * - Build/test commands
 */

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface CommandOptions {
  cwd?: string;           // Working directory
  timeout?: number;       // Timeout in ms (default: 5 minutes)
  env?: Record<string, string>;  // Environment variables
  // ✅ NEW: Streaming callbacks (for tool calling)
  onStdout?: (chunk: string) => void;  // Real-time stdout streaming
  onStderr?: (chunk: string) => void;  // Real-time stderr streaming
  onExit?: (code: number) => void;     // Exit code callback
}

export interface CommandPort {
  /**
   * Execute a command and return the result
   */
  execute(command: string, options?: CommandOptions): Promise<CommandResult>;

  /**
   * Check if a command is allowed to run (security)
   */
  isAllowed(command: string): boolean;
}


/**
 * Tool Module Types
 * 공유 타입 정의
 */

import { ArchitectGraphState } from '../../state';

export interface ToolHandler {
  (state: ArchitectGraphState, args: any): Promise<string | string[]>;
}

export interface CommandExecutionResult {
  command: string;
  success: boolean;
  exitCode?: number;
}

export interface ServerProcess {
  pid: number;
  command: string;
  workingDir: string;
  startedAt: number;
}

export interface ReadFileArgs {
  path: string;
}

export interface ListFilesArgs {
  directory?: string;
  pattern?: string;
}

export interface SearchCodeArgs {
  pattern: string;
  file_pattern?: string;
}

export interface DeleteFileArgs {
  path: string;
}

export interface EditFileArgs {
  path: string;
  old_str: string;
  new_str: string;
}

export interface MkdirArgs {
  path: string;
}

export interface RunCommandArgs {
  command: string;
  working_directory?: string;
  keep_running?: boolean;
}

export interface SearchReferenceCodeArgs {
  project: string;
  query: string;
  maxFiles?: number;
}

export interface CreateFileArgs {
  path: string;
  content: string;
}


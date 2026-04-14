/**
 * Tool Module Constants
 *
 * Re-exports from common/tool/constants.ts (canonical location).
 * This file exists only for backward compatibility during migration
 * and will be deleted once all code/nodes/tool/ consumers are migrated.
 */

export {
  LONG_RUNNING_PATTERNS,
  ERROR_PATTERNS,
  COMMAND_TIMEOUT,
  EARLY_ERROR_TIMEOUT,
  STARTUP_VERIFICATION_TIMEOUT,
  UI_CARD_ANIMATION_DELAY,
  COMPILE_RUN_STARTUP_TIMEOUT,
  COMPILE_RUN_PATTERNS,
  SERVER_DETECTION_TIMEOUT,
  SERVER_OUTPUT_PATTERNS,
  ORCHESTRATOR_PORT,
  TYPECHECK_COMMAND_PATTERNS,
  BUILD_COMMAND_PATTERNS,
  TEST_COMMAND_PATTERNS,
  isTypecheckCommand,
  isBuildCommand,
  isTestCommand,
} from '../../../../../common/tool/constants';

/**
 * @deprecated Use TOOL_DISPLAY_NAMES from common/tool/toolCatalog.ts instead.
 */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'read_file': '📖 Reading file',
  'list_files': '📂 Listing files',
  'search_code': '🔍 Searching code',
  'delete_file': '🗑️ Deleting file',
  'mkdir': '📁 Creating directory',
  'run_command': '⚙️ Running command',
  'search_reference_code': '🔎 Searching reference',
  'file': '📄 Creating file',
  'write_file': '📄 Creating file',
  'create_file': '📄 Creating file'
};

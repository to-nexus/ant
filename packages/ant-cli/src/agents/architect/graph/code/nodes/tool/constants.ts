/**
 * Tool Module Constants
 * 도구 관련 상수 정의
 */

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'read_file': '📖 Reading file',
  'list_files': '📂 Listing files',
  'search_code': '🔍 Searching code',
  'delete_file': '🗑️ Deleting file',
  'mkdir': '📁 Creating directory',
  'run_command': '⚙️ Running command',
  'search_reference_code': '🔎 Searching reference'
};

export const LONG_RUNNING_PATTERNS = [
  /npm\s+run\s+dev\b/,
  /npm\s+run\s+serve\b/,
  /npm\s+run\s+start\b/,
  /npm\s+start\b/,
  /yarn\s+dev\b/,
  /yarn\s+serve\b/,
  /yarn\s+start\b/,
  /yarn\s+run\s+dev\b/,
  /yarn\s+run\s+serve\b/,
  /yarn\s+run\s+start\b/,
  /pnpm.*\s+dev\b/,
  /pnpm.*\s+serve\b/,
  /pnpm.*\s+start\b/,
  /node\s+.*server\.(js|ts)\b/,
  /tsx\s+.*server\.(js|ts)\b/,
  /nodemon\b/,
  /npx\s+vite\b/,
  /npx\s+next\s+dev\b/,
  /npx\s+react-scripts\s+start\b/,
  /vite\s*$/,
];

export const ERROR_PATTERNS = /error|Error|ERR_|EADDRINUSE|ENOENT|Cannot find|Transform failed|Unexpected|Exception/i;

export const COMMAND_TIMEOUT = 3 * 60 * 1000; // 3 minutes
export const EARLY_ERROR_TIMEOUT = 3000; // 3 seconds
export const STARTUP_VERIFICATION_TIMEOUT = 5000; // 5 seconds
export const UI_CARD_ANIMATION_DELAY = 150; // 150ms

export const ORCHESTRATOR_PORT = process.env.ANT_CLI_PORT || '4100';


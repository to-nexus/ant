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
  'search_reference_code': '🔎 Searching reference',
  'file': '📄 Creating file',
  'write_file': '📄 Creating file',
  'create_file': '📄 Creating file'
};

export const LONG_RUNNING_PATTERNS = [
  // ── Node.js / Frontend ──
  /npm\s+run\s+dev\b/,
  /npm\s+run\s+serve\b/,
  /npm\s+run\s+start\b/,
  /npm\s+run\s+preview\b/,
  /npm\s+start\b/,
  /yarn\s+dev\b/,
  /yarn\s+serve\b/,
  /yarn\s+start\b/,
  /yarn\s+preview\b/,
  /yarn\s+run\s+dev\b/,
  /yarn\s+run\s+serve\b/,
  /yarn\s+run\s+start\b/,
  /yarn\s+run\s+preview\b/,
  /pnpm.*\s+dev\b/,
  /pnpm.*\s+serve\b/,
  /pnpm.*\s+start\b/,
  /pnpm.*\s+preview\b/,
  /node\s+.*server\.(js|ts)\b/,
  /tsx\s+.*server\.(js|ts)\b/,
  /nodemon\b/,
  /npx\s+vite\b/,
  /npx\s+vite\s+preview\b/,
  /npx\s+next\s+dev\b/,
  /npx\s+react-scripts\s+start\b/,
  /vite\s*$/,
  /vite\s+preview\b/,

  // ── Go ──
  /go\s+run\s+/,                // go run main.go, go run ./cmd/server
  /\bair\b/,                     // air (Go hot-reload dev server)

  // ── Rust ──
  /cargo\s+run\b/,              // cargo run

  // ── Compiled binary after build chain ──
  /&&\s*\.\/[a-zA-Z_][\w-]*\s*$/,   // cd dir && ./main, go build && ./app
  /go\s+build.*&&.*\.\/[\w-]+/,      // go build -o app && ./app

  // ── Makefile (cross-language) ──
  /make\s+(run|serve|dev)\b/,   // make run, make serve, make dev
];

export const ERROR_PATTERNS = /error|Error|ERR_|EADDRINUSE|ENOENT|Cannot find|Transform failed|Unexpected|Exception/i;

// Precision-oriented patterns for post-HTTP-success stderr sweep.
// ERROR_PATTERNS is broad (recall-first) for early failure detection.
// CRITICAL_RUNTIME_PATTERNS is narrow (precision-first): only matches
// errors that NEVER appear in normal dev server output.
export const CRITICAL_RUNTIME_PATTERNS = /SyntaxError|ReferenceError|TypeError:|Module not found|Cannot find module|Failed to compile|EADDRINUSE|Segmentation fault|FATAL ERROR|heap out of memory/i;

// After HTTP test succeeds, wait this long for lazy compilation (Vite/Next.js)
// to finish before scanning stderr for critical errors.
export const POST_HTTP_GRACE_MS = 3000;

// Many real-world commands (npm install, pnpm install, building large bundles)
// frequently exceed 3 minutes. Keep a more forgiving default to avoid partial installs.
export const COMMAND_TIMEOUT = 10 * 60 * 1000; // 10 minutes
export const EARLY_ERROR_TIMEOUT = 3000; // 3 seconds
export const STARTUP_VERIFICATION_TIMEOUT = 5000; // 5 seconds
export const UI_CARD_ANIMATION_DELAY = 150; // 150ms

// Compile-and-run languages (Go, Rust) need longer startup verification
// because `go run` / `cargo run` compile before executing.
export const COMPILE_RUN_STARTUP_TIMEOUT = 30000; // 30 seconds

// Patterns that indicate a compile-and-run language (needs longer startup timeout)
export const COMPILE_RUN_PATTERNS = [
  /go\s+run\b/,
  /cargo\s+run\b/,
  /cargo\s+build.*&&/,
  /go\s+build.*&&/,
];

// Runtime fallback: detect regular commands that are actually long-running servers.
// If a regular (non-LONG_RUNNING_PATTERNS) command runs longer than this without exiting
// AND its output matches SERVER_OUTPUT_PATTERNS, auto-terminate instead of blocking.
export const SERVER_DETECTION_TIMEOUT = 60000; // 60 seconds
export const SERVER_OUTPUT_PATTERNS = /listening\s+on|started\s+.*(?:server|port)|starting\s+server|server\s+(?:started|running|listening)|port\s+\d{4,5}|:\d{4,5}\b/i;

export const ORCHESTRATOR_PORT = process.env.PORT || '8080';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPECHECK / BUILD / TEST command classification
// Used by VerificationTracker to track objective completion.
// Conservative: false-negative → extra build cycle (safe);
//               false-positive → unverified code passes (dangerous).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const TYPECHECK_COMMAND_PATTERNS: RegExp[] = [
  /\b(npx\s+)?tsc\b[^|;&]*--noEmit\b/,
];

export const BUILD_COMMAND_PATTERNS: RegExp[] = [
  /\b(npm|yarn)\s+(run\s+)?build\b/,
  /\bpnpm\b[^;&|]*\b(run\s+)?build\b/,
  /\bbun\s+(run\s+)?build\b/,
  /\b(npx\s+)?(next|vite|nuxt|gatsby|remix|astro|react-scripts)\s+build\b/,
  /\b(npx\s+)?turbo\s+(run\s+)?build\b/,
  /\b(npx\s+)?tsc\b/,
  /\bgo\s+build\b/,
  /\bmake\s+build\b/,
];

export const TEST_COMMAND_PATTERNS: RegExp[] = [
  /\b(npm|yarn)\s+(run\s+)?test\b/,
  /\bpnpm\b[^;&|]*\b(run\s+)?test\b/,
  /\bbun\s+(run\s+)?test\b/,
  /\b(npx\s+)?(jest|vitest|mocha)\b/,
  /\b(npx\s+)?playwright\s+test\b/,
  /\b(npx\s+)?cypress\s+run\b/,
  /\bgo\s+test\b/,
  /\bmake\s+test\b/,
];

export function isTypecheckCommand(command: string): boolean {
  return TYPECHECK_COMMAND_PATTERNS.some(p => p.test(command));
}

export function isBuildCommand(command: string): boolean {
  if (isTypecheckCommand(command)) return false;
  return BUILD_COMMAND_PATTERNS.some(p => p.test(command));
}

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND_PATTERNS.some(p => p.test(command));
}



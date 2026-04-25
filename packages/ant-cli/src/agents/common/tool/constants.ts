/**
 * Tool Constants
 *
 * Command execution patterns, timeouts, and verification command classifiers.
 * Moved from architect/graph/code/nodes/tool/constants.ts to eliminate
 * layer violations (common/tool/handlers/ was importing from architect/).
 */

// LONG_RUNNING_PATTERNS: syntax hint (pre-spawn) — "looks like a dev server".
// COMPILE_RUN_PATTERNS: syntax hint — needs longer startup (go run / cargo run).
// SERVER_OUTPUT_PATTERNS: runtime hint — output looks server-like. Don't fold.
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

/** Used ONLY by `handleLongRunningCommand.earlyErrorTimeout` (3s window). Do not reuse elsewhere — `/error/i` false-positives on benign substrings. */
export const ERROR_PATTERNS = /error|Error|ERR_|EADDRINUSE|ENOENT|Cannot find|Transform failed|Unexpected|Exception/i;

// Many real-world commands (npm install, pnpm install, building large bundles)
// frequently exceed 3 minutes. Keep a more forgiving default to avoid partial installs.
export const COMMAND_TIMEOUT = 10 * 60 * 1000; // 10 minutes
export const EARLY_ERROR_TIMEOUT = 3000; // 3 seconds
export const STARTUP_VERIFICATION_TIMEOUT = 5000; // 5 seconds

// Compile-and-run languages (Go, Rust) need longer startup verification
// because `go run` / `cargo run` compile before executing.
export const COMPILE_RUN_STARTUP_TIMEOUT = 30000; // 30 seconds

export const COMPILE_RUN_PATTERNS = [
  /go\s+run\b/,
  /cargo\s+run\b/,
  /cargo\s+build.*&&/,
  /go\s+build.*&&/,
];

// Runtime fallback: detect regular commands that are actually long-running servers.
export const SERVER_DETECTION_TIMEOUT = 60000; // 60 seconds
export const SERVER_OUTPUT_PATTERNS = /listening\s+on|started\s+.*(?:server|port)|starting\s+server|server\s+(?:started|running|listening)|port\s+\d{4,5}|:\d{4,5}\b/i;

export const ORCHESTRATOR_PORT = process.env.PORT || '8080';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Verification gate classification — retired
//
// `TYPECHECK / BUILD / TEST` regex patterns and the `is*Command` helpers
// were the executor-side inverse of the LLM's `verifies` declaration. They
// silently mismatched script-name spellings such as `npm run type-check`
// (hyphen breaks the `\btypecheck\b` boundary), causing gate flips to be
// dropped and the diagnostic cycle to waste a retry round.
//
// The new SSOT for "which gate is this command exercising" is the LLM's
// `verifies` argument on the `run_command` tool call, propagated through
// the `commandExecuted` sideEffect into `VerificationSession.onCommand`.
// See `docs/tmp/gate-classification-postmortem.md` for the postmortem and
// the constraint set this retirement preserves.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

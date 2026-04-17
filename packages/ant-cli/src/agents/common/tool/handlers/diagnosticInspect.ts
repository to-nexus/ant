/**
 * Axis G-5 — Diagnostic inspection command allow-list.
 *
 * Deep-diagnostic mode needs to reach for read-only inspection commands that
 * the default loop guard rejects as "already tried". These commands do not
 * mutate state; allowing a generous set speeds up root-cause discovery for
 * configuration / dependency-version / peer-dependency issues.
 *
 * The allow-list is prefix-based to accept arbitrary arguments (e.g.
 * `pnpm why react`, `cat tsconfig.json | jq .compilerOptions`).
 */

const DIAGNOSTIC_INSPECT_PATTERNS: RegExp[] = [
  /^\s*cat\s+/,
  /^\s*ls\b/,
  /^\s*head\s+/,
  /^\s*tail\s+/,
  /^\s*find\s+/,
  /^\s*grep\b/,
  /^\s*rg\b/,
  /^\s*wc\s+/,
  /^\s*stat\s+/,
  /^\s*which\s+/,
  /^\s*file\s+/,
  /^\s*echo\s+\$/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*npm\s+(why|ls|list|view|config|prefix|root|bin)\b/,
  /^\s*pnpm\s+(why|list|ls|view|config|store|root|bin)\b/,
  /^\s*yarn\s+(why|list|info|config)\b/,
  /^\s*bun\s+(pm\s+ls|pm\s+view|info)\b/,
  /^\s*go\s+(list|env|version|version\s+-m)\b/,
  /^\s*node\s+-v\b/,
  /^\s*node\s+--version\b/,
  /^\s*npx\s+(tsc\s+--version|tsc\s+-v)\b/,
  /^\s*tsc\s+--version\b/,
  /^\s*tsc\s+-v\b/,
  /^\s*git\s+(status|log|diff|show)\b/,
];

/**
 * Whether the command is a pure read-only inspection that should bypass
 * the loop-guard and budget counter in deep-diagnostic mode.
 */
export function isDiagnosticInspectCommand(command: string): boolean {
  if (!command) return false;
  return DIAGNOSTIC_INSPECT_PATTERNS.some(p => p.test(command));
}

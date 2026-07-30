/**
 * `core/utils/runtimeErrorPattern` — single source of truth for detecting
 * whether a user-supplied directive describes a runtime error / failure
 * scenario.
 *
 * Replaces two pre-existing definitions that drifted:
 *   - `containsRuntimeErrorPattern` (verbose pattern set, used by
 *     `execute/buildMessages.ts` to gate the runtime-error-fix injection)
 *   - inline IIFE in `decompose/index.ts` (narrower keyword set, used to
 *     compute `hasErrorInDirective` for the `error-or-general` decompose
 *     template branch)
 *
 * Both call sites now call this helper; the union of the two original
 * pattern sets is preserved so neither call site loses coverage.
 *
 * Adding new pattern variants → add them HERE, not in a new copy.
 */
export function containsRuntimeErrorPattern(directive: string | undefined | null): boolean {
  if (!directive) return false;
  const lower = directive.toLowerCase();
  return ERROR_PATTERNS.some(pattern => pattern.test(directive)) ||
    ERROR_KEYWORD_PATTERN.test(lower);
}

const ERROR_PATTERNS: readonly RegExp[] = [
  /Error:/i, /TypeError/i, /ReferenceError/i, /SyntaxError/i,
  /RangeError/i, /ELIFECYCLE/i, /npm ERR!/i,
  /\s+at\s+\S+\s+\(/i, /node_modules/i,
  /failed to/i, /cannot find/i, /undefined is not/i,
  /unexpected token/i, /module not found/i, /command failed/i,
  /compilation error/i, /\$ npm run/i, /\$ node /i,
  /Process exited with code/i, /test.*failed/i,
  /assertion.*failed/i, /expected.*but got/i,
];

const ERROR_KEYWORD_PATTERN =
  /\b(error|exception|crash|fail(ed|ure|s)?|stack\s*trace|cannot\s+read|is\s+not\s+(a\s+function|defined)|unexpected\s+token|module\s+not\s+found|typeerror|referenceerror|syntaxerror)\b/;

/**
 * Strict variant — matches only verbatim machine failure output (build /
 * compile error output, stack traces, test failure output, crash reports).
 * Deliberately excludes `ERROR_KEYWORD_PATTERN`: a user *calling* something
 * an error/bug must not trip this predicate. Used by decompose's
 * error-vs-feature misclassification check, which must stay aligned with the
 * decompose Task Type Rules ("error" requires a machine failure signal).
 */
export function containsMachineFailureSignal(directive: string | undefined | null): boolean {
  if (!directive) return false;
  return MACHINE_FAILURE_PATTERNS.some(pattern => pattern.test(directive));
}

const MACHINE_FAILURE_PATTERNS: readonly RegExp[] = [
  /\berror:\s/i,                    // "Error: ..." canonical error output
  /\b\w+(Error|Exception)\b/,       // TypeError, NullPointerException, ... (PascalCase identifiers)
  /\s+at\s+.*\(.*:\d+:\d+\)/,       // stack frame with file:line:col
  /exit code:?\s*[1-9]/i,
  /failed to compile/i,
  /build failed/i,
  /npm ERR!/,
  /ELIFECYCLE/,
  /\btests?\s+failed\b/i,
  /assertion.*failed/i,
  /expected.*but got/i,
];

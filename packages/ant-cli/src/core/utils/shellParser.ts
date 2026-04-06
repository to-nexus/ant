/**
 * Shell Command Parser Utilities
 *
 * Quote-aware parsing of shell command strings. Respects single quotes,
 * double quotes, and backslash escapes when splitting on shell operators.
 *
 * Used by:
 * - NodeCommandAdapter.isAllowed() — command allowlist validation
 * - extractWriteTargets() — pre-execution write guard
 * - SIGPIPE detection — actual pipe presence check
 */

/**
 * Split a command string on shell operators (&&, ||, ;, |) while
 * respecting single/double quotes and backslash escapes.
 *
 * Prevents false positives where in-pattern characters like grep's
 * BRE alternation (\|) or ERE alternation (|) inside quotes are
 * mistaken for shell pipe operators.
 */
export function splitOnShellOperators(command: string): string[] {
  return splitOnOperators(command, true);
}

/**
 * Detect whether a command contains an actual shell pipe operator (|)
 * outside of quotes/escapes. Returns false for grep BRE (\|) or
 * ERE (|) patterns inside quoted strings, and for logical OR (||).
 */
export function hasActualPipe(command: string): boolean {
  return splitOnOperators(command, true).length >
    splitOnOperators(command, false).length;
}

/**
 * Tokenize a single shell command segment into words, respecting
 * single/double quotes and backslash escapes.
 *
 * Unlike split(/\s+/), this correctly keeps `FOO="bar baz"` as one token
 * and `echo 'hello world'` as two tokens: ['echo', "'hello world'"].
 */
export function tokenizeShellSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;

  while (i < segment.length) {
    const ch = segment[i];

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < segment.length) {
      current += ch + segment[i + 1];
      i += 2;
      continue;
    }

    if (ch === "'") {
      const end = segment.indexOf("'", i + 1);
      if (end === -1) {
        current += segment.slice(i);
        i = segment.length;
      } else {
        current += segment.slice(i, end + 1);
        i = end + 1;
      }
      continue;
    }

    if (ch === '"') {
      current += '"';
      let j = i + 1;
      while (j < segment.length) {
        if (segment[j] === '\\' && j + 1 < segment.length) {
          current += segment[j] + segment[j + 1];
          j += 2;
        } else if (segment[j] === '"') {
          current += '"';
          j++;
          break;
        } else {
          current += segment[j];
          j++;
        }
      }
      i = j;
      continue;
    }

    current += ch;
    i++;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

// ── Internal ────────────────────────────────────────────────────────

/**
 * Core splitting logic shared by splitOnShellOperators and hasActualPipe.
 * When `includePipe` is false, single `|` is treated as a literal character.
 */
function splitOnOperators(command: string, includePipe: boolean): string[] {
  const segments: string[] = [];
  let current = '';
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === '\\') {
      current += ch;
      if (i + 1 < command.length) {
        current += command[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) {
        current += command.slice(i);
        i = command.length;
      } else {
        current += command.slice(i, end + 1);
        i = end + 1;
      }
      continue;
    }

    if (ch === '"') {
      current += '"';
      let j = i + 1;
      while (j < command.length) {
        if (command[j] === '\\' && j + 1 < command.length) {
          current += command[j] + command[j + 1];
          j += 2;
        } else if (command[j] === '"') {
          current += '"';
          j++;
          break;
        } else {
          current += command[j];
          j++;
        }
      }
      i = j;
      continue;
    }

    if (ch === '&' && i + 1 < command.length && command[i + 1] === '&') {
      segments.push(current);
      current = '';
      i += 2;
      continue;
    }

    if (ch === '|' && i + 1 < command.length && command[i + 1] === '|') {
      segments.push(current);
      current = '';
      i += 2;
      continue;
    }

    if (ch === '|' && includePipe) {
      segments.push(current);
      current = '';
      i++;
      continue;
    }

    if (ch === ';') {
      segments.push(current);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) {
    segments.push(current);
  }

  return segments;
}

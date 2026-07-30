/**
 * Unit tests for `src/core/utils/shellParser` — the SINGLE owner of these four
 * pure functions.
 *
 * The `splitOnShellOperators` / `tokenizeShellSegment` / `hasActualPipe` cases
 * below were merged in from `tests/infra/command-allowlist.test.ts`, which had
 * grown a parallel copy of all three (with a richer case set than this file
 * carried). Two suites unit-testing the same pure function is how the two
 * copies drift; that file now covers only `NodeCommandAdapter.isAllowed`, and
 * parser behaviour lives here.
 */
import { describe, expect, it } from 'vitest';
import {
  hasActualPipe,
  maskQuotedRegions,
  splitOnShellOperators,
  tokenizeShellSegment,
} from '../../src/core/utils/shellParser';

describe('splitOnShellOperators', () => {
  it('splits on && || ; |', () => {
    expect(splitOnShellOperators('a && b || c ; d | e').map(s => s.trim())).toEqual([
      'a', 'b', 'c', 'd', 'e',
    ]);
  });

  it('preserves the surrounding whitespace of each segment', () => {
    expect(splitOnShellOperators('cd dir && npm install')).toEqual(['cd dir ', ' npm install']);
    expect(splitOnShellOperators('grep foo | head')).toEqual(['grep foo ', ' head']);
    expect(splitOnShellOperators('echo a; echo b')).toEqual(['echo a', ' echo b']);
    expect(splitOnShellOperators('cmd1 || cmd2')).toEqual(['cmd1 ', ' cmd2']);
  });

  it('respects single quotes around operators', () => {
    expect(splitOnShellOperators(`echo 'a && b' ; ls`).map(s => s.trim())).toEqual([
      `echo 'a && b'`,
      'ls',
    ]);
    expect(splitOnShellOperators("grep -E 'foo|bar' file")).toEqual(["grep -E 'foo|bar' file"]);
  });

  it('respects double quotes around operators', () => {
    expect(splitOnShellOperators(`echo "a | b" ; ls`).map(s => s.trim())).toEqual([
      `echo "a | b"`,
      'ls',
    ]);
    expect(splitOnShellOperators('grep -E "foo|bar" file')).toEqual(['grep -E "foo|bar" file']);
  });

  it('does not split on an escaped pipe (grep BRE alternation)', () => {
    expect(splitOnShellOperators('grep foo\\|bar file')).toEqual(['grep foo\\|bar file']);
  });

  it('splits the real pipe when a quoted pipe coexists', () => {
    expect(splitOnShellOperators('grep -E "a|b" file | head')).toEqual(['grep -E "a|b" file ', ' head']);
  });

  it('handles multiple operators in one command', () => {
    expect(splitOnShellOperators('cd dir && grep test | head; echo done')).toEqual([
      'cd dir ', ' grep test ', ' head', ' echo done',
    ]);
  });
});

describe('hasActualPipe', () => {
  it('returns true for a real pipe', () => {
    expect(hasActualPipe('cmd1 | cmd2')).toBe(true);
    expect(hasActualPipe('grep foo | head')).toBe(true);
    expect(hasActualPipe('cat file | sort | uniq')).toBe(true);
  });

  it('returns false when there is no pipe', () => {
    expect(hasActualPipe('npm install')).toBe(false);
    expect(hasActualPipe('cd dir && npm install')).toBe(false);
  });

  it('returns false for a pipe only inside quotes', () => {
    expect(hasActualPipe('grep -E "foo|bar" file')).toBe(false);
    expect(hasActualPipe("grep -E 'a|b|c' src/")).toBe(false);
  });

  it('returns false for grep BRE \\| (escaped, quoted or bare)', () => {
    expect(hasActualPipe(`grep 'a\\|b' file`)).toBe(false);
    expect(hasActualPipe('grep foo\\|bar file')).toBe(false);
  });

  it('returns false for logical ||', () => {
    expect(hasActualPipe('a || b')).toBe(false);
    expect(hasActualPipe('cmd1 || cmd2')).toBe(false);
  });

  it('returns true when a real pipe coexists with a quoted pipe', () => {
    expect(hasActualPipe('grep -E "foo|bar" file | head')).toBe(true);
  });
});

describe('tokenizeShellSegment', () => {
  it('splits simple words on whitespace', () => {
    expect(tokenizeShellSegment('npm run build')).toEqual(['npm', 'run', 'build']);
  });

  it('keeps quoted strings as one token', () => {
    expect(tokenizeShellSegment(`echo "hello world"`)).toEqual(['echo', '"hello world"']);
    expect(tokenizeShellSegment("echo 'hello world'")).toEqual(['echo', "'hello world'"]);
  });

  it('keeps env assignments together, quoted or not', () => {
    expect(tokenizeShellSegment(`PORT=3456 npm run dev`)).toEqual([
      'PORT=3456', 'npm', 'run', 'dev',
    ]);
    expect(tokenizeShellSegment('FOO="bar baz" npm install')).toEqual([
      'FOO="bar baz"', 'npm', 'install',
    ]);
  });

  it('handles backslash escapes', () => {
    expect(tokenizeShellSegment('echo hello\\ world')).toEqual(['echo', 'hello\\ world']);
  });

  it('handles mixed quote styles in one segment', () => {
    expect(tokenizeShellSegment(`A="x y" B='1 2' cmd`)).toEqual(['A="x y"', "B='1 2'", 'cmd']);
  });

  it('returns [] for empty or whitespace-only input', () => {
    expect(tokenizeShellSegment('')).toEqual([]);
    expect(tokenizeShellSegment('   ')).toEqual([]);
  });

  it('collapses consecutive and surrounding whitespace', () => {
    expect(tokenizeShellSegment('  npm   install  ')).toEqual(['npm', 'install']);
  });

  it('keeps an unclosed quote attached rather than dropping the token', () => {
    expect(tokenizeShellSegment('echo "unclosed')).toEqual(['echo', '"unclosed']);
    expect(tokenizeShellSegment("echo 'unclosed")).toEqual(['echo', "'unclosed"]);
  });

  it('treats adjacent quoted and unquoted text as one token', () => {
    expect(tokenizeShellSegment('FOO="bar"baz')).toEqual(['FOO="bar"baz']);
  });
});

describe('maskQuotedRegions', () => {
  it('blanks interior of double-quoted strings but preserves length', () => {
    const input = `node -e "console.log('hi')"`;
    const out = maskQuotedRegions(input);
    expect(out.length).toBe(input.length);
    expect(out.slice(0, 8)).toBe('node -e ');
    // Both quote chars stay; interior is whitespace
    expect(out[8]).toBe('"');
    expect(out[out.length - 1]).toBe('"');
    expect(out.slice(9, -1)).toMatch(/^\s+$/);
  });

  it('preserves unquoted shell metacharacters', () => {
    expect(maskQuotedRegions(`npm run dev > .dev.log 2>&1`)).toBe(
      `npm run dev > .dev.log 2>&1`,
    );
  });

  it('masks `node -e` arrow-function so `=> {` cannot look like a `> {` redirect', () => {
    const cmd = `node -e "(async () => { const x = { foo: 1 } })()"`;
    const masked = maskQuotedRegions(cmd);
    // Inside the quotes, no `>` or `{` remains
    const inside = masked.slice(cmd.indexOf('"') + 1, cmd.lastIndexOf('"'));
    expect(inside).not.toMatch(/[>{}=]/);
  });

  it('handles single quotes', () => {
    const cmd = `echo 'hello > world' > out.txt`;
    const masked = maskQuotedRegions(cmd);
    // The `>` inside single quotes is masked; the trailing `> out.txt` is preserved
    expect(masked).toMatch(/^echo '.* ' > out\.txt$/);
  });

  it('handles `$( … )` command substitution', () => {
    const cmd = `echo $(date +%s) > log.txt`;
    const masked = maskQuotedRegions(cmd);
    expect(masked).toBe(`echo $(        ) > log.txt`);
  });

  it('handles backticks', () => {
    const cmd = `echo \`hostname\` > out`;
    const masked = maskQuotedRegions(cmd);
    expect(masked).toBe(`echo \`        \` > out`);
  });

  it('survives unterminated quotes', () => {
    expect(() => maskQuotedRegions(`echo "unterminated`)).not.toThrow();
  });
});

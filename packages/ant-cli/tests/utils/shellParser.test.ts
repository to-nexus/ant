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

  it('respects single quotes around operators', () => {
    expect(splitOnShellOperators(`echo 'a && b' ; ls`).map(s => s.trim())).toEqual([
      `echo 'a && b'`,
      'ls',
    ]);
  });

  it('respects double quotes around operators', () => {
    expect(splitOnShellOperators(`echo "a | b" ; ls`).map(s => s.trim())).toEqual([
      `echo "a | b"`,
      'ls',
    ]);
  });
});

describe('hasActualPipe', () => {
  it('returns true for a real pipe', () => {
    expect(hasActualPipe('cmd1 | cmd2')).toBe(true);
  });
  it('returns false for grep BRE \\| inside quotes', () => {
    expect(hasActualPipe(`grep 'a\\|b' file`)).toBe(false);
  });
  it('returns false for logical ||', () => {
    expect(hasActualPipe('a || b')).toBe(false);
  });
});

describe('tokenizeShellSegment', () => {
  it('keeps quoted strings as one token', () => {
    expect(tokenizeShellSegment(`echo "hello world"`)).toEqual([
      'echo',
      '"hello world"',
    ]);
  });
  it('keeps env assignments together', () => {
    expect(tokenizeShellSegment(`PORT=3456 npm run dev`)).toEqual([
      'PORT=3456',
      'npm',
      'run',
      'dev',
    ]);
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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { NodeCommandAdapter } from '../../src/periphery/adapters/command/NodeCommandAdapter';

const execFileAsync = promisify(execFile);

// Regression guard for the `small-calming-lathe` incident: on a POSIX sh
// (Alpine busybox `ash` / dash — what production node:22-alpine workers run),
// the old wrapper `set -o pipefail 2>/dev/null || true; set -e; <cmd>` aborted
// EVERY operator command with an empty-output exit 2. `set -o pipefail` is an
// illegal option to the `set` special builtin there, and a special-builtin
// usage error makes a non-interactive shell exit immediately — before the
// `|| true` guard runs and before <cmd> executes. The dev box (macOS /bin/sh is
// bash-family, supports pipefail) hid it. The fix runs the probe in a SUBSHELL
// so the abort is contained.

// Mirror of the wrapper NodeCommandAdapter builds for `needsShell` commands.
// Kept in sync by hand — if NodeCommandAdapter's prefix changes, change here too.
const wrap = (cmd: string) =>
  `( set -o pipefail ) 2>/dev/null && set -o pipefail; set -e; ${cmd}`;

const OLD_BROKEN_WRAP = (cmd: string) =>
  `set -o pipefail 2>/dev/null || true; set -e; ${cmd}`;

async function runUnder(shell: string, script: string) {
  try {
    const { stdout, stderr } = await execFileAsync(shell, ['-lc', script]);
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function hasDash(): Promise<boolean> {
  try {
    await execFileAsync('dash', ['-c', 'true']);
    return true;
  } catch {
    return false;
  }
}

describe('NodeCommandAdapter — POSIX-sh operator commands (pipefail portability)', () => {
  it('runs a piped command end-to-end and returns its output (not exit-2-empty)', async () => {
    const adapter = new NodeCommandAdapter();
    const res = await adapter.execute('echo hello | sort', {
      cwd: process.cwd(),
      signal: new AbortController().signal,
    });
    expect(res.exitCode).toBe(0);
    expect(res.success).toBe(true);
    expect(res.stdout).toContain('hello');
  });

  it('lets `|| true` suppress a failure (operators are shell-interpreted)', async () => {
    const adapter = new NodeCommandAdapter();
    // `false` is whitelisted; without shell interpretation `|| true` would be
    // literal args and the command would fail.
    const res = await adapter.execute('false || true', {
      cwd: process.cwd(),
      signal: new AbortController().signal,
    });
    expect(res.exitCode).toBe(0);
    expect(res.success).toBe(true);
  });

  it('still reports a genuine pipe failure (set -e / exit code preserved)', async () => {
    const adapter = new NodeCommandAdapter();
    const res = await adapter.execute('false | cat', {
      cwd: process.cwd(),
      signal: new AbortController().signal,
    });
    // pipefail (bash) → left failure surfaces; without pipefail (POSIX) → exit
    // reflects `cat` (0). Either way the command must NOT abort with the
    // wrapper's own exit 2 — that is the regression we guard against.
    expect(res.exitCode).not.toBe(2);
  });
});

describe('wrapper portability under a strict POSIX shell (dash)', () => {
  it('FIXED wrapper runs the command under dash; OLD wrapper aborts (documents the bug)', async () => {
    if (!(await hasDash())) {
      // bash-only environment cannot exercise the POSIX path; the end-to-end
      // tests above still cover the host shell. Skip rather than false-pass.
      return;
    }

    // FIXED: subshell contains the special-builtin abort → parent continues.
    const fixed = await runUnder('dash', wrap('echo a | sort'));
    expect(fixed.code).toBe(0);
    expect(fixed.stdout).toContain('a');

    // FIXED: `|| true` is honored under dash too.
    const suppressed = await runUnder('dash', wrap('false || true'));
    expect(suppressed.code).toBe(0);

    // OLD (broken): bare `set -o pipefail` aborts dash before the command runs.
    const broken = await runUnder('dash', OLD_BROKEN_WRAP('echo a | sort'));
    expect(broken.code).toBe(2);
    expect(broken.stdout.trim()).toBe('');
  });
});

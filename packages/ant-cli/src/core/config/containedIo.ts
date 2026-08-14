/**
 * Containment-bound file I/O.
 *
 * `pathContainment` answers "may this path be touched". That verdict is about a
 * *name*, and a name can be repointed the instant after it is checked. Every
 * consumer that validated a path and then re-opened it by name carried the same
 * TOCTOU: an attacker-controlled symlink inside the root, flipped between the
 * check and the read, redirected the read outside the root (H-010, H-011).
 *
 * This module binds the check and the read to the same *file object*: resolve to
 * a canonical path, containment-check that, open it with `O_NOFOLLOW`, and serve
 * every subsequent question (size, kind, bytes) from the descriptor.
 *
 * ## What this closes
 * - **Final-component swap.** `realpath()` returns a path whose last component
 *   is by construction not a symlink; if it becomes one before `open()`,
 *   `O_NOFOLLOW` fails with `ELOOP`. This is the exact H-010/H-011 shape.
 * - **Check-then-reopen divergence.** Size, kind and bytes all come from one
 *   descriptor, so the bytes read are the bytes that were validated.
 *
 * ## What this does NOT close
 * - **Intermediate-directory swap.** Components `1..n-1` can still be replaced
 *   between `realpath()` and `open()`. Closing it needs a per-component
 *   `openat(2)` descent, which Node does not expose; the real remedies are a
 *   read-only bind mount or a mount namespace. The window narrows from
 *   "any moment between check and read" to "between two adjacent syscalls".
 * - **Hardlinks.** A hardlink into the root is genuinely inside it under every
 *   path-based test. `st_nlink` heuristics false-positive on git object stores
 *   and pnpm's content-addressed store (which this repo uses).
 * - **Windows.** `O_NOFOLLOW` does not exist there, so the swap is *detected*
 *   via `lstat` rather than prevented. The threat model is the multi-tenant
 *   Linux pod; Windows is the single-developer local CLI. CI is `ubuntu-latest`,
 *   so the enforcing branch is the one under test.
 */

import * as fs from 'fs';

import { assertCanonicalWithinRoot } from './pathContainment';

export type ContainedFailure =
  /** canonical target outside the root, or the root itself unresolvable */
  | 'escaped'
  /** realpath failed: absent, dangling link, or EACCES on a component */
  | 'missing'
  /** the canonical leaf was a symlink at open time, or the fd identity differs */
  | 'swapped'
  /** not a regular file (directory, fifo, socket, device) */
  | 'not-a-file'
  /** larger than `maxBytes` — nothing was read */
  | 'too-large'
  | 'io-error';

export interface ContainedFail {
  ok: false;
  reason: ContainedFailure;
}

export interface ContainedOk<T> {
  ok: true;
  value: T;
  canonicalPath: string;
  stat: fs.Stats;
}

export interface ContainedIoOptions {
  /** Reject before reading when the opened file exceeds this many bytes. */
  maxBytes?: number;
}

/**
 * Resolved once: `undefined` on Windows, where a following `open` is the only
 * option. A `typeof` guard rather than `??` because `@types/node` types this as
 * a non-optional `number`.
 */
const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;

function canonicalize(root: string, target: string): { path: string } | ContainedFail {
  try {
    return { path: assertCanonicalWithinRoot(root, target) };
  } catch (err: any) {
    // A containment verdict is `escaped`; anything else is the path not being
    // resolvable at all. Both fail closed — the distinction only drives logs.
    const message = typeof err?.message === 'string' ? err.message : '';
    return { ok: false, reason: message.startsWith('[pathContainment]') ? 'escaped' : 'missing' };
  }
}

/**
 * Open an ALREADY-canonical path, refusing it if the leaf is a symlink.
 *
 * This is the step that closes the check-then-read window: `realpath` returns a
 * path whose last component is not a link, so if one is there at open time the
 * name was repointed after the check. Separate from {@link withContainedFd} so
 * the refusal is observable without racing the filesystem.
 */
export function openCanonical(canonicalPath: string): { fd: number } | ContainedFail {
  try {
    return { fd: fs.openSync(canonicalPath, fs.constants.O_RDONLY | O_NOFOLLOW) };
  } catch (err: any) {
    if (err?.code === 'ELOOP') return { ok: false, reason: 'swapped' };
    if (err?.code === 'ENOENT') return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'io-error' };
  }
}

/**
 * Decision-grade stat. Does NOT bind a descriptor — directories are not
 * portably openable, and callers need `isDirectory()` to pick a branch. Every
 * branch that goes on to read must re-enter through {@link withContainedFd},
 * which re-resolves and binds.
 */
export function statContained(
  root: string,
  target: string,
): { ok: true; canonicalPath: string; stat: fs.Stats } | ContainedFail {
  const canonical = canonicalize(root, target);
  if ('ok' in canonical) return canonical;
  try {
    return { ok: true, canonicalPath: canonical.path, stat: fs.statSync(canonical.path) };
  } catch {
    return { ok: false, reason: 'missing' };
  }
}

/**
 * Read-grade. Resolves, containment-checks the canonical path, opens it with
 * `O_RDONLY | O_NOFOLLOW`, `fstat`s the descriptor and runs `fn` against that
 * one file object. The descriptor is closed on every exit path, including a
 * throw from `fn`.
 */
export function withContainedFd<T>(
  root: string,
  target: string,
  fn: (fd: number, stat: fs.Stats, canonicalPath: string) => T,
  opts: ContainedIoOptions = {},
): ContainedOk<T> | ContainedFail {
  const canonical = canonicalize(root, target);
  if ('ok' in canonical) return canonical;

  const opened = openCanonical(canonical.path);
  if ('ok' in opened && opened.ok === false) return opened;
  const fd = (opened as { fd: number }).fd;

  try {
    const stat = fs.fstatSync(fd);

    if (O_NOFOLLOW === 0) {
      // Windows fallback: detect the swap the open could not refuse.
      const link = fs.lstatSync(canonical.path);
      const identityKnown = Number(link.ino) !== 0 && Number(stat.ino) !== 0;
      if (link.isSymbolicLink() || (identityKnown && (link.ino !== stat.ino || link.dev !== stat.dev))) {
        return { ok: false, reason: 'swapped' };
      }
    }

    if (!stat.isFile()) return { ok: false, reason: 'not-a-file' };
    if (opts.maxBytes !== undefined && Number(stat.size) > opts.maxBytes) {
      return { ok: false, reason: 'too-large' };
    }

    return { ok: true, value: fn(fd, stat, canonical.path), canonicalPath: canonical.path, stat };
  } catch {
    return { ok: false, reason: 'io-error' };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
  }
}

/**
 * Read the whole descriptor with explicit positions — never `readFileSync(fd)`,
 * which reads from the current cursor and would couple the result to whether
 * anything else (a binary sniff) moved it.
 */
function readAllFromFd(fd: number, size: number): Buffer {
  const buffer = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const read = fs.readSync(fd, buffer, offset, size - offset, offset);
    if (read <= 0) break;
    offset += read;
  }
  return offset === size ? buffer : buffer.subarray(0, offset);
}

/** UTF-8 read bound to the resolved target. */
export function readTextContained(
  root: string,
  target: string,
  opts: ContainedIoOptions = {},
): { ok: true; text: string; canonicalPath: string; size: number } | ContainedFail {
  const result = withContainedFd(
    root,
    target,
    (fd, stat) => readAllFromFd(fd, Number(stat.size)).toString('utf8'),
    opts,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    text: result.value,
    canonicalPath: result.canonicalPath,
    size: Number(result.stat.size),
  };
}

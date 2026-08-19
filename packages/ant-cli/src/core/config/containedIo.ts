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
 * a canonical path, containment-check that, then walk that canonical path one
 * component at a time — each hop opened `O_NOFOLLOW` relative to the descriptor
 * of the hop before it — and serve every subsequent question (size, kind,
 * bytes) from the leaf descriptor.
 *
 * ## The descent
 * Node exposes no `openat(2)`, but Linux does the same job through the
 * `/proc/self/fd/<fd>/<name>` magic link: resolving that name is resolution
 * *relative to the descriptor*, so a component swapped after the check no
 * longer participates. A canonical path has no symlink components by
 * construction, so any component that is a symlink at descent time was
 * repointed after `realpath()` — `O_NOFOLLOW` refuses it with `ELOOP`.
 * Canonicalising first is what keeps *legitimate* symlinks inside the root
 * working (pnpm's store links, handoff bundles): they are resolved by the check,
 * and the descent walks the resolved form.
 *
 * ## What this closes
 * - **Final-component swap.** The leaf is opened `O_NOFOLLOW`; a link dropped
 *   on it after the check fails with `ELOOP`. The H-010/H-011 shape.
 * - **Intermediate-directory swap.** Components `1..n-1` are descended by
 *   descriptor, so replacing one with a directory symlink after the check
 *   cannot redirect the operation (H-003, H-011, M-NEW-003, M-NEW-005).
 * - **Check-then-reopen divergence.** Size, kind and bytes all come from one
 *   descriptor, so the bytes read are the bytes that were validated.
 *
 * ## What this does NOT close
 * - **Hardlinks.** A hardlink into the root is genuinely inside it under every
 *   path-based test. `st_nlink` heuristics false-positive on git object stores
 *   and pnpm's content-addressed store (which this repo uses).
 * - **Non-Linux hosts.** `/proc/self/fd` and `O_NOFOLLOW` are Linux; elsewhere
 *   the descent degrades to the canonical-path open it replaced (final-component
 *   protection only, `lstat` detection on Windows). The threat model is the
 *   multi-tenant Linux pod; macOS/Windows is the single-developer local CLI. CI
 *   is `ubuntu-latest`, so the enforcing branch is the one under test.
 */

import * as fs from 'fs';
import * as path from 'path';

import { assertCanonicalWithinRoot, isPathWithin } from './pathContainment';

export type ContainedFailure =
  /** canonical target outside the root, or the root itself unresolvable */
  | 'escaped'
  /** realpath failed: absent, dangling link, or EACCES on a component */
  | 'missing'
  /** a component was a symlink at descent time, or the fd identity differs */
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
const O_DIRECTORY = typeof fs.constants.O_DIRECTORY === 'number' ? fs.constants.O_DIRECTORY : 0;

const PROC_FD = '/proc/self/fd';

/**
 * Whether the per-component descent can run. Everything it needs is Linux-only,
 * and every piece must be present — a partial descent would be a false sense of
 * containment. Evaluated once: none of these change during a process lifetime.
 */
export const DESCENT_AVAILABLE: boolean =
  process.platform === 'linux' &&
  O_NOFOLLOW !== 0 &&
  O_DIRECTORY !== 0 &&
  (() => {
    try {
      return fs.statSync(PROC_FD).isDirectory();
    } catch {
      return false;
    }
  })();

function closeQuiet(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    /* already closed */
  }
}

/** Resolution relative to an open directory descriptor. See the module comment. */
function at(dirFd: number, name: string): string {
  return `${PROC_FD}/${dirFd}/${name}`;
}

function failFor(code: unknown): ContainedFailure {
  if (code === 'ELOOP') return 'swapped';
  if (code === 'ENOENT') return 'missing';
  if (code === 'ENOTDIR') return 'not-a-file';
  return 'io-error';
}

/**
 * Failure mapping for a component the canonical path said was a directory.
 *
 * `O_DIRECTORY | O_NOFOLLOW` on a symlink reports `ENOTDIR`, not `ELOOP` — the
 * kernel rejects it as "not a directory" before the link check. `ENOTDIR` also
 * covers the component having become a regular file. Either way the component is
 * no longer what canonicalisation validated, which is exactly `swapped`;
 * reporting it as `not-a-file` would have made the H-011 shape look like an
 * ordinary type mismatch.
 */
function failForDirHop(code: unknown): ContainedFailure {
  if (code === 'ELOOP' || code === 'ENOTDIR') return 'swapped';
  if (code === 'ENOENT') return 'missing';
  return 'io-error';
}

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

/** The root's own canonical form — the descent's anchor. */
function canonicalRoot(root: string): { path: string } | ContainedFail {
  try {
    return { path: fs.realpathSync(path.resolve(root)) };
  } catch {
    return { ok: false, reason: 'missing' };
  }
}

/**
 * Split an already-canonical `target` into the components separating it from an
 * already-canonical `root`. Refuses anything that is not strictly below the root
 * — `.`/`..` cannot survive canonicalisation, so their presence means the caller
 * handed us a non-canonical path.
 */
function componentsUnder(canonRoot: string, canonTarget: string): string[] | ContainedFail {
  if (!isPathWithin(canonRoot, canonTarget)) return { ok: false, reason: 'escaped' };
  const rel = path.relative(canonRoot, canonTarget);
  if (rel === '') return [];
  const parts = rel.split(path.sep);
  if (parts.some(p => p === '' || p === '.' || p === '..')) return { ok: false, reason: 'escaped' };
  return parts;
}

/**
 * Open the directory `components` designates, descending from `canonDir` one hop
 * at a time with `O_NOFOLLOW`. With `create`, a missing hop is `mkdir`'d through
 * the parent descriptor rather than by name.
 *
 * The caller owns the returned descriptor.
 */
function openDirDescended(
  canonDir: string,
  components: readonly string[],
  create: boolean,
): { fd: number } | ContainedFail {
  let fd: number;
  try {
    fd = fs.openSync(canonDir, fs.constants.O_RDONLY | O_DIRECTORY);
  } catch (err: any) {
    return { ok: false, reason: failForDirHop(err?.code) };
  }

  for (const name of components) {
    let next: number;
    try {
      next = fs.openSync(at(fd, name), fs.constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    } catch (err: any) {
      if (!create || err?.code !== 'ENOENT') {
        closeQuiet(fd);
        return { ok: false, reason: failForDirHop(err?.code) };
      }
      try {
        // EEXIST here means someone won the race with a link or a file; the
        // reopen below then fails ELOOP / ENOTDIR rather than following it.
        try {
          fs.mkdirSync(at(fd, name));
        } catch (mkErr: any) {
          if (mkErr?.code !== 'EEXIST') throw mkErr;
        }
        next = fs.openSync(at(fd, name), fs.constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      } catch (mkErr: any) {
        closeQuiet(fd);
        return { ok: false, reason: failForDirHop(mkErr?.code) };
      }
    }
    closeQuiet(fd);
    fd = next;
  }

  return { fd };
}

/**
 * Open an ALREADY-canonical path, refusing it if any component is a symlink.
 *
 * This is the step that closes the check-then-read window. Where the descent is
 * available every component is walked by descriptor; where it is not, only the
 * leaf is protected — `realpath` returns a path whose last component is not a
 * link, so one being there at open time means the name was repointed after the
 * check. Separate from {@link withContainedFd} so the refusal is observable
 * without racing the filesystem.
 */
export function openCanonical(canonicalPath: string, root?: string): { fd: number } | ContainedFail {
  if (DESCENT_AVAILABLE && root !== undefined) {
    const anchor = canonicalRoot(root);
    if ('ok' in anchor) return anchor;
    const parts = componentsUnder(anchor.path, canonicalPath);
    if ('ok' in parts) return parts;
    if (parts.length === 0) return { ok: false, reason: 'not-a-file' };

    const leaf = parts[parts.length - 1];
    const dir = openDirDescended(anchor.path, parts.slice(0, -1), false);
    if ('ok' in dir) return dir;
    try {
      return { fd: fs.openSync(at(dir.fd, leaf), fs.constants.O_RDONLY | O_NOFOLLOW) };
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    } finally {
      closeQuiet(dir.fd);
    }
  }

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
 * Read-grade. Resolves, containment-checks the canonical path, descends to it
 * component by component with `O_RDONLY | O_NOFOLLOW`, `fstat`s the leaf
 * descriptor and runs `fn` against that one file object. The descriptor is
 * closed on every exit path, including a throw from `fn`.
 */
export function withContainedFd<T>(
  root: string,
  target: string,
  fn: (fd: number, stat: fs.Stats, canonicalPath: string) => T,
  opts: ContainedIoOptions = {},
): ContainedOk<T> | ContainedFail {
  const canonical = canonicalize(root, target);
  if ('ok' in canonical) return canonical;

  const opened = openCanonical(canonical.path, root);
  if ('ok' in opened && opened.ok === false) return opened;
  const fd = (opened as { fd: number }).fd;

  try {
    const stat = fs.fstatSync(fd);

    if (!DESCENT_AVAILABLE && O_NOFOLLOW === 0) {
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
    closeQuiet(fd);
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

/** Bytes read bound to the resolved target — the binary twin of {@link readTextContained}. */
export function readBufferContained(
  root: string,
  target: string,
  opts: ContainedIoOptions = {},
): { ok: true; bytes: Buffer; canonicalPath: string; size: number } | ContainedFail {
  const result = withContainedFd(root, target, (fd, stat) => readAllFromFd(fd, Number(stat.size)), opts);
  if (!result.ok) return result;
  return {
    ok: true,
    bytes: result.value,
    canonicalPath: result.canonicalPath,
    size: Number(result.stat.size),
  };
}

// ============================================================================
// Write side
// ============================================================================

/**
 * Anchor a write target that may not exist yet.
 *
 * A read flow always has a real file and can be canonicalised whole. A write
 * flow legitimately targets a leaf — and sometimes whole directories — that do
 * not exist, so the deepest EXISTING prefix is canonicalised (that is what a
 * planted symlink would ride on) and the missing tail is carried as plain names
 * for the descent to create by descriptor.
 */
function anchorForWrite(
  root: string,
  relPath: string,
): { canonPrefix: string; tail: string[] } | ContainedFail {
  const anchor = canonicalRoot(root);
  if ('ok' in anchor) return anchor;
  const absRoot = anchor.path;

  const target = path.resolve(absRoot, relPath);
  if (!isPathWithin(absRoot, target)) return { ok: false, reason: 'escaped' };
  const rel = path.relative(absRoot, target);
  if (rel === '') return { ok: false, reason: 'not-a-file' };

  const parts = rel.split(path.sep);
  if (parts.some(p => p === '' || p === '.' || p === '..')) return { ok: false, reason: 'escaped' };

  // Deepest existing prefix. `existsSync` follows links, so a dangling link
  // counts as absent — the descent then refuses to create through it.
  for (let i = parts.length - 1; i >= 0; i--) {
    const probe = path.join(absRoot, ...parts.slice(0, i));
    if (!fs.existsSync(probe)) continue;
    let canonPrefix: string;
    try {
      canonPrefix = fs.realpathSync(probe);
    } catch {
      return { ok: false, reason: 'missing' };
    }
    if (!isPathWithin(absRoot, canonPrefix)) return { ok: false, reason: 'escaped' };
    return { canonPrefix, tail: parts.slice(i) };
  }
  return { ok: false, reason: 'missing' };
}

/**
 * `mkdir -p` bound to the root by descriptor descent. Each missing component is
 * created through its parent's descriptor, so a component swapped for a symlink
 * mid-walk is refused rather than followed (M-NEW-003, H-003).
 */
export function mkdirpContained(root: string, relPath: string): { ok: true } | ContainedFail {
  const anchored = anchorForWrite(root, relPath);
  if ('ok' in anchored) return anchored;

  if (!DESCENT_AVAILABLE) {
    try {
      fs.mkdirSync(path.join(anchored.canonPrefix, ...anchored.tail), { recursive: true });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    }
  }

  const dir = openDirDescended(anchored.canonPrefix, anchored.tail, true);
  if ('ok' in dir) return dir;
  closeQuiet(dir.fd);
  return { ok: true };
}

/**
 * Open a write target bound to the root, creating parent directories on the way
 * down. Returns the leaf descriptor plus the canonical directory that holds it,
 * so a caller that must name the file (diagnostics, cleanup) has a path that
 * was never re-resolved.
 */
export function openForWriteContained(
  root: string,
  relPath: string,
  flags: number,
  mode = 0o644,
): { ok: true; fd: number; canonicalDir: string; leaf: string } | ContainedFail {
  const anchored = anchorForWrite(root, relPath);
  if ('ok' in anchored) return anchored;

  const tail = anchored.tail;
  const leaf = tail[tail.length - 1];
  const dirs = tail.slice(0, -1);

  if (!DESCENT_AVAILABLE) {
    const dirPath = path.join(anchored.canonPrefix, ...dirs);
    try {
      if (dirs.length > 0) fs.mkdirSync(dirPath, { recursive: true });
      return {
        ok: true,
        fd: fs.openSync(path.join(dirPath, leaf), flags | O_NOFOLLOW, mode),
        canonicalDir: dirPath,
        leaf,
      };
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    }
  }

  const dir = openDirDescended(anchored.canonPrefix, dirs, true);
  if ('ok' in dir) return dir;
  try {
    const fd = fs.openSync(at(dir.fd, leaf), flags | O_NOFOLLOW, mode);
    return { ok: true, fd, canonicalDir: path.join(anchored.canonPrefix, ...dirs), leaf };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(dir.fd);
  }
}

/**
 * Whole-file write bound to the root. Truncating create; parents are made on the
 * way down. Returns the number of bytes written so a caller can verify the count
 * against what it supplied without re-resolving the name.
 */
export function writeBufferContained(
  root: string,
  relPath: string,
  content: Buffer,
): { ok: true; written: number; canonicalDir: string; leaf: string } | ContainedFail {
  const opened = openForWriteContained(
    root,
    relPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC,
  );
  if ('ok' in opened && opened.ok === false) return opened;
  const { fd, canonicalDir, leaf } = opened as { fd: number; canonicalDir: string; leaf: string };

  try {
    let offset = 0;
    while (offset < content.length) {
      offset += fs.writeSync(fd, content, offset, content.length - offset, offset);
    }
    const written = Number(fs.fstatSync(fd).size);
    return { ok: true, written, canonicalDir, leaf };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(fd);
  }
}

/** UTF-8 twin of {@link writeBufferContained}. */
export function writeTextContained(
  root: string,
  relPath: string,
  text: string,
): { ok: true; written: number; canonicalDir: string; leaf: string } | ContainedFail {
  return writeBufferContained(root, relPath, Buffer.from(text, 'utf8'));
}

/** Remove a leaf bound to the root — used to undo a write that failed verification. */
export function unlinkContained(root: string, relPath: string): void {
  const anchored = anchorForWrite(root, relPath);
  if ('ok' in anchored) return;
  const tail = anchored.tail;
  const leaf = tail[tail.length - 1];

  if (!DESCENT_AVAILABLE) {
    try {
      fs.rmSync(path.join(anchored.canonPrefix, ...tail), { force: true });
    } catch {
      /* best effort */
    }
    return;
  }

  const dir = openDirDescended(anchored.canonPrefix, tail.slice(0, -1), false);
  if ('ok' in dir) return;
  try {
    fs.unlinkSync(at(dir.fd, leaf));
  } catch {
    /* best effort */
  } finally {
    closeQuiet(dir.fd);
  }
}

export const __testing = { DESCENT_AVAILABLE, anchorForWrite, componentsUnder };

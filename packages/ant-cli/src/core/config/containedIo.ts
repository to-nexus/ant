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
import { sniffFd } from '../utils/binaryExtensions';

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

// ============================================================================
// Base-relative descent (root-reparent containment)
// ============================================================================
//
// The functions above anchor the descent at `realpath(root)` — but `root` is a
// caller-supplied *name* (a feature path), and `openDirDescended` opens that
// anchor by name. A preview child that reparents the feature root (or an
// ancestor of it that the shared `ant` group can rename) between the realpath
// and the open is followed: the descent protects components *below* the root,
// never the root itself (H-011, H-003, M-NEW-005, M-NEW-018, M-NEW-019).
//
// The base-relative variants close that by anchoring at a service-owned
// **physical workspace base** — the volume mount root, above every tenant
// directory, which a feature-scoped child cannot rename — and descending the
// ENTIRE relative path (org/user/project/features/<slug>/…) from it with
// `O_NOFOLLOW` at every hop. The feature name is now a descended component, not
// the anchor, so swapping it for a symlink is refused with ELOOP rather than
// followed. `base` is realpath'd once; nothing below it is ever re-resolved by
// name. On a non-Linux host (single-developer local CLI) the descent degrades
// to a name-based join from `realpath(base)`, matching the read/write helpers.

/** A write/read target expressed as a service-owned base plus a relative path. */
export interface BaseRelative {
  /** Absolute, service-owned physical base (e.g. ANT_WORKSPACE_BASE_PATH). */
  base: string;
  /** Path under `base`; EVERY component is descended O_NOFOLLOW. */
  relative: string;
}

/**
 * Convert an absolute target into a {@link BaseRelative} anchored at the
 * service-owned physical workspace base. The single conversion owner every sink
 * uses to opt into root-reparent-safe descent: it turns the feature path (which
 * is `base + '/' + <org>/<user>/<project>/features/<slug>`) into the pinned base
 * plus the full relative path, so the feature name descends as a component.
 *
 * Returns `undefined` when the target is NOT under the base — a `repoType:'local'`
 * codebase, or any user-owned path outside the multi-tenant volume — so the
 * caller keeps its legacy (single-trust) path for those.
 */
export function toBaseRelative(base: string, absTarget: string): BaseRelative | undefined {
  const absBase = path.resolve(base);
  const abs = path.resolve(absTarget);
  if (abs !== absBase && !isPathWithin(absBase, abs)) return undefined;
  const relative = path.relative(absBase, abs);
  if (relative === '' || relative.startsWith('..')) return undefined;
  return { base: absBase, relative };
}

/** realpath the trusted base once — the descent's unreparentable anchor. */
function baseAnchor(base: string): { path: string } | ContainedFail {
  try {
    return { path: fs.realpathSync(path.resolve(base)) };
  } catch {
    return { ok: false, reason: 'missing' };
  }
}

/** Lexically clean the relative path into descent components. Rejects `..`/absolute. */
function relativeComponents(relative: string): string[] | ContainedFail {
  if (path.isAbsolute(relative)) return { ok: false, reason: 'escaped' };
  const parts = relative.split(/[\\/]+/).filter((p) => p !== '' && p !== '.');
  if (parts.length === 0) return { ok: false, reason: 'not-a-file' };
  if (parts.some((p) => p === '..')) return { ok: false, reason: 'escaped' };
  return parts;
}

/** Open the leaf of `base/relative` for reading, descending every component. */
function openLeafBase(anchor: string, components: readonly string[]): { fd: number } | ContainedFail {
  const leaf = components[components.length - 1];
  if (!DESCENT_AVAILABLE) {
    try {
      return { fd: fs.openSync(path.join(anchor, ...components), fs.constants.O_RDONLY | O_NOFOLLOW) };
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    }
  }
  const dir = openDirDescended(anchor, components.slice(0, -1), false);
  if ('ok' in dir) return dir;
  try {
    return { fd: fs.openSync(at(dir.fd, leaf), fs.constants.O_RDONLY | O_NOFOLLOW) };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(dir.fd);
  }
}

/** Read-grade base-relative access. Binds one descriptor; runs `fn` against it. */
export function withContainedFdBase<T>(
  target: BaseRelative,
  fn: (fd: number, stat: fs.Stats) => T,
  opts: ContainedIoOptions = {},
): ContainedOk<T> | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;

  const opened = openLeafBase(anchor.path, components);
  if ('ok' in opened && opened.ok === false) return opened;
  const fd = (opened as { fd: number }).fd;
  const canonicalPath = path.join(anchor.path, ...components);

  try {
    const stat = fs.fstatSync(fd);
    if (!DESCENT_AVAILABLE && O_NOFOLLOW === 0) {
      const link = fs.lstatSync(canonicalPath);
      const identityKnown = Number(link.ino) !== 0 && Number(stat.ino) !== 0;
      if (link.isSymbolicLink() || (identityKnown && (link.ino !== stat.ino || link.dev !== stat.dev))) {
        return { ok: false, reason: 'swapped' };
      }
    }
    if (!stat.isFile()) return { ok: false, reason: 'not-a-file' };
    if (opts.maxBytes !== undefined && Number(stat.size) > opts.maxBytes) {
      return { ok: false, reason: 'too-large' };
    }
    return { ok: true, value: fn(fd, stat), canonicalPath, stat };
  } catch {
    return { ok: false, reason: 'io-error' };
  } finally {
    closeQuiet(fd);
  }
}

/** UTF-8 base-relative read. */
export function readTextContainedBase(
  target: BaseRelative,
  opts: ContainedIoOptions = {},
): { ok: true; text: string; canonicalPath: string; size: number } | ContainedFail {
  const result = withContainedFdBase(target, (fd, stat) => readAllFromFd(fd, Number(stat.size)).toString('utf8'), opts);
  if (!result.ok) return result;
  return { ok: true, text: result.value, canonicalPath: result.canonicalPath, size: Number(result.stat.size) };
}

/** Binary base-relative read. */
export function readBufferContainedBase(
  target: BaseRelative,
  opts: ContainedIoOptions = {},
): { ok: true; bytes: Buffer; canonicalPath: string; size: number } | ContainedFail {
  const result = withContainedFdBase(target, (fd, stat) => readAllFromFd(fd, Number(stat.size)), opts);
  if (!result.ok) return result;
  return { ok: true, bytes: result.value, canonicalPath: result.canonicalPath, size: Number(result.stat.size) };
}

/** Decision-grade base-relative stat via descent (leaf may be a directory). */
export function statContainedBase(
  target: BaseRelative,
): { ok: true; canonicalPath: string; stat: fs.Stats } | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;
  const canonicalPath = path.join(anchor.path, ...components);

  if (!DESCENT_AVAILABLE) {
    try {
      return { ok: true, canonicalPath, stat: fs.lstatSync(canonicalPath) };
    } catch {
      return { ok: false, reason: 'missing' };
    }
  }
  const dir = openDirDescended(anchor.path, components.slice(0, -1), false);
  if ('ok' in dir) return dir;
  try {
    const stat = fs.fstatSync(fs.openSync(at(dir.fd, components[components.length - 1]), fs.constants.O_RDONLY | O_NOFOLLOW));
    return { ok: true, canonicalPath, stat };
  } catch (err: any) {
    // A directory leaf opens fine with O_RDONLY on Linux; a swapped symlink is ELOOP.
    if (err?.code === 'ELOOP') return { ok: false, reason: 'swapped' };
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(dir.fd);
  }
}

/** `mkdir -p` for `base/relative`, every component descended O_NOFOLLOW. */
export function mkdirpContainedBase(target: BaseRelative): { ok: true } | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;

  if (!DESCENT_AVAILABLE) {
    try {
      fs.mkdirSync(path.join(anchor.path, ...components), { recursive: true });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    }
  }
  const dir = openDirDescended(anchor.path, components, true);
  if ('ok' in dir) return dir;
  closeQuiet(dir.fd);
  return { ok: true };
}

/** Whole-file base-relative write; parents created on the way down. */
export function writeBufferContainedBase(
  target: BaseRelative,
  content: Buffer,
): { ok: true; written: number; canonicalPath: string } | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;

  const leaf = components[components.length - 1];
  const dirs = components.slice(0, -1);
  const canonicalPath = path.join(anchor.path, ...components);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC;

  let fd: number;
  if (!DESCENT_AVAILABLE) {
    try {
      if (dirs.length > 0) fs.mkdirSync(path.join(anchor.path, ...dirs), { recursive: true });
      fd = fs.openSync(canonicalPath, flags | O_NOFOLLOW, 0o644);
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    }
  } else {
    const dir = openDirDescended(anchor.path, dirs, true);
    if ('ok' in dir) return dir;
    try {
      fd = fs.openSync(at(dir.fd, leaf), flags | O_NOFOLLOW, 0o644);
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    } finally {
      closeQuiet(dir.fd);
    }
  }

  try {
    let offset = 0;
    while (offset < content.length) {
      offset += fs.writeSync(fd, content, offset, content.length - offset, offset);
    }
    return { ok: true, written: Number(fs.fstatSync(fd).size), canonicalPath };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(fd);
  }
}

/** UTF-8 twin of {@link writeBufferContainedBase}. */
export function writeTextContainedBase(
  target: BaseRelative,
  text: string,
): { ok: true; written: number; canonicalPath: string } | ContainedFail {
  return writeBufferContainedBase(target, Buffer.from(text, 'utf8'));
}

/** Remove the leaf of `base/relative`, its parent descended O_NOFOLLOW. */
export function unlinkContainedBase(target: BaseRelative): { ok: true } | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;
  const leaf = components[components.length - 1];

  if (!DESCENT_AVAILABLE) {
    try {
      fs.rmSync(path.join(anchor.path, ...components), { force: true });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    }
  }
  const dir = openDirDescended(anchor.path, components.slice(0, -1), false);
  if ('ok' in dir) return dir;
  try {
    fs.unlinkSync(at(dir.fd, leaf));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(dir.fd);
  }
}

/**
 * Move `oldRel` → `newRel` within one base, both parents descended O_NOFOLLOW.
 *
 * `fs.rename` has no `renameat` binding in Node, so the leaf move is expressed
 * through the parents' `/proc/self/fd/<fd>` links — resolution relative to the
 * descended descriptors, so a component swapped after the descent no longer
 * participates (M-NEW-018). Fails closed where the descent is unavailable and
 * the parents cannot be held (non-Linux falls back to a name-based rename under
 * the realpath'd base — the single-developer local boundary).
 */
export function renameContainedBase(
  base: string,
  oldRel: string,
  newRel: string,
): { ok: true } | ContainedFail {
  const anchor = baseAnchor(base);
  if ('ok' in anchor) return anchor;
  const oldParts = relativeComponents(oldRel);
  if ('ok' in oldParts) return oldParts;
  const newParts = relativeComponents(newRel);
  if ('ok' in newParts) return newParts;

  if (!DESCENT_AVAILABLE) {
    try {
      fs.renameSync(path.join(anchor.path, ...oldParts), path.join(anchor.path, ...newParts));
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    }
  }

  const srcDir = openDirDescended(anchor.path, oldParts.slice(0, -1), false);
  if ('ok' in srcDir) return srcDir;
  const dstDir = openDirDescended(anchor.path, newParts.slice(0, -1), true);
  if ('ok' in dstDir) {
    closeQuiet(srcDir.fd);
    return dstDir;
  }
  try {
    fs.renameSync(at(srcDir.fd, oldParts[oldParts.length - 1]), at(dstDir.fd, newParts[newParts.length - 1]));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(srcDir.fd);
    closeQuiet(dstDir.fd);
  }
}

/** Recursive remove of `base/relative`, its parent descended O_NOFOLLOW. */
export function rmrfContainedBase(target: BaseRelative): { ok: true } | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;
  const leaf = components[components.length - 1];

  if (!DESCENT_AVAILABLE) {
    try {
      fs.rmSync(path.join(anchor.path, ...components), { recursive: true, force: true });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: failFor(err?.code) };
    }
  }
  const dir = openDirDescended(anchor.path, components.slice(0, -1), false);
  if ('ok' in dir) return dir;
  try {
    // The leaf is addressed through the parent's descriptor; rm removes a
    // terminal symlink itself rather than following it into a target.
    fs.rmSync(at(dir.fd, leaf), { recursive: true, force: true });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(dir.fd);
  }
}

// ============================================================================
// Base-relative enumeration / streaming / metadata (H-017, M-NEW-004/005/024)
// ============================================================================
//
// The read/write helpers above bind a single leaf; these bind a DIRECTORY and
// serve enumeration, bounded recursive walks, read streams, exclusive create
// and a binary sniff from the same descent. Every route/service that resolved a
// path and then re-opened it raw (readdir / createReadStream / archiver.directory
// / stat / sniffFile / mkdir+writeFile) routes through one of these so the swap
// window between resolve and use is closed for the content/destructive family.

/** One directory entry, kind decided at descent time. */
export interface ContainedDirent {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

/**
 * List the directory `base/relative`, descended O_NOFOLLOW. On Linux the leaf
 * directory is opened by descriptor and its entries read through
 * `/proc/self/fd`; elsewhere it degrades to a name-based readdir under the
 * realpath'd base (single-developer local boundary). A leaf that is not a
 * directory, or a component swapped for a symlink, fails closed.
 */
export function readdirContainedBase(
  target: BaseRelative,
): { ok: true; entries: ContainedDirent[]; canonicalPath: string } | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;
  const canonicalPath = path.join(anchor.path, ...components);

  const toDirent = (d: fs.Dirent): ContainedDirent => ({
    name: d.name,
    isDirectory: d.isDirectory(),
    isFile: d.isFile(),
    isSymbolicLink: d.isSymbolicLink(),
  });

  if (!DESCENT_AVAILABLE) {
    try {
      const link = fs.lstatSync(canonicalPath);
      if (link.isSymbolicLink() || !link.isDirectory()) return { ok: false, reason: 'swapped' };
      return { ok: true, entries: fs.readdirSync(canonicalPath, { withFileTypes: true }).map(toDirent), canonicalPath };
    } catch (err: any) {
      return { ok: false, reason: failForDirHop(err?.code) };
    }
  }

  const dir = openDirDescended(anchor.path, components, false);
  if ('ok' in dir) return dir;
  try {
    const stat = fs.fstatSync(dir.fd);
    if (!stat.isDirectory()) return { ok: false, reason: 'not-a-file' };
    return { ok: true, entries: fs.readdirSync(`${PROC_FD}/${dir.fd}`, { withFileTypes: true }).map(toDirent), canonicalPath };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(dir.fd);
  }
}

export interface WalkBudget {
  /** Hard cap on entries visited; the walk stops (truncated) once reached. */
  maxEntries: number;
  /** Hard cap on directory nesting below the root. */
  maxDepth: number;
  /** Hard cap on cumulative file bytes; the walk stops (truncated) once exceeded. */
  maxBytes?: number;
  /**
   * Entries for which this returns true are neither counted, walked nor
   * returned — e.g. excluding `sessions/` from an archive so a folder that is
   * mostly session logs is not refused for bytes that would never be included.
   * `relFromRoot` is POSIX-separated and relative to the walk root.
   */
  skip?: (relFromRoot: string, isDirectory: boolean) => boolean;
}

export interface WalkedFile {
  /** Path of the file RELATIVE to the walk root (POSIX separators). */
  relative: string;
  size: number;
}

/**
 * Bounded, contained recursive walk of `base/relative`. Enumerates once and
 * decrements the entry / depth / byte budget as each entry is read, so the
 * measurement and the consumer (ZIP, tree) share a single snapshot — a file
 * added after enumeration is not in the returned list, and an open/stat error
 * on a component fails that subtree closed rather than being skipped silently
 * (M-NEW-004). Symlinks are never followed.
 */
export function walkContainedBase(
  target: BaseRelative,
  budget: WalkBudget,
): { ok: true; files: WalkedFile[]; truncated: boolean } | ContainedFail {
  const files: WalkedFile[] = [];
  let entries = 0;
  let bytes = 0;
  let truncated = false;

  // BFS by relative path, re-descending from base per directory (O_NOFOLLOW at
  // every hop). Re-descent per level is O(depth) but keeps every hop contained.
  const queue: Array<{ rel: string; depth: number }> = [{ rel: target.relative, depth: 0 }];
  while (queue.length > 0) {
    const { rel, depth } = queue.shift()!;
    if (depth > budget.maxDepth) { truncated = true; continue; }
    const listed = readdirContainedBase({ base: target.base, relative: rel });
    if (!listed.ok) {
      // A missing root is empty; a swap/io error on a subtree fails closed.
      if (listed.reason === 'missing' && depth === 0) return { ok: true, files: [], truncated: false };
      return listed;
    }
    for (const entry of listed.entries) {
      if (entry.isSymbolicLink) continue; // never follow
      const childRel = `${rel}/${entry.name}`;
      const relFromRoot = childRel.slice(target.relative.length + 1);
      if (budget.skip?.(relFromRoot, entry.isDirectory)) continue;
      if (++entries > budget.maxEntries) { truncated = true; return { ok: true, files, truncated }; }
      if (entry.isDirectory) {
        queue.push({ rel: childRel, depth: depth + 1 });
      } else if (entry.isFile) {
        const st = statContainedBase({ base: target.base, relative: childRel });
        if (!st.ok) return st;
        const size = Number(st.stat.size);
        if (budget.maxBytes !== undefined && bytes + size > budget.maxBytes) {
          truncated = true;
          return { ok: true, files, truncated };
        }
        bytes += size;
        files.push({ relative: childRel, size });
      }
    }
  }
  return { ok: true, files, truncated };
}

/**
 * Open `base/relative` as a read STREAM bound to the descended leaf descriptor.
 * The stream owns the fd (`autoClose`), so it is released on end/error. Use for
 * HTTP downloads and ZIP entry append instead of `fs.createReadStream(name)`.
 */
export function createReadStreamContainedBase(
  target: BaseRelative,
): { ok: true; stream: fs.ReadStream; size: number; canonicalPath: string } | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;
  const canonicalPath = path.join(anchor.path, ...components);

  const opened = openLeafBase(anchor.path, components);
  if ('ok' in opened && opened.ok === false) return opened;
  const fd = (opened as { fd: number }).fd;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) { closeQuiet(fd); return { ok: false, reason: 'not-a-file' }; }
    const stream = fs.createReadStream('', { fd, autoClose: true });
    return { ok: true, stream, size: Number(stat.size), canonicalPath };
  } catch (err: any) {
    closeQuiet(fd);
    return { ok: false, reason: failFor(err?.code) };
  }
}

/**
 * Create an empty file at `base/relative` with `O_CREAT | O_EXCL` (fails if it
 * exists), parents created on the way down and the leaf opened O_NOFOLLOW so a
 * planted symlink is refused. For the universal artifact create-file route.
 */
export function createExclusiveContainedBase(target: BaseRelative): { ok: true } | ContainedFail {
  const anchor = baseAnchor(target.base);
  if ('ok' in anchor) return anchor;
  const components = relativeComponents(target.relative);
  if ('ok' in components) return components;
  const leaf = components[components.length - 1];
  const dirs = components.slice(0, -1);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;

  if (!DESCENT_AVAILABLE) {
    try {
      if (dirs.length > 0) fs.mkdirSync(path.join(anchor.path, ...dirs), { recursive: true });
      closeQuiet(fs.openSync(path.join(anchor.path, ...components), flags, 0o644));
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: err?.code === 'EEXIST' ? 'io-error' : failFor(err?.code) };
    }
  }
  const dir = openDirDescended(anchor.path, dirs, true);
  if ('ok' in dir) return dir;
  try {
    closeQuiet(fs.openSync(at(dir.fd, leaf), flags, 0o644));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: failFor(err?.code) };
  } finally {
    closeQuiet(dir.fd);
  }
}

/**
 * Remove every entry directly under `base/relative` (contents-clear), each
 * removal addressed through the descended directory descriptor. The directory
 * itself is kept. For canonical session-dir clear and universal artifact
 * root-clear.
 */
export function clearContainedBase(target: BaseRelative): { ok: true } | ContainedFail {
  const listed = readdirContainedBase(target);
  if (!listed.ok) return listed.reason === 'missing' ? { ok: true } : listed;
  for (const entry of listed.entries) {
    const res = rmrfContainedBase({ base: target.base, relative: `${target.relative}/${entry.name}` });
    if (!res.ok) return res;
  }
  return { ok: true };
}

/**
 * Binary sniff + size from the descended leaf descriptor — the contained twin
 * of `sniffFile(resolveAbsolute(...))`, which reopened the name (M-NEW-024). The
 * sniff and the size come from the same file object the read would bind.
 */
export function sniffContainedBase(
  target: BaseRelative,
): { ok: true; binary: boolean; size: number } | ContainedFail {
  const hint = target.relative.split(/[\\/]+/).pop() ?? target.relative;
  const result = withContainedFdBase(target, (fd) => sniffFd(fd, hint));
  if (!result.ok) return result;
  return { ok: true, binary: result.value.binary, size: Number(result.stat.size) };
}

export const __testing = {
  DESCENT_AVAILABLE,
  anchorForWrite,
  componentsUnder,
  relativeComponents,
};

/**
 * Definition-folder ZIP export — the ONE archive seam for agent and pipeline
 * definitions.
 *
 * An export is a file that LEAVES the platform, so the archive is built from an
 * admit predicate (a relative path is in only when the caller's whitelist names
 * it), never from "whatever the directory holds". That inversion is the whole
 * security posture of this helper: these trees sit next to data that is not part
 * of the definition — an org ACL, a pipeline's `owner.json` authorship
 * coordinates — and a future writer dropping a new sidecar into one of them must
 * be EXCLUDED by default rather than shipped by default. The agent export is
 * therefore the exact mirror of the `/import` whitelist, so a downloaded folder
 * round-trips through import with nothing skipped.
 *
 * Containment and cost follow the artifact-download precedent (M-NEW-004,
 * H-017): the scope ROOT is the descent anchor and the id is a single component
 * below it, symlinks are never followed, ONE bounded walk both measures and
 * supplies the entries (a file added after the snapshot cannot ride in outside
 * the measured budget), and the stream holds a cluster-wide per-account slot for
 * its whole life.
 */

import type { Response } from 'express';
import * as path from 'path';
import archiver from 'archiver';

import type { StateStorePort } from '../../../../../core/ports/stateStore';
import { acquireConcurrencySlot } from '../../../../../core/redis/concurrencySlot';
import {
  createReadStreamContainedBase,
  toBaseRelative,
  walkContainedBase,
} from '../../../../../core/config/containedIo';
import { logger } from '../../../../../utils/logger';
import { bindStreamSlotToResponse } from './streamSlot';

/**
 * Definitions are prose, yaml and on-demand docs. These ceilings sit far above
 * any real definition tree (the write funnel caps a single file at 1 MB) and far
 * below what would make the shared API process spend real time on one request.
 */
export const DEFINITION_ARCHIVE_MAX_ENTRIES = 2_000;
export const DEFINITION_ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;
const DEFINITION_ARCHIVE_MAX_DEPTH = 16;

/** Simultaneous definition exports per account, cluster-wide. */
const DEFINITION_ARCHIVE_MAX_INFLIGHT = 2;
const DEFINITION_ARCHIVE_SLOT_TTL_SECONDS = 15 * 60;

export interface DefinitionArchiveOptions {
  /** Service-owned scope root — the descent anchor. Never a caller-supplied path. */
  root: string;
  /** The agent / pipeline id: exactly ONE path component below `root`. */
  dirName: string;
  /**
   * Export whitelist, applied to every FILE by its path relative to the id
   * directory (POSIX separators). Anything it does not admit is not archived and
   * does not consume the walk budget.
   */
  admits(relPath: string): boolean;
  /** Absent (no Redis config) ⇒ no cluster budget; the walk bounds still apply. */
  stateStore?: StateStorePort;
  /** Per-account budget key, e.g. `ant:slots:defzip:{org}:{user}`. */
  slotKey: string;
  /** Log component tag. */
  component: string;
}

/**
 * Stream `root/dirName` as a ZIP whose single top-level folder is `dirName` —
 * the shape the agent folder IMPORT expects, so export → import round-trips.
 *
 * Answers the response on every path: 400 (bad id), 404 (absent or nothing
 * exportable), 413 (over budget), 429 (per-account budget full), or the archive.
 */
export async function streamDefinitionArchive(res: Response, opts: DefinitionArchiveOptions): Promise<void> {
  // The id is one component by construction at every call site; refusing here
  // keeps that a property of the seam rather than of who remembered to check.
  if (!opts.dirName || opts.dirName.includes('/') || opts.dirName.includes('\\') || opts.dirName.startsWith('.')) {
    res.status(400).json({ error: `Invalid definition folder: ${opts.dirName}` });
    return;
  }
  const br = toBaseRelative(opts.root, path.join(opts.root, opts.dirName));
  if (!br) {
    res.status(404).json({ error: `Definition folder not found: ${opts.dirName}` });
    return;
  }

  const slot = opts.stateStore
    ? await acquireConcurrencySlot(opts.stateStore, opts.slotKey, {
        limit: DEFINITION_ARCHIVE_MAX_INFLIGHT,
        ttlSeconds: DEFINITION_ARCHIVE_SLOT_TTL_SECONDS,
      })
    : { release: async () => {}, refresh: async () => true };
  if (!slot) {
    res.setHeader('Retry-After', '2');
    res.status(429).json({
      code: 'DEFINITION_DOWNLOAD_IN_PROGRESS',
      error: 'Too many downloads in progress',
      message: 'Wait for your current downloads to finish, then try again.',
    });
    return;
  }
  // Release when the RESPONSE ends, never in a finally after finalize() — every
  // early return below ends the response, which fires the release.
  bindStreamSlotToResponse(res, slot);

  // Dot-prefixed entries are invisible in the settings tree, so exporting them
  // would ship what the screen never showed. Non-admitted files are skipped
  // before the budget counter, so a fat foreign file cannot 413 a real export.
  const walk = walkContainedBase(br, {
    maxEntries: DEFINITION_ARCHIVE_MAX_ENTRIES,
    maxDepth: DEFINITION_ARCHIVE_MAX_DEPTH,
    maxBytes: DEFINITION_ARCHIVE_MAX_BYTES,
    skip: (rel, isDirectory) => {
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      if (name.startsWith('.')) return true;
      return !isDirectory && !opts.admits(rel);
    },
  });
  if (!walk.ok) {
    res.status(404).json({ error: `Definition folder not found: ${opts.dirName}` });
    return;
  }
  if (walk.truncated) {
    res.status(413).json({
      code: 'DEFINITION_DOWNLOAD_LIMIT_EXCEEDED',
      error: 'Definition folder too large to download',
      message:
        `This folder exceeds the download limit (${DEFINITION_ARCHIVE_MAX_ENTRIES} files ` +
        `or ${Math.floor(DEFINITION_ARCHIVE_MAX_BYTES / (1024 * 1024))} MB).`,
      limit: { entries: DEFINITION_ARCHIVE_MAX_ENTRIES, bytes: DEFINITION_ARCHIVE_MAX_BYTES },
    });
    return;
  }
  if (walk.files.length === 0) {
    res.status(404).json({ error: `Nothing to download in: ${opts.dirName}` });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(opts.dirName)}.zip"`);
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err: Error) => {
    logger.error('Definition archive error', { component: opts.component }, err);
    if (!res.headersSent) res.status(500).json({ error: 'Archive creation failed' });
  });
  archive.pipe(res);

  // ONE descriptor at a time: wait for the archiver to finish consuming the
  // current entry before opening the next, so a wide tree cannot hold thousands
  // of fds open until finalize (M-031).
  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };
  res.on('close', onAbort);
  try {
    for (const file of walk.files) {
      if (aborted) break;
      const opened = createReadStreamContainedBase({ base: br.base, relative: file.relative });
      if (!opened.ok) continue; // vanished/swapped since the snapshot: skip, never follow
      const consumed = new Promise<void>((resolve) => {
        opened.stream.once('close', () => resolve());
        opened.stream.once('error', () => resolve());
      });
      archive.append(opened.stream, { name: file.relative.replace(/\\/g, '/') });
      await consumed;
    }
  } finally {
    res.off('close', onAbort);
  }

  await archive.finalize();
}

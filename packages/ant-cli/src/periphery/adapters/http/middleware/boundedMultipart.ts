/**
 * Admission control for multipart uploads.
 *
 * All three upload routers use `multer.memoryStorage()`, so every accepted part is
 * held in the process heap until parsing finishes. `UPLOAD_LIMITS` bounds one part
 * and the part count, but their product is ~2.5 GiB of live `Buffer` per request,
 * and nothing bounded how many such requests one account could have in flight
 * (M-007). Ownership and extension checks run in the handler — after the bytes are
 * already resident — so they cannot help.
 *
 * Three gates, all BEFORE multer sees the stream:
 *   1. request rate (Redis-backed, per account);
 *   2. simultaneous multipart requests per account, cluster-wide;
 *   3. a whole-request byte budget, enforced on `Content-Length` when it is present
 *      and on the actual stream when it is not (a chunked body has no declared
 *      length, so trusting the header alone bounds only the honest client).
 *
 * Mount as `boundedMultipart(deps), upload.array('files')` — the order is the
 * point.
 */

import { Transform } from 'stream';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  UPLOAD_MAX_INFLIGHT_PER_USER,
  UPLOAD_REQUEST_MAX_BYTES,
} from '../../../../core/config/uploadLimits';
import { acquireConcurrencySlot, type ConcurrencySlot } from '../../../../core/redis/concurrencySlot';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { logger } from '../../../../utils/logger';
import { uploadRateLimiter } from './rateLimiter';

export interface BoundedMultipartDeps {
  /**
   * Explicit store, for tests and for a caller that already holds one. Omitted in
   * production: the store is resolved lazily from `InfrastructureFactory` (same
   * pattern as `rateLimiter`), so mounting this needs no new wiring through three
   * router signatures. `null` from the resolver leaves the byte budget in force
   * and skips only the in-flight gate.
   */
  stateStore?: StateStorePort;
  /** Override for a route with a different shape. Defaults to the shared budget. */
  maxBytes?: number;
  maxInFlight?: number;
}

let cachedStateStore: StateStorePort | null | undefined;

async function resolveStateStore(explicit?: StateStorePort): Promise<StateStorePort | null> {
  if (explicit) return explicit;
  if (cachedStateStore !== undefined) return cachedStateStore;
  try {
    const { getInfrastructureFactory } = await import('../../../../infrastructure/adapters/InfrastructureFactory');
    cachedStateStore = getInfrastructureFactory().getStateStore();
  } catch {
    cachedStateStore = null;
  }
  return cachedStateStore;
}

/** Slot TTL: a crash backstop, not the release path. Above the slowest real upload. */
const SLOT_TTL_SECONDS = 10 * 60;

function accountKey(req: Request): string {
  const org = (req as any).organization?.id ?? 'unknown';
  const user = (req as any).user?.id ?? 'unknown';
  return `${org}:${user}`;
}

function tooLarge(res: Response, maxBytes: number): void {
  res.status(413).json({
    code: 'UPLOAD_REQUEST_TOO_LARGE',
    error: 'Upload too large',
    message: `The files in one request may total at most ${Math.floor(maxBytes / (1024 * 1024))} MB. Upload them in smaller batches.`,
  });
}

export function boundedMultipart(deps: BoundedMultipartDeps = {}): RequestHandler[] {
  const maxBytes = deps.maxBytes ?? UPLOAD_REQUEST_MAX_BYTES;
  const maxInFlight = deps.maxInFlight ?? UPLOAD_MAX_INFLIGHT_PER_USER;

  const gate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Declared length — refuse before reading a single byte when we can.
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      tooLarge(res, maxBytes);
      return;
    }

    // 2. Cluster-wide in-flight budget for this account.
    let slot: ConcurrencySlot | null = null;
    const stateStore = await resolveStateStore(deps.stateStore);
    if (stateStore) {
      slot = await acquireConcurrencySlot(
        stateStore,
        `ant:slots:upload:${accountKey(req)}`,
        { limit: maxInFlight, ttlSeconds: SLOT_TTL_SECONDS },
      );
      if (!slot) {
        res.status(429).json({
          code: 'UPLOAD_CONCURRENCY_LIMIT',
          error: 'Too many uploads in progress',
          message: 'Wait for your current uploads to finish, then try again.',
        });
        return;
      }
    }

    // Released on every terminal outcome — success, client abort, or error. Missing
    // one leaks the slot until its TTL, which silently shrinks the budget.
    let released = false;
    const release = () => {
      if (released || !slot) return;
      released = true;
      void slot.release();
    };
    res.on('finish', release);
    res.on('close', release);
    req.on('aborted', release);

    // 3. Actual bytes. A chunked body declares no length, so the budget has to be
    //    enforced on the stream itself — and enforced AS IT ARRIVES, so the parse
    //    stops before more Buffers accumulate rather than after.
    //
    //    The counter is interposed by wrapping `pipe`, not by adding a `data`
    //    listener: a listener would switch the request into flowing mode
    //    immediately and multer (`req.pipe(busboy)`) would miss the bytes it
    //    consumed. Wrapping keeps multer the only consumer, with the counter
    //    between the two.
    let seen = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        seen += chunk.length;
        if (seen > maxBytes) {
          logger.warn(
            `[boundedMultipart] aborting upload from ${accountKey(req)}: exceeded the ${maxBytes}-byte budget`,
            { component: 'boundedMultipart' },
          );
          if (!res.headersSent) tooLarge(res, maxBytes);
          // Erroring the counter unpipes multer, so the parts already collected
          // are abandoned instead of completing into `req.files`.
          cb(new Error('UPLOAD_REQUEST_TOO_LARGE'));
          req.destroy();
          return;
        }
        cb(null, chunk);
      },
    });
    // Nothing else may consume the errored counter.
    counter.on('error', () => { /* reported above */ });

    const originalPipe = req.pipe.bind(req);
    (req as any).pipe = (dest: any, opts?: any) => {
      originalPipe(counter as any);
      return (counter as any).pipe(dest, opts);
    };

    next();
  };

  return [uploadRateLimiter, gate];
}

export const __testing = {
  resetStateStoreCache: () => {
    cachedStateStore = undefined;
  },
};

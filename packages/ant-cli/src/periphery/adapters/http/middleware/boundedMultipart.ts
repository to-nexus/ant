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
 * Four gates, all BEFORE multer sees the stream:
 *   1. request rate (Redis-backed, per account);
 *   2. a pod-wide in-flight byte ceiling across ALL accounts (process-local, so
 *      always enforced) — bounds this replica's heap when many accounts converge;
 *   3. simultaneous multipart requests per account, cluster-wide;
 *   4. a whole-request byte budget, enforced on `Content-Length` when it is present
 *      and on the actual stream when it is not (a chunked body has no declared
 *      length, so trusting the header alone bounds only the honest client).
 *
 * Mount as `boundedMultipartUpload(upload, 'files', deps)` — it composes the
 * gates, multer, and multer's own refusals in that order, which is the point.
 */

import { Transform } from 'stream';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';

import {
  UPLOAD_LIMITS,
  UPLOAD_MAX_INFLIGHT_PER_USER,
  UPLOAD_REQUEST_MAX_BYTES,
  UPLOAD_POD_MAX_INFLIGHT_BYTES,
  UPLOAD_ACCOUNT_MAX_INFLIGHT_BYTES,
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
  /** Pod-wide in-flight byte ceiling (test override). Defaults to the SSOT. */
  podMaxBytes?: number;
  /** Per-account share of the pod ceiling (test override). Defaults to the SSOT. */
  accountMaxBytes?: number;
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

/**
 * Process-local sum of in-flight upload bytes reserved across ALL accounts on
 * this replica (M-007). Reserved before multer buffers anything and released on
 * every terminal outcome; no Redis dependency, so it is always enforced.
 */
let podInflightBytes = 0;

/**
 * The same reservation, split per account (L-033). The pod counter bounds the
 * replica but does not divide it, so one account could hold the whole ceiling
 * and 429 everyone else while staying inside its own allowance. Same map, same
 * release points — a second lifetime is a second leak.
 */
const accountInflightBytes = new Map<string, number>();

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

/**
 * multer's own limit breaches, answered as typed 4xx JSON.
 *
 * multer aborts with `next(new MulterError(code))`. There was no error handler
 * anywhere in this process, so every breach became Express's default HTML 500 —
 * a refusal no client could parse or act on, and the reason a 115-file folder
 * drop surfaced to the user as a bare "upload failed" (AGENTS.md: an enumeration
 * budget running out must degrade or refuse in a TYPED way, never throw).
 *
 * Shape mirrors `tooLarge()` — `{ code, error, message }`. Deliberately NOT
 * `sendErrorResponse`: that emits no `code` and replaces the message with a
 * generic string in production, which is right for an unexpected 500 and wrong
 * for a budget refusal the client must render and act on.
 *
 * Returns true when it answered, so the caller does not also call `next(err)`.
 */
export function refuseMultipartError(res: Response, err: unknown): boolean {
  if (!(err instanceof multer.MulterError)) return false;

  const warn = (code: string) =>
    logger.warn(`[boundedMultipart] refusing upload: ${err.code} → ${code}`, {
      component: 'boundedMultipart',
    });

  switch (err.code) {
    // All three mean the same actionable thing now that `fields`/`parts` are
    // derived from `files`: this request carries more files than one request may.
    // One client-facing code, so the FE has one branch.
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_PART_COUNT':
    case 'LIMIT_FILE_COUNT':
      warn('UPLOAD_TOO_MANY_FILES');
      res.status(413).json({
        code: 'UPLOAD_TOO_MANY_FILES',
        error: 'Too many files in one request',
        message: `One request may carry at most ${UPLOAD_LIMITS.files} files. Upload them in smaller batches.`,
        limit: UPLOAD_LIMITS.files,
      });
      return true;

    case 'LIMIT_FILE_SIZE': {
      const limitMb = Math.floor(UPLOAD_LIMITS.fileSize / (1024 * 1024));
      warn('UPLOAD_FILE_TOO_LARGE');
      res.status(413).json({
        code: 'UPLOAD_FILE_TOO_LARGE',
        error: 'File too large',
        message: `Each file may be at most ${limitMb} MB.`,
        limitMb,
        ...(err.field ? { field: err.field } : {}),
      });
      return true;
    }

    case 'LIMIT_FIELD_VALUE':
      warn('UPLOAD_FIELD_TOO_LARGE');
      res.status(413).json({
        code: 'UPLOAD_FIELD_TOO_LARGE',
        error: 'Upload field too large',
        message: 'One of the upload form values is too large.',
      });
      return true;

    case 'LIMIT_UNEXPECTED_FILE':
      warn('UPLOAD_UNEXPECTED_FIELD');
      res.status(400).json({
        code: 'UPLOAD_UNEXPECTED_FIELD',
        error: 'Unexpected upload field',
        message: `This route accepts files on a different field${err.field ? ` (got "${err.field}")` : ''}.`,
      });
      return true;

    // LIMIT_FIELD_KEY, MISSING_FIELD_NAME, INVALID_FIELD_NAME,
    // LIMIT_FIELD_NESTING, LIMIT_FIELD_ARRAY_INDEX, and anything multer adds
    // later: a malformed body, not a budget the client can shrink into.
    default:
      warn('UPLOAD_MALFORMED');
      res.status(400).json({
        code: 'UPLOAD_MALFORMED',
        error: 'Malformed upload',
        message: 'The upload could not be read by the server. Try again.',
      });
      return true;
  }
}

/**
 * The one way to mount a multipart route: admission gates, then multer, then
 * multer's refusals typed.
 *
 * A per-route error middleware would work too, but adoption would be a thing
 * each author has to remember — and AGENTS.md is explicit that a guard must
 * enumerate the SET, not the routes someone remembered. Composing the wrapper
 * makes adoption a property of the call, and the absence of a bare
 * `upload.array(` under `routes/` is a greppable, test-enforced set.
 */
export function boundedMultipartUpload(
  upload: multer.Multer,
  field = 'files',
  deps: BoundedMultipartDeps = {},
): RequestHandler[] {
  return [
    ...boundedMultipart(deps),
    (req, res, next) =>
      upload.array(field)(req, res, (err?: unknown) => {
        if (!err) return next();
        if (refuseMultipartError(res, err)) return;
        next(err);
      }),
  ];
}

export function boundedMultipart(deps: BoundedMultipartDeps = {}): RequestHandler[] {
  const maxBytes = deps.maxBytes ?? UPLOAD_REQUEST_MAX_BYTES;
  const maxInFlight = deps.maxInFlight ?? UPLOAD_MAX_INFLIGHT_PER_USER;
  const podMaxBytes = deps.podMaxBytes ?? UPLOAD_POD_MAX_INFLIGHT_BYTES;
  const accountMaxBytes = deps.accountMaxBytes ?? UPLOAD_ACCOUNT_MAX_INFLIGHT_BYTES;

  const gate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Declared length — refuse before reading a single byte when we can.
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      tooLarge(res, maxBytes);
      return;
    }

    // 2. Pod-wide byte reservation across ALL accounts — bounds this replica's
    //    upload heap even when many different accounts converge here, which the
    //    per-account slot below cannot (M-007). Reserve the declared length, or
    //    the whole-request budget when the body is chunked (no declared length),
    //    so a flood of length-less uploads is bounded too. Fail-closed, no Redis.
    const reserveBytes = Number.isFinite(declared) && declared > 0
      ? Math.min(declared, maxBytes)
      : maxBytes;
    if (podInflightBytes + reserveBytes > podMaxBytes) {
      res.setHeader('Retry-After', '2');
      res.status(429).json({
        code: 'UPLOAD_POD_BUSY',
        error: 'Server is handling too many uploads right now',
        message: 'Too many uploads are in progress on this server. Retry shortly.',
      });
      return;
    }
    //    …and this account's share of it, so a single account cannot occupy the
    //    whole replica budget (L-033). Checked before either counter moves, so a
    //    refusal leaves both untouched.
    const acctKey = accountKey(req);
    const acctInflight = accountInflightBytes.get(acctKey) ?? 0;
    if (acctInflight + reserveBytes > accountMaxBytes) {
      res.setHeader('Retry-After', '2');
      res.status(429).json({
        code: 'UPLOAD_ACCOUNT_BUSY',
        error: 'Too many uploads in progress for this account',
        message: 'You already have uploads in flight on this server. Retry when they finish.',
      });
      return;
    }

    podInflightBytes += reserveBytes;
    accountInflightBytes.set(acctKey, acctInflight + reserveBytes);
    let podReleased = false;
    const releasePod = () => {
      if (podReleased) return;
      podReleased = true;
      podInflightBytes = Math.max(0, podInflightBytes - reserveBytes);
      const left = (accountInflightBytes.get(acctKey) ?? reserveBytes) - reserveBytes;
      if (left <= 0) accountInflightBytes.delete(acctKey);
      else accountInflightBytes.set(acctKey, left);
    };
    res.on('finish', releasePod);
    res.on('close', releasePod);
    req.on('aborted', releasePod);

    // 3. Cluster-wide in-flight budget for this account.
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

    // 4. Actual bytes. A chunked body declares no length, so the budget has to be
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
  resetPodInflight: () => {
    podInflightBytes = 0;
    accountInflightBytes.clear();
  },
  podInflightBytes: () => podInflightBytes,
  accountInflightBytes: () => new Map(accountInflightBytes),
};

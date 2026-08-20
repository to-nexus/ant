/**
 * Rate Limiting Middleware
 *
 * Provides per-category rate limiters for public-facing servers.
 * Uses Redis store via rate-limit-redis for distributed (multi-pod) consistency.
 *
 * Bootstrap-time initialization + static-import-safe no-op proxies:
 *   - Each exported limiter is a stable `RequestHandler` proxy. Until
 *     `initializeRateLimiters()` is called, the proxy logs a one-time
 *     warning and passes the request through (`next()`). Once initialized,
 *     the proxy delegates to the real `rateLimit({...})` handler built
 *     during bootstrap.
 *   - `initializeRateLimiters()` MUST be invoked once during server
 *     bootstrap AFTER `InfrastructureFactory` is initialized and BEFORE
 *     the limiters are mounted onto Express routers. Re-invocation is
 *     a no-op (idempotent).
 *   - This pattern avoids the express-rate-limit@8
 *     ERR_ERL_CREATED_IN_REQUEST_HANDLER validation warning that fires
 *     when `rateLimit({...})` is called from within a request handler,
 *     while still keeping `getLazySendCommand` so vitest's static-import
 *     graph does not require ANT_REDIS_URL during `prebuild`.
 */

import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import { logger } from '../../../../utils/logger';

let cachedSendCommand: ((...args: string[]) => Promise<RedisReply>) | null = null;

function getLazySendCommand(): (...args: string[]) => Promise<RedisReply> {
  return async (...args: string[]): Promise<RedisReply> => {
    if (!cachedSendCommand) {
      const { getInfrastructureFactory } = await import('../../../../infrastructure/adapters/InfrastructureFactory');
      const stateStore = getInfrastructureFactory().getStateStore() as any;
      cachedSendCommand = (...a: string[]) => stateStore.redis.call(a[0], ...a.slice(1));
    }
    return cachedSendCommand(...args);
  };
}

function createStore(prefix: string): RedisStore {
  return new RedisStore({
    sendCommand: getLazySendCommand(),
    prefix: `ant:ratelimit:${prefix}:`,
  });
}

function perUserKeyGenerator(req: any): string {
  if (req.user?.id) return req.user.id;
  return 'unknown';
}

// ============================================
// Bootstrap state + no-op proxies
// ============================================

let initialized = false;

let authInner: RequestHandler | null = null;
let jobExecuteInner: RequestHandler | null = null;
let chatInner: RequestHandler | null = null;
let previewInner: RequestHandler | null = null;
let organizationsInner: RequestHandler | null = null;
let uploadInner: RequestHandler | null = null;
let treeInner: RequestHandler | null = null;
let downloadInner: RequestHandler | null = null;
let forceRefreshInner: RequestHandler | null = null;
let healthInner: RequestHandler | null = null;

const warnedOnce = new Set<string>();

function makeProxy(name: string, getInner: () => RequestHandler | null): RequestHandler {
  return (req, res, next) => {
    const inner = getInner();
    if (initialized && inner) {
      return inner(req, res, next);
    }
    if (!warnedOnce.has(name)) {
      warnedOnce.add(name);
      logger.warn(
        `[rateLimiter] limiter "${name}" invoked before initializeRateLimiters() was called; passing through`,
        { component: 'rateLimiter' },
      );
    }
    return next();
  };
}

/**
 * Auth rate limit (10 req/min per IP)
 */
export const authRateLimiter: RequestHandler = makeProxy('auth', () => authInner);

/**
 * Job execution rate limit (5 req/min per user)
 */
export const jobExecuteRateLimiter: RequestHandler = makeProxy('job', () => jobExecuteInner);

/**
 * Chat/Ask rate limit (20 req/min per user)
 */
export const chatRateLimiter: RequestHandler = makeProxy('chat', () => chatInner);

/**
 * Preview management rate limit (30 req/min per user)
 */
export const previewRateLimiter: RequestHandler = makeProxy('preview', () => previewInner);

/**
 * Organization search rate limit (30 req/min per user).
 *
 * Powers the OrganizationOnboardingScreen autocomplete — the FE
 * debounces at 300ms but a misbehaving client could still flood the
 * endpoint. The repo's search scans every org id in the index, so
 * cheap rate-limiting at the edge is cheaper than letting the SCAN
 * pile up.
 *
 * Note: `_pending` JWTs (onboarding-in-progress) DO carry a valid
 * `req.user.id`, so `perUserKeyGenerator` works for them too.
 */
export const organizationsRateLimiter: RequestHandler = makeProxy('organizations', () => organizationsInner);

/**
 * Expensive-request limiters.
 *
 * These endpoints were all owner-checked and path-checked but cost-unbounded: the
 * gates proved WHOSE data it was, never how much work it was. One authenticated
 * account could hold multipart buffers, recursive tree scans and ZIP streams open
 * in parallel and saturate the shared pod (M-007, H-008, M-009, M-NEW-004). Rate is
 * the first half of the answer; the in-flight semaphore in
 * `core/redis/concurrencySlot` is the second — a rate limit alone still allows a
 * few very long, very heavy requests.
 */
export const uploadRateLimiter: RequestHandler = makeProxy('upload', () => uploadInner);
export const treeRateLimiter: RequestHandler = makeProxy('tree', () => treeInner);
export const downloadRateLimiter: RequestHandler = makeProxy('download', () => downloadInner);
/** `?force=true` bypasses the tree cache by design; the bypass itself needs a budget. */
export const forceRefreshRateLimiter: RequestHandler = makeProxy('forceRefresh', () => forceRefreshInner);

/**
 * Public preview `/health` limiter (per IP). Unauthenticated and pre-auth, so it
 * cannot key on a user; a distributed per-IP cap keeps anonymous polling from
 * hammering the endpoint (M-NEW-020, defense-in-depth on top of the O(1) count).
 */
export const healthRateLimiter: RequestHandler = makeProxy('health', () => healthInner);

/**
 * Bootstrap-time initialization for every rate limiter.
 *
 * MUST be invoked once during server bootstrap AFTER
 * `InfrastructureFactory` is initialized and BEFORE any router that
 * uses one of the exported limiters is mounted. Re-invocation is a
 * no-op (idempotent), so duplicate calls across multiple server
 * bootstraps in the same process are safe.
 */
export function initializeRateLimiters(): void {
  if (initialized) return;

  authInner = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore('auth'),
    message: { error: 'Too many authentication attempts', message: 'Please try again later.' },
  });

  jobExecuteInner = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('job'),
    message: { error: 'Too many job requests', message: 'Please wait before starting another job.' },
  });

  chatInner = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('chat'),
    message: { error: 'Too many chat requests', message: 'Please slow down.' },
  });

  previewInner = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('preview'),
    message: { error: 'Too many preview requests', message: 'Please try again later.' },
  });

  organizationsInner = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('organizations'),
    message: { error: 'Too many organization search requests', message: 'Please slow down.' },
  });

  uploadInner = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('upload'),
    message: { error: 'Too many uploads', message: 'Please wait before uploading more files.' },
  });

  treeInner = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('tree'),
    message: { error: 'Too many file-tree requests', message: 'Please slow down.' },
  });

  downloadInner = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('download'),
    message: { error: 'Too many downloads', message: 'Please wait before downloading again.' },
  });

  // Tighter than the cached read: each one starts a full filesystem walk.
  forceRefreshInner = rateLimit({
    windowMs: 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('forcerefresh'),
    message: {
      error: 'Too many forced refreshes',
      message: 'The file tree is refreshed automatically; please wait before forcing another.',
    },
  });

  // Public /health — keyed by IP (default keyGenerator), since it is pre-auth.
  healthInner = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore('health'),
    message: { error: 'Too many health checks', message: 'Please slow down.' },
  });

  initialized = true;
}

/**
 * Rate Limiting Middleware
 *
 * Provides per-category rate limiters for public-facing servers.
 * Uses Redis store via rate-limit-redis for distributed (multi-pod) consistency.
 *
 * Two layers of laziness:
 *   1. `getLazySendCommand` defers the Redis client resolution until the
 *      store actually issues a command.
 *   2. `lazyRateLimiter` defers the `rateLimit({...})` call itself until
 *      the first request reaches the middleware — express-rate-limit@8
 *      calls `store.init()` synchronously inside its factory, which would
 *      otherwise force every importer (e.g. vitest's static-import graph
 *      during `prebuild`) to have ANT_REDIS_URL set even when no real
 *      request is in flight.
 */

import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';

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

function lazyRateLimiter(build: () => RequestHandler): RequestHandler {
  let inner: RequestHandler | null = null;
  return (req, res, next) => {
    if (!inner) inner = build();
    return inner(req, res, next);
  };
}

/**
 * Auth rate limit (10 req/min per IP)
 */
export const authRateLimiter: RequestHandler = lazyRateLimiter(() =>
  rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore('auth'),
    message: { error: 'Too many authentication attempts', message: 'Please try again later.' },
  }),
);

/**
 * Job execution rate limit (5 req/min per user)
 */
export const jobExecuteRateLimiter: RequestHandler = lazyRateLimiter(() =>
  rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('job'),
    message: { error: 'Too many job requests', message: 'Please wait before starting another job.' },
  }),
);

/**
 * Chat/Ask rate limit (20 req/min per user)
 */
export const chatRateLimiter: RequestHandler = lazyRateLimiter(() =>
  rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('chat'),
    message: { error: 'Too many chat requests', message: 'Please slow down.' },
  }),
);

/**
 * Preview management rate limit (30 req/min per user)
 */
export const previewRateLimiter: RequestHandler = lazyRateLimiter(() =>
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('preview'),
    message: { error: 'Too many preview requests', message: 'Please try again later.' },
  }),
);

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
export const organizationsRateLimiter: RequestHandler = lazyRateLimiter(() =>
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUserKeyGenerator,
    store: createStore('organizations'),
    message: { error: 'Too many organization search requests', message: 'Please slow down.' },
  }),
);

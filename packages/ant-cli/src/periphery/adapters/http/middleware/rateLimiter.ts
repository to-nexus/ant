/**
 * Rate Limiting Middleware
 * 
 * Provides per-category rate limiters for public-facing servers.
 * Uses Redis store via rate-limit-redis for distributed (multi-pod) consistency.
 * 
 * The sendCommand function lazily resolves the Redis client from
 * InfrastructureFactory, so the rate limiters can be imported before
 * the factory is initialized (actual Redis calls only happen on first request).
 */

import rateLimit from 'express-rate-limit';
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

/**
 * General API rate limit (100 req/min per user)
 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUserKeyGenerator,
  store: createStore('general'),
  message: { error: 'Too many requests', message: 'Please try again later.' },
});

/**
 * Auth rate limit (10 req/min per IP)
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('auth'),
  message: { error: 'Too many authentication attempts', message: 'Please try again later.' },
});

/**
 * Job execution rate limit (5 req/min per user)
 */
export const jobExecuteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUserKeyGenerator,
  store: createStore('job'),
  message: { error: 'Too many job requests', message: 'Please wait before starting another job.' },
});

/**
 * Chat/Ask rate limit (20 req/min per user)
 */
export const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUserKeyGenerator,
  store: createStore('chat'),
  message: { error: 'Too many chat requests', message: 'Please slow down.' },
});

/**
 * Preview management rate limit (10 req/min per user)
 */
export const previewRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUserKeyGenerator,
  store: createStore('preview'),
  message: { error: 'Too many preview requests', message: 'Please try again later.' },
});

/**
 * Rate Limiting Middleware
 * 
 * Provides per-category rate limiters for public-facing servers.
 * Uses express-rate-limit with in-memory store (suitable for single-pod).
 * 
 * For multi-pod deployments, switch to rate-limit-redis store.
 */

import rateLimit from 'express-rate-limit';

/**
 * General API rate limit (100 req/min per IP)
 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Please try again later.' },
});

/**
 * Auth rate limit (10 req/min per IP) - login/signup endpoints
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts', message: 'Please try again later.' },
});

/**
 * Job execution rate limit (5 req/min per IP)
 */
export const jobExecuteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many job requests', message: 'Please wait before starting another job.' },
});

/**
 * Chat/Ask rate limit (20 req/min per IP)
 */
export const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat requests', message: 'Please slow down.' },
});

/**
 * Preview management rate limit (10 req/min per IP)
 */
export const previewRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many preview requests', message: 'Please try again later.' },
});

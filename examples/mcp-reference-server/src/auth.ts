import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { log } from './log.js';

function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerAuth(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!presented || !tokensMatch(presented, expectedToken)) {
      log('auth_rejected', { path: req.path });
      res.status(401).json({
        error: 'This server requires a valid "Authorization: Bearer <token>" header matching MCP_AUTH_TOKEN.',
      });
      return;
    }
    next();
  };
}

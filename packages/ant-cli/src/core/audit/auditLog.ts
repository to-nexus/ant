/**
 * Audit log — the one owner of the `[Audit]` line format.
 *
 * Every security-relevant action a person or an agent takes is one structured
 * INFO line with a fixed tag, so an operator's log pipeline can retain and
 * search them separately from application noise: who (user/org), when (the
 * logger's timestamp), where (job/agent), what (event + fields). The full
 * record — a tool call's arguments and result — already lives in the session
 * transcript; the line carries a DIGEST of the arguments, never the arguments,
 * so a credential typed into a command never reaches the log stream.
 */

import { createHash } from 'crypto';
import { logger } from '../../utils/logger';

export type AuditEvent = 'login' | 'approval' | 'tool';

export type AuditFields = Record<string, string | number | boolean | null | undefined>;

export const AUDIT_TAG = '[Audit]';

export function auditLog(event: AuditEvent, fields: AuditFields): void {
  logger.info(`${AUDIT_TAG} ${event}`, { component: 'Audit' }, fields);
}

/** First 16 hex chars of the SHA-256 of the JSON-serialized arguments. */
export function argsDigest(args: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(args ?? null) ?? 'null';
  } catch {
    serialized = String(args);
  }
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

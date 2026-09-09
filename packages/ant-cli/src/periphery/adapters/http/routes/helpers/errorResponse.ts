/**
 * Safe Error Response Utility
 * 
 * Prevents internal implementation details from leaking to clients.
 * In production, error details are logged server-side and a generic message is returned.
 * In development, error messages are passed through for debugging.
 * 
 * Addresses CWE-209 (Generation of Error Message Containing Sensitive Information)
 */

import { Response } from 'express';
import { logger } from '../../../../../utils/logger';
import * as crypto from 'crypto';

/**
 * Send a safe error response.
 * 
 * - Logs full error details server-side (with correlation ID)
 * - Returns generic message to client in production
 * - Returns error.message in development
 */
export function sendErrorResponse(
  res: Response,
  statusCode: number,
  error: unknown,
  context: string,
): void {
  const correlationId = crypto.randomBytes(4).toString('hex');
  const isProduction = process.env.NODE_ENV === 'production';
  const message = error instanceof Error ? error.message : String(error);

  logger.error(`[${context}] (${statusCode}) ${message} [cid:${correlationId}]`, {
    component: context,
  }, error instanceof Error ? error : undefined);

  const clientMessage = isProduction
    ? 'An internal error occurred.'
    : message;

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal Server Error' : 'Request Failed',
    message: clientMessage,
    correlationId,
  });
}

/**
 * Send a DECIDED refusal — a verdict this route reached on purpose, as opposed
 * to an unexpected throw.
 *
 * `sendErrorResponse` is the wrong shape for these: its envelope carries no
 * `code` and is genericised to "An internal error occurred." in production, so
 * a client cannot tell one refusal from another and the user is shown nothing
 * actionable. That is how a resume that the server refused on purpose became a
 * button that visibly did nothing. Same contract as `refuseMultipartError`:
 * a typed `{ code, error, message }` with an explicit status.
 *
 * Anything unexpected still goes to `sendErrorResponse` — this is for verdicts,
 * not for surprises.
 */
export function sendRefusal(
  res: Response,
  refusal: { status: number; code: string; error: string; message?: string; [k: string]: unknown },
  context: string,
): void {
  const { status, code, error, message, ...extra } = refusal;
  logger.info(`[${context}] refused (${status}) ${code}: ${error}`, { component: context });
  res.status(status).json({ code, error, message: message ?? error, ...extra });
}

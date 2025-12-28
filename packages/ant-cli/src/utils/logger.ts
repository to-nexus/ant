export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  component?: string;
  organizationId?: string;
  userId?: string;
  projectId?: string;
  featureName?: string;
  jobId?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getConfiguredLevel(): LogLevel {
  const raw = (process.env.ANT_LOG_LEVEL || '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getConfiguredLevel()];
}

function formatPrefix(ctx?: LogContext): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.component) parts.push(ctx.component);
  if (ctx.organizationId || ctx.userId) parts.push(`${ctx.organizationId || '?'}:${ctx.userId || '?'}`);
  if (ctx.projectId || ctx.featureName) parts.push(`${ctx.projectId || '?'}:${ctx.featureName || '?'}`);
  if (ctx.jobId) parts.push(`job:${ctx.jobId}`);
  return parts.length ? `[${parts.join(' | ')}] ` : '';
}

export const logger = {
  debug(message: string, ctx?: LogContext, meta?: unknown) {
    if (!shouldLog('debug')) return;
    // eslint-disable-next-line no-console
    meta !== undefined ? console.debug(`${formatPrefix(ctx)}${message}`, meta) : console.debug(`${formatPrefix(ctx)}${message}`);
  },
  info(message: string, ctx?: LogContext, meta?: unknown) {
    if (!shouldLog('info')) return;
    // eslint-disable-next-line no-console
    meta !== undefined ? console.log(`${formatPrefix(ctx)}${message}`, meta) : console.log(`${formatPrefix(ctx)}${message}`);
  },
  warn(message: string, ctx?: LogContext, meta?: unknown) {
    if (!shouldLog('warn')) return;
    // eslint-disable-next-line no-console
    meta !== undefined ? console.warn(`${formatPrefix(ctx)}${message}`, meta) : console.warn(`${formatPrefix(ctx)}${message}`);
  },
  error(message: string, ctx?: LogContext, meta?: unknown) {
    if (!shouldLog('error')) return;
    // eslint-disable-next-line no-console
    meta !== undefined ? console.error(`${formatPrefix(ctx)}${message}`, meta) : console.error(`${formatPrefix(ctx)}${message}`);
  },
};



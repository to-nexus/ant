/**
 * consoleLogCache — sessionStorage-backed log buffer for the preview/deploy
 * consoles.
 *
 * Logs live only in the Zustand store (memory) and the backend owning-pod's
 * in-memory ring buffer; neither survives a page refresh, and in cloud the
 * non-owning-pod GET returns an empty/last-50 buffer. Since the user workflow
 * is "failure → refresh → retry", we mirror the per-feature buffer into
 * sessionStorage so a refresh RESTORES the prior run's logs (the browser
 * becomes the source of truth, sidestepping the multi-pod gap).
 *
 * Lifecycle:
 *   - write : throttled (trailing-edge) on every log append; flushed on
 *             tab-hide / pagehide.
 *   - read  : on initial mount, to hydrate an empty store buffer (cold start).
 *   - clear : on (re)start, alongside the store buffer reset — so "restart
 *             resets logs" holds. A refresh is a RESTORE, not a clear.
 *
 * sessionStorage (not localStorage): survives F5, auto-clears on tab close,
 * no long-term accumulation to prune.
 */

export type ConsoleLogKind = 'preview' | 'deploy';

interface MinimalLogEntry {
  timestamp: string;
  type?: 'stdout' | 'stderr';
  message: string;
}

const PREFIX = 'ant:console-logs';
// Match the in-store caps so a hydrated buffer can't exceed what the live
// stream would hold.
const CAP: Record<ConsoleLogKind, number> = { preview: 500, deploy: 200 };
const WRITE_THROTTLE_MS = 500;

const keyFor = (kind: ConsoleLogKind, featureKey: string): string =>
  `${PREFIX}:${kind}:${featureKey}`;

function safeSession(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    // Access can throw in privacy modes / sandboxed iframes.
    return null;
  }
}

export function readLogs<T extends MinimalLogEntry = MinimalLogEntry>(
  kind: ConsoleLogKind,
  featureKey: string,
): T[] | null {
  const ss = safeSession();
  if (!ss) return null;
  try {
    const raw = ss.getItem(keyFor(kind, featureKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

interface PendingWrite {
  kind: ConsoleLogKind;
  featureKey: string;
  logs: MinimalLogEntry[];
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingWrite>();

function persistNow(
  kind: ConsoleLogKind,
  featureKey: string,
  logs: MinimalLogEntry[],
): void {
  const ss = safeSession();
  if (!ss) return;
  try {
    ss.setItem(keyFor(kind, featureKey), JSON.stringify(logs.slice(-CAP[kind])));
  } catch {
    // QuotaExceeded / serialization failure — retry with a smaller tail once.
    try {
      ss.setItem(
        keyFor(kind, featureKey),
        JSON.stringify(logs.slice(-Math.max(1, Math.floor(CAP[kind] / 4)))),
      );
    } catch {
      /* give up — logs persistence is best-effort */
    }
  }
}

/**
 * Throttled (trailing-edge) write. Rapid calls coalesce so a high-frequency
 * log stream persists at most once per `WRITE_THROTTLE_MS`, always capturing
 * the latest snapshot.
 */
export function writeLogs(
  kind: ConsoleLogKind,
  featureKey: string,
  logs: MinimalLogEntry[],
): void {
  const k = keyFor(kind, featureKey);
  const existing = pending.get(k);
  if (existing) {
    existing.logs = logs;
    return;
  }
  const timer = setTimeout(() => {
    const p = pending.get(k);
    pending.delete(k);
    if (p) persistNow(p.kind, p.featureKey, p.logs);
  }, WRITE_THROTTLE_MS);
  pending.set(k, { kind, featureKey, logs, timer });
}

export function clearLogs(kind: ConsoleLogKind, featureKey: string): void {
  const k = keyFor(kind, featureKey);
  const p = pending.get(k);
  if (p) {
    clearTimeout(p.timer);
    pending.delete(k);
  }
  const ss = safeSession();
  if (!ss) return;
  try {
    ss.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Persist all pending throttled writes immediately (tab-hide / unload). */
export function flushAll(): void {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    persistNow(p.kind, p.featureKey, p.logs);
  }
  pending.clear();
}

// Flush on tab-hide / unload so a refresh (or close+reopen within the session)
// doesn't lose the throttled tail.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', flushAll);
}

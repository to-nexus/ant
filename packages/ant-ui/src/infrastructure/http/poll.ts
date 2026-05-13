/**
 * IDE pre-flight readiness probe.
 *
 * Polls the IDE proxy URL until BOTH (a) the root workbench HTML AND
 * (b) a known static asset return any HTTP status < 500. Used by the
 * `startIdeSession` store action so the iframe is only embedded after
 * openvscode-server has actually started serving — closes the race where
 * the BE returns the URL but the iframe `src` GETs a 500 from a still-
 * booting code-server.
 *
 * Two paths matter because they exercise DIFFERENT layers:
 *
 *   `/`            — root: tells us the server process is up and the
 *                    proxy can reach it. But root often returns 200 even
 *                    when `--server-base-path` routing is broken, so it
 *                    is NOT a sufficient signal on its own.
 *   `/favicon.ico` — static asset: forces the same routing path that the
 *                    iframe will later hit for nls.messages.js / workbench.js.
 *                    If proxy ↔ openvscode-server base-path contract is
 *                    mismatched this returns 500 and the gate stays closed,
 *                    preventing the "iframe loads then static-asset 500"
 *                    user-visible failure mode.
 *
 * Mirrors the BE-side `waitForHttpReady` shape in shape and intent. Kept
 * separate (not unified with `useHealthCheck`) because the semantic is
 * different: this is poll-until-ready, not one-shot.
 */
/**
 * Single-shot liveness probe used by `startIdeSession`'s fast-path to
 * distinguish (a) a still-mounted iframe pointing at a live pod from
 * (b) a stale `ideBaseUrl` whose backing pod was idle-reaped.
 *
 *   `2xx | 3xx`           → `'alive'`   (cold-load avoidance — no remount)
 *   `404 | 410`           → `'dead'`    (`baseProxy` returns 404 after
 *                                        `unregisterIDE`; 410 reserved for
 *                                        future "Gone" semantics)
 *   `502 | 503 | 504`     → `'dead'`    (proxy reached us but cannot reach
 *                                        upstream pod — container died
 *                                        before unregister; c0aaae16's
 *                                        5xx recovery path)
 *   other 4xx/5xx         → `'unknown'` (401/403 = JWT renewal,
 *                                        405 = method mismatch,
 *                                        500 = transient — conservative
 *                                        no-op, retry effect / next
 *                                        visibility tick handles it)
 *   network err / timeout → `'unknown'` (transient hiccup)
 *
 * GET is used (not HEAD) because openvscode-server's workbench root handler
 * is GET-only and 4xx's on HEAD. The response body is immediately
 * cancelled so we pay only for status-line + headers. Aligns with the
 * iframe onLoad probe in App.tsx so probe and load see the same contract.
 */
export async function probeIdeAlive(
  proxyUrl: string,
  timeoutMs: number = 1500,
): Promise<'alive' | 'dead' | 'unknown'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${proxyUrl}/`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
    // Drop the body — we only need the status line.
    try { await res.body?.cancel(); } catch { /* no-op */ }
    if (res.status >= 200 && res.status < 400) return 'alive';
    if (res.status === 404 || res.status === 410) return 'dead';
    if (res.status === 502 || res.status === 503 || res.status === 504) return 'dead';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForIdeReady(proxyUrl: string, timeoutMs: number = 15_000): Promise<void> {
  const start = Date.now();
  const delays = [200, 400, 800, 1200, 2000];
  let i = 0;
  const probePaths = ['/', '/favicon.ico'];
  while (Date.now() - start < timeoutMs) {
    try {
      const results = await Promise.all(
        probePaths.map(p =>
          fetch(`${proxyUrl}${p}`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }).then(r => r.status).catch(() => 0)
        )
      );
      if (results.every(s => s >= 200 && s < 500)) return;
    } catch {
      // connect error — retry
    }
    await new Promise(r => setTimeout(r, delays[Math.min(i++, delays.length - 1)]));
  }
  throw new Error('IDE pre-flight timed out');
}

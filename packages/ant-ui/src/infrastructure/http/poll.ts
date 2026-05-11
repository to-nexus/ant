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

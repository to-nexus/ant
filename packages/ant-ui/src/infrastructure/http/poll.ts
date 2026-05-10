/**
 * IDE pre-flight readiness probe.
 *
 * Polls the IDE proxy URL until it returns any HTTP status < 500. Used by
 * the `startIdeSession` store action so the iframe is only embedded after
 * openvscode-server has started serving HTTP — closes the race where the
 * BE returns the URL but the iframe `src` GETs a 500 from a still-booting
 * code-server.
 *
 * Mirrors the BE-side `waitForHttpReady` shape in shape and intent. Kept
 * separate (not unified with `useHealthCheck`) because the semantic is
 * different: this is poll-until-ready, not one-shot.
 */
export async function waitForIdeReady(proxyUrl: string, timeoutMs: number = 15_000): Promise<void> {
  const start = Date.now();
  const delays = [200, 400, 800, 1200, 2000];
  let i = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${proxyUrl}/`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      // connect error — retry
    }
    await new Promise(r => setTimeout(r, delays[Math.min(i++, delays.length - 1)]));
  }
  throw new Error('IDE pre-flight timed out');
}

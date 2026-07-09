import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PreviewService } from '../../src/periphery/adapters/http/services/PreviewService/PreviewService';

/**
 * Regression guard for the preview-connect regression (root cause: haiku commit
 * e2714ac4).
 *
 * e2714ac4 gated the preview HMR WebSocket upgrade (and, nominally, the HTTP
 * proxy) on `PreviewService.ensureReachable`, which returned null unless
 * `phase === 'running'` AND a cross-pod TCP probe succeeded — and, on a probe
 * miss, MARKED THE RUNNING PREVIEW 'stopped' in Redis. In a multi-replica
 * deployment an HMR upgrade landing on a non-owner pod could fail that probe,
 * corrupting a healthy preview to 'stopped' and destroying its HMR socket →
 * Vite's dep-reopt→full-reload recovery breaks → assets hang forever → 504.
 * Deploy was immune (self-healing, non-destructive).
 *
 * The fix restores forgiving, record-based target resolution for BOTH preview
 * paths (getPreview / label match) and bounds dead targets via the transport /
 * WS-handshake timeouts — mirroring deploy's non-destructive posture. These
 * tests lock that the destructive gate stays gone.
 */
describe('preview forgiving resolution (e2714ac4 regression guard)', () => {
  it('PreviewService no longer exposes the destructive ensureReachable gate', () => {
    // The gate that could mark a healthy preview "stopped" on a probe miss.
    expect((PreviewService.prototype as any).ensureReachable).toBeUndefined();
  });

  it('the preview WS upgrade path does not call ensureReachable / mark previews stopped', () => {
    const src = readFileSync(
      join(__dirname, '../../src/infrastructure/preview/PreviewServer.ts'),
      'utf8',
    );
    // WS upgrade must resolve targets from the record, never via the removed gate.
    expect(src).not.toMatch(/previewService\.ensureReachable/);
  });

  it('the preview HTTP proxy config no longer carries an ensureReachable hook', () => {
    const src = readFileSync(
      join(__dirname, '../../src/periphery/adapters/http/middleware/previewProxy.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/ensureReachable/);
  });
});

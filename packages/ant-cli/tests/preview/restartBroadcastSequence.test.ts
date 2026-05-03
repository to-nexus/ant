import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreviewService } from '../../src/periphery/adapters/http/services/PreviewService/PreviewService';

/**
 * Pin the restart-flow broadcast order.
 *
 * Bug under test ("Preview Config: restart button disables the cancel
 * button and the log feed goes blank"):
 *
 *   The previous forceRestart path called `stopPreview(...)`, which
 *   emitted `phase: 'stopped'` at the end. The frontend reacted by
 *   disabling the cancel button and clearing the log feed. The next
 *   `'installing'` broadcast then arrived seconds later (after the
 *   waitForCleanState polling), leaving a 5–8s "dead" window.
 *
 * Fix: stopPreview now accepts `{ suppressStoppedBroadcast: true }`. The
 * forceRestart caller passes it so the user-visible broadcast sequence
 * goes `stopping → (installing|starting|...)` continuously, with no
 * intermediate `stopped` flicker. These tests pin both directions:
 *
 *   1. Default behaviour (no flag) still emits `'stopped'`.
 *   2. With the flag, `'stopping'` is emitted but `'stopped'` is NOT.
 *
 * Stop-only callers (user clicks Stop) keep getting the final `'stopped'`
 * — only the restart path suppresses it.
 */

function makeRedisStub(running: boolean): any {
  return {
    getPreview: vi.fn(async () => running ? {
      tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat',
      running: true, ready: true, port: 3000,
      packages: [], connections: [], issues: [],
    } : null),
    unregisterPreview: vi.fn(async () => undefined),
    updatePreview: vi.fn(async () => undefined),
    listPreviews: vi.fn(async () => []),
  };
}

function makeStateStoreStub(): any {
  return {
    publish: vi.fn(async () => undefined),
    listPreviews: vi.fn(async () => []),
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => undefined),
    getPreviewConfig: vi.fn(async () => null),
  };
}

interface BroadcastedPhase { serverKey: string; phase: string }

function snapshotBroadcasts(svc: PreviewService): BroadcastedPhase[] {
  const captured: BroadcastedPhase[] = [];
  vi.spyOn(svc as any, 'broadcastStatus').mockImplementation(((sk: string, status: any) => {
    if (status?.phase) captured.push({ serverKey: sk, phase: String(status.phase) });
  }) as any);
  return captured;
}

describe('PreviewService.stopPreview — broadcast sequence', () => {
  let svc: PreviewService;
  let redis: any;
  let stateStore: any;

  beforeEach(() => {
    redis = makeRedisStub(true);
    stateStore = makeStateStoreStub();
    svc = new PreviewService(undefined, redis, undefined, stateStore);
    // Pretend infrastructure stop is a no-op so we don't touch docker.
    (svc as any).infrastructureManager = { stopInfrastructure: vi.fn(async () => undefined) };
    // No local processes — the Redis-only path is enough to exercise the
    // broadcast control flow.
    (svc as any).previewServers = new Map();
  });

  it('default stop emits "stopping" then "stopped"', async () => {
    const phases = snapshotBroadcasts(svc);
    await svc.stopPreview('org', 'user', 'proj', 'feat');
    const seq = phases.map(p => p.phase);
    // Order matters and 'stopped' is the terminal phase.
    expect(seq).toContain('stopping');
    expect(seq).toContain('stopped');
    expect(seq.indexOf('stopping')).toBeLessThan(seq.indexOf('stopped'));
    expect(seq[seq.length - 1]).toBe('stopped');
  });

  it('suppressStoppedBroadcast: true emits "stopping" but NOT "stopped"', async () => {
    const phases = snapshotBroadcasts(svc);
    await svc.stopPreview('org', 'user', 'proj', 'feat', { suppressStoppedBroadcast: true });
    const seq = phases.map(p => p.phase);
    // The intermediate UX signal stays — restart should still show the
    // loading state. Only the terminal 'stopped' is withheld so the
    // forceRestart caller can paint 'installing' without a flicker.
    expect(seq).toContain('stopping');
    expect(seq).not.toContain('stopped');
  });

  it('restart-shaped sequence: caller can chain stop+start without "stopped" flicker', async () => {
    // Manually emulate what startPreview(forceRestart=true) does inside
    // its previewServers.has-true branch: stop with suppress, then call
    // updatePhase('installing'). updatePhase reads Redis state for the
    // broadcast payload, so we pre-fix the registry to return a "starting"-ish
    // record after stop completes.
    const phases = snapshotBroadcasts(svc);
    await svc.stopPreview('org', 'user', 'proj', 'feat', { suppressStoppedBroadcast: true });
    redis.getPreview = vi.fn(async () => ({
      tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat',
      running: true, ready: false, phase: 'installing', packages: [], connections: [], issues: [],
    }));
    await (svc as any).updatePhase('org:user:proj:feat', 'installing');

    const seq = phases.map(p => p.phase);
    // No intermediate 'stopped'.
    expect(seq).not.toContain('stopped');
    // 'stopping' precedes 'installing'.
    const stoppingIdx = seq.indexOf('stopping');
    const installingIdx = seq.indexOf('installing');
    expect(stoppingIdx).toBeGreaterThanOrEqual(0);
    expect(installingIdx).toBeGreaterThan(stoppingIdx);
  });
});

/**
 * Locks `mergeDetectedWithSaved` — the anti-clobber merge that protects panel
 * edits (category / resolution) from being discarded when a post-code-job
 * `CONNECTIONS_REFRESH` re-detects connections from `.env.example` and saves.
 *
 * Without it, `refreshProjectConnections` full-overwrote the Redis preview
 * config with fresh detection, silently losing any panel edit the user had not
 * yet persisted to `.env.example` via the Fix button.
 */

import { describe, it, expect } from 'vitest';
import { mergeDetectedWithSaved } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/mergeUserEdits';
import type { ServiceConnection } from '../../src/core/ports/portRegistry';

const conn = (over: Partial<ServiceConnection> = {}): ServiceConnection => ({
  id: 'backend-api',
  name: 'backend-api',
  category: 'business',
  envVar: 'API_BASE_URL',
  value: '',
  resolution: { type: 'url', url: '' },
  source: '*',
  ...over,
});

describe('mergeDetectedWithSaved', () => {
  it('preserves a userModified saved connection over fresh detection', () => {
    const detected = [conn({ category: 'business', resolution: { type: 'url', url: '' }, status: 'active' })];
    const saved = [conn({
      category: 'infrastructure',
      resolution: { type: 'docker', service: 'api' },
      userModified: true,
    })];

    const [merged] = mergeDetectedWithSaved(detected, saved);
    // User's category/resolution win...
    expect(merged.category).toBe('infrastructure');
    expect(merged.resolution).toEqual({ type: 'docker', service: 'api' });
    expect(merged.userModified).toBe(true);
    // ...but the fresh runtime status is adopted.
    expect(merged.status).toBe('active');
  });

  it('clears userModified once the source (.env.example) catches up to the edit', () => {
    // User changed A to infrastructure/docker (saved, userModified) and the code
    // job has now written that into .env.example, so detection produces the same.
    const detected = [conn({
      category: 'infrastructure',
      resolution: { type: 'docker', service: 'api' },
      status: 'active',
    })];
    const saved = [conn({
      category: 'infrastructure',
      resolution: { type: 'docker', service: 'api' },
      userModified: true,
    })];
    const [merged] = mergeDetectedWithSaved(detected, saved);
    expect(merged.category).toBe('infrastructure');
    expect(merged.userModified).toBeUndefined(); // badge clears
  });

  it('uses fresh detection when the saved twin is NOT userModified', () => {
    const detected = [conn({ category: 'business', value: 'https://new' })];
    const saved = [conn({ category: 'infrastructure', value: 'https://old' })]; // no userModified
    const [merged] = mergeDetectedWithSaved(detected, saved);
    expect(merged.category).toBe('business');
    expect(merged.value).toBe('https://new');
  });

  it('drops a detected connection that the user never touched and is gone from source', () => {
    const detected: ServiceConnection[] = []; // source no longer declares it
    const saved = [conn()]; // not userModified
    expect(mergeDetectedWithSaved(detected, saved)).toEqual([]);
  });

  it('preserves a userModified connection the detector cannot see (user-added)', () => {
    const detected: ServiceConnection[] = [];
    const saved = [conn({ id: 'custom', name: 'custom', userModified: true })];
    const merged = mergeDetectedWithSaved(detected, saved);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('custom');
  });

  it('adds newly detected connections', () => {
    const detected = [conn(), conn({ id: 'new', name: 'new' })];
    const saved = [conn({ userModified: true })];
    const ids = mergeDetectedWithSaved(detected, saved).map(c => c.id).sort();
    expect(ids).toEqual(['backend-api', 'new']);
  });

  it('does not special-case the mock toggle — detection-side virtualization.active survives for untouched connections', () => {
    const detected = [conn({ virtualization: { toggleEnvVar: 'USE_MOCK_BACKEND_API', active: true } })];
    const saved = [conn({ virtualization: { toggleEnvVar: 'USE_MOCK_BACKEND_API', active: false } })]; // stale, not userModified
    const [merged] = mergeDetectedWithSaved(detected, saved);
    expect(merged.virtualization?.active).toBe(true);
  });
});

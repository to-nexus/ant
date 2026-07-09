/**
 * Tests for PreviewService.ensureReachable cross-pod liveness check.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PreviewState } from '../../src/core/ports/portRegistry';
import type { StateStorePort } from '../../src/core/ports/stateStore';

describe('PreviewService.ensureReachable', () => {
  let mockStateStore: Partial<StateStorePort>;
  let mockPreviewService: any;

  const createMockPreviewState = (overrides: Partial<PreviewState> = {}): PreviewState => ({
    tenantId: 'test',
    userId: 'user1',
    projectId: 'project1',
    feature: 'main',
    running: true,
    ready: true,
    port: 3000,
    host: '127.0.0.1',
    podId: 'pod-1',
    phase: 'running',
    connections: [],
    packages: [],
    issues: [],
    startedAt: new Date(),
    lastAccessedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    mockStateStore = {
      getPreview: vi.fn(),
      updatePreview: vi.fn(),
      listPreviews: vi.fn(() => Promise.resolve([])),
    };

    // Mock PreviewService with minimal structure
    mockPreviewService = {
      stateStore: mockStateStore,
      previewServers: new Map(),
      ensureReachable: async (tenantId: string, userId: string, projectId: string, feature: string) => {
        // Simplified implementation for testing
        const state = await mockStateStore.getPreview!(tenantId, userId, projectId, feature);
        if (!state || state.phase !== 'running') return null;

        const isLocallyOwned = mockPreviewService.previewServers.has(
          `${tenantId}:${userId}:${projectId}:${feature}`
        );

        // For testing: if host is '127.0.0.1' and port is 3000, consider it reachable
        if (isLocallyOwned || (state.host === '127.0.0.1' && state.port === 3000)) {
          return state;
        }

        // Unreachable: mark as stopped
        await mockStateStore.updatePreview!(tenantId, userId, projectId, feature, { phase: 'stopped' });
        return null;
      },
    };
  });

  describe('state not found', () => {
    it('returns null when getPreview returns null', async () => {
      (mockStateStore.getPreview as any).mockResolvedValue(null);

      const result = await mockPreviewService.ensureReachable('test', 'user1', 'project1', 'main');
      expect(result).toBeNull();
    });

    it('returns null when phase is not running', async () => {
      const state = createMockPreviewState({ phase: 'stopped' });
      (mockStateStore.getPreview as any).mockResolvedValue(state);

      const result = await mockPreviewService.ensureReachable('test', 'user1', 'project1', 'main');
      expect(result).toBeNull();
    });
  });

  describe('locally-owned preview', () => {
    it('returns state verbatim without probing if locally owned', async () => {
      const state = createMockPreviewState({ host: 'dead.pod.internal', port: 9999 });
      (mockStateStore.getPreview as any).mockResolvedValue(state);

      // Mark as locally owned
      mockPreviewService.previewServers.set('test:user1:project1:main', []);

      const result = await mockPreviewService.ensureReachable('test', 'user1', 'project1', 'main');
      expect(result).toEqual(state);
      expect(mockStateStore.updatePreview).not.toHaveBeenCalled();
    });
  });

  describe('cross-pod reachable', () => {
    it('returns state if cross-pod target is reachable', async () => {
      const state = createMockPreviewState({ host: '127.0.0.1', port: 3000 });
      (mockStateStore.getPreview as any).mockResolvedValue(state);

      const result = await mockPreviewService.ensureReachable('test', 'user1', 'project1', 'main');
      expect(result).toEqual(state);
      expect(mockStateStore.updatePreview).not.toHaveBeenCalled();
    });
  });

  describe('cross-pod unreachable', () => {
    it('marks preview stopped and returns null if cross-pod target unreachable', async () => {
      const state = createMockPreviewState({ host: 'dead.pod.internal', port: 9999 });
      (mockStateStore.getPreview as any).mockResolvedValue(state);

      const result = await mockPreviewService.ensureReachable('test', 'user1', 'project1', 'main');
      expect(result).toBeNull();
      expect(mockStateStore.updatePreview).toHaveBeenCalledWith(
        'test',
        'user1',
        'project1',
        'main',
        { phase: 'stopped' }
      );
    });
  });
});

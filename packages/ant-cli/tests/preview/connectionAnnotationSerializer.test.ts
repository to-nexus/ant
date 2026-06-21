/**
 * Locks the `@connection` annotation serializer — the deterministic write side
 * of the grammar (panel Save → `.env.example`), symmetric with the parser.
 * `parse ∘ serialize === identity` is the core invariant.
 */

import { describe, it, expect } from 'vitest';
import {
  parseAnnotationLine,
  serializeAnnotationLine,
  resolutionToModifier,
} from '../../src/core/prompt/builder/serviceVirtualization/connectionModel';
import type { ConnectionResolution } from '../../src/core/ports/portRegistry';

describe('resolutionToModifier', () => {
  it('self', () => {
    expect(resolutionToModifier({ type: 'ant-project', projectId: 'self', feature: 'self' })).toBe('self');
  });
  it('ant-project p:f', () => {
    expect(resolutionToModifier({ type: 'ant-project', projectId: 'be', feature: 'main' })).toBe('ant-project:be:main');
  });
  it('ant-project p:f:svc', () => {
    expect(
      resolutionToModifier({ type: 'ant-project', projectId: 'be', feature: 'main', serviceName: 'api' }),
    ).toBe('ant-project:be:main:api');
  });
  it('url → empty', () => {
    expect(resolutionToModifier({ type: 'url', url: 'https://x' })).toBe('');
  });
  it('docker → empty (no annotation token)', () => {
    expect(resolutionToModifier({ type: 'docker', service: 'pg' })).toBe('');
  });
});

describe('serializeAnnotationLine', () => {
  it('no modifier', () => {
    expect(serializeAnnotationLine('business', 'stripe-api', '')).toBe('# @connection business stripe-api');
  });
  it('with modifier', () => {
    expect(serializeAnnotationLine('business', 'backend-api', 'self')).toBe('# @connection business backend-api self');
  });
});

describe('round-trip: parse ∘ serialize === identity', () => {
  const cases: Array<{ category: 'business' | 'infrastructure'; name: string; resolution: ConnectionResolution }> = [
    { category: 'business', name: 'backend-api', resolution: { type: 'ant-project', projectId: 'self', feature: 'self' } },
    { category: 'business', name: 'stats-api', resolution: { type: 'ant-project', projectId: 'be', feature: 'main', serviceName: 'stats' } },
    { category: 'business', name: 'stripe-api', resolution: { type: 'url', url: '' } },
    { category: 'infrastructure', name: 'postgres', resolution: { type: 'url', url: '' } },
  ];

  for (const c of cases) {
    it(`${c.name} / ${c.resolution.type}`, () => {
      const mod = resolutionToModifier(c.resolution);
      const line = serializeAnnotationLine(c.category, c.name, mod);
      const parsed = parseAnnotationLine(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.category).toBe(c.category);
      expect(parsed!.name).toBe(c.name);
      expect(parsed!.modifier ?? '').toBe(mod);
    });
  }
});

/**
 * Locks `observedFactsPatch` — what the post-code-job refresh and the two read
 * endpoints are allowed to write back into the derived caches.
 *
 * Only OBSERVED (manifest) facts may be persisted. Promoting a `techtier-hint`
 * into the same slot would make the next read rank a guess as authoritative, so
 * the authority inversion would reappear out of storage even after the in-memory
 * ranking was fixed. The three write sites (`refreshProjectFacts` →
 * `savePreviewConfig` / `updatePreview`, and `GET /preview-config`) share this
 * one helper so they cannot diverge.
 */

import { describe, it, expect } from 'vitest';
import type { ProjectProfile } from '@ant/shared';
import { observedFactsPatch } from '../../src/periphery/adapters/http/services/PreviewService/utils/projectFacts';
import type { DetectedProjectFacts } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ProjectProfileDetector';

const facts = (profile: ProjectProfile): DetectedProjectFacts => ({
  structureType: profile.structureType ?? 'backend-only',
  profile,
  canStart: true,
});

describe('observedFactsPatch', () => {
  it('persists a manifest-derived profile together with its structureType', () => {
    const profile: ProjectProfile = {
      language: 'typescript',
      framework: 'nestjs',
      structureType: 'backend-only',
      source: 'manifest',
    };
    expect(observedFactsPatch(facts(profile))).toEqual({
      projectProfile: profile,
      structureType: 'backend-only',
    });
  });

  it('writes NOTHING for a hint — a guess never lands in the manifest slot', () => {
    const hint: ProjectProfile = {
      language: 'typescript',
      framework: 'nextjs',
      structureType: 'fullstack',
      source: 'techtier-hint',
    };
    expect(observedFactsPatch(facts(hint))).toEqual({});
  });

  it('writes nothing when detection produced no facts at all', () => {
    expect(observedFactsPatch(null)).toEqual({});
    expect(observedFactsPatch(undefined)).toEqual({});
  });

  it('spreads into a connections patch without disturbing it', () => {
    const connections: never[] = [];
    const hint = facts({ language: 'typescript', source: 'techtier-hint' });
    expect({ connections, ...observedFactsPatch(hint) }).toEqual({ connections });

    const observed = facts({ language: 'go', framework: 'gin', structureType: 'backend-only', source: 'manifest' });
    expect({ connections, ...observedFactsPatch(observed) }).toMatchObject({
      connections,
      structureType: 'backend-only',
    });
  });
});

/**
 * Artifact-glob builder model — the raw ⇄ segments round-trip the hook editor
 * runs on, the natural-language description truth table, and the guarantee
 * that every offered preset passes the shared validator.
 */

import { describe, it, expect } from 'vitest';
import { validateStopHookEntry } from '@ant/shared';
import {
  GLOB_PRESETS,
  composeGlob,
  describeGlob,
  isSegmentValid,
  parseGlob,
} from '../../src/presentation/components/AgentSettings/overview/globBuilder';

describe('parseGlob ⇄ composeGlob', () => {
  it.each([
    ['reports/*-weekly.md'],
    ['output/**'],
    ['**'],
    ['*'],
    ['docs/*.md'],
    ['a/b/c.txt'],
    // Degenerate raws still round-trip byte-identically (they render red, never mangled).
    [''],
    ['trailing/'],
    ['/leading'],
    ['weird//double'],
    ['a**b/x.md'],
  ])('round-trips %j', (raw) => {
    expect(composeGlob(parseGlob(raw))).toBe(raw);
  });

  it('classifies segments', () => {
    expect(parseGlob('reports/**/*-weekly.md')).toEqual([
      { kind: 'pattern', text: 'reports' },
      { kind: 'globstar' },
      { kind: 'pattern', text: '*-weekly.md' },
    ]);
    expect(parseGlob('*/x')).toEqual([{ kind: 'any' }, { kind: 'pattern', text: 'x' }]);
  });
});

describe('isSegmentValid (per-chip slice of H3/H5)', () => {
  it.each([
    [{ kind: 'globstar' } as const, true],
    [{ kind: 'any' } as const, true],
    [{ kind: 'pattern', text: 'reports' } as const, true],
    [{ kind: 'pattern', text: '*-weekly.md' } as const, true],
    [{ kind: 'pattern', text: '' } as const, false],
    [{ kind: 'pattern', text: '..' } as const, false],
    [{ kind: 'pattern', text: 'a**b' } as const, false],
    [{ kind: 'pattern', text: '{week}' } as const, false],
  ])('%j → %s', (segment, expected) => {
    expect(isSegmentValid(segment)).toBe(expected);
  });
});

describe('describeGlob truth table', () => {
  it.each([
    ['', { kind: 'empty' }],
    ['**', { kind: 'any-file-anywhere' }],
    [
      'reports/*-weekly.md',
      { kind: 'located', dirs: [{ kind: 'literal', name: 'reports' }], file: { kind: 'ends-with', suffix: '-weekly.md' } },
    ],
    ['output/**', { kind: 'located', dirs: [{ kind: 'literal', name: 'output' }], file: { kind: 'any-depth' } }],
    ['docs/*.md', { kind: 'located', dirs: [{ kind: 'literal', name: 'docs' }], file: { kind: 'ends-with', suffix: '.md' } }],
    ['plan.md', { kind: 'located', dirs: [], file: { kind: 'exact', name: 'plan.md' } }],
    ['out/*', { kind: 'located', dirs: [{ kind: 'literal', name: 'out' }], file: { kind: 'any-name' } }],
    [
      'a/**/draft-*',
      {
        kind: 'located',
        dirs: [{ kind: 'literal', name: 'a' }, { kind: 'globstar' }],
        file: { kind: 'starts-with', prefix: 'draft-' },
      },
    ],
    [
      '*/w-*-x.md',
      { kind: 'located', dirs: [{ kind: 'any' }], file: { kind: 'starts-ends', prefix: 'w-', suffix: '-x.md' } },
    ],
    ['a*b*c', { kind: 'located', dirs: [], file: { kind: 'matching', pattern: 'a*b*c' } }],
  ] as const)('%j', (raw, expected) => {
    expect(describeGlob(raw)).toEqual(expected);
  });
});

describe('presets', () => {
  it.each(GLOB_PRESETS.map((p) => [p] as const))('%s passes the shared validator', (preset) => {
    expect(validateStopHookEntry({ artifact: preset }).error).toBeUndefined();
  });
});

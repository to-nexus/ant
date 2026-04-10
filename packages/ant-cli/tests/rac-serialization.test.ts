/**
 * Task 2: RAC Serialization Roundtrip Tests
 *
 * Validates that ResolvedActionContext survives JSON.stringify → JSON.parse
 * without field loss, type mutation, or content corruption.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFromExplicit,
  resolveFromInfer,
} from '@ant/shared';
import type {
  ResolvedActionContext,
  ActionMetadata,
  DetectionReport,
  ResolvedDocument,
} from '@ant/shared';

function roundtrip<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fullExplicitMetadata: ActionMetadata = {
  intent: 'create-frontend',
  basis: 'prd',
  target: ['src/components/Button.tsx', 'src/pages/Home.tsx'],
  refs: ['docs/design.md'],
  context: ['Use TailwindCSS for styling'],
};

const baseReport: DetectionReport = {
  environment: 'frontend',
  jobMode: 'generate',
  profile: { language: 'TypeScript', framework: 'React' },
} as DetectionReport;

// ---------------------------------------------------------------------------
// 1. Explicit RAC with full fields
// ---------------------------------------------------------------------------

describe('RAC serialization roundtrip', () => {
  it('explicit RAC with all fields survives roundtrip', () => {
    const original = resolveFromExplicit(fullExplicitMetadata, { language: 'TypeScript', framework: 'React' });
    original.documents = [
      { path: 'design.md', content: 'Design spec content', role: 'ref', label: 'Design Spec' },
      { path: 'prd.md', content: 'PRD content here', role: 'context', label: 'PRD' },
    ];

    const restored = roundtrip(original);
    expect(restored).toEqual(original);

    expect(restored.intent).toBe(original.intent);
    expect(restored.source).toBe('explicit');
    expect(restored.hasExplicitFields).toBe(true);
    expect(restored.tech.language).toBe(original.tech.language);
    expect(restored.documents).toHaveLength(2);
    expect(restored.documents![0].content).toBe('Design spec content');
  });

  // ---------------------------------------------------------------------------
  // 2. Infer RAC with minimal fields
  // ---------------------------------------------------------------------------

  it('infer RAC with minimal fields survives roundtrip', () => {
    const original = resolveFromInfer(baseReport);

    const restored = roundtrip(original);
    expect(restored).toEqual(original);

    expect(restored.source).toBe('infer');
    expect(restored.jobMode).toBe('generate');
    expect(restored.tech).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 3. Documents with special characters
  // ---------------------------------------------------------------------------

  it('documents with special chars survive roundtrip', () => {
    const original = resolveFromExplicit(fullExplicitMetadata);
    original.documents = [
      {
        path: 'special.md',
        content: [
          'Line with newlines\nand\ttabs',
          '```typescript',
          'const x = "hello";',
          '```',
          'Unicode: 한국어 テスト 🚀',
          'Backticks: `inline code` and ``` triple ```',
          'Backslashes: C:\\Users\\path\\file.ts',
          'Quotes: "double" and \'single\'',
          'Null char: before\x00after',
        ].join('\n'),
        role: 'ref' as const,
      },
    ];

    const restored = roundtrip(original);
    expect(restored.documents![0].content).toBe(original.documents![0].content);
  });

  // ---------------------------------------------------------------------------
  // 4. Undefined fields: key disappears but never becomes null
  // ---------------------------------------------------------------------------

  it('undefined fields disappear but never become null', () => {
    const original = resolveFromInfer(baseReport);

    expect(original.intent).toBeUndefined();
    expect(original.target).toBeUndefined();
    expect(original.basis).toBeUndefined();
    expect(original.refs).toBeUndefined();
    expect(original.context).toBeUndefined();
    expect(original.documents).toBeUndefined();
    expect(original.intentDescription).toBeUndefined();

    const restored = roundtrip(original);

    expect(restored.intent).toBeUndefined();
    expect(restored.target).toBeUndefined();
    expect(restored.basis).toBeUndefined();
    expect(restored.refs).toBeUndefined();
    expect(restored.context).toBeUndefined();
    expect(restored.documents).toBeUndefined();
    expect(restored.intentDescription).toBeUndefined();

    for (const [key, value] of Object.entries(restored)) {
      expect(value).not.toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Deep equality: no extra or missing keys
  // ---------------------------------------------------------------------------

  it('roundtrip preserves defined keys, drops undefined keys (no null ghosts)', () => {
    const original = resolveFromExplicit(fullExplicitMetadata, { language: 'TypeScript' });
    const restored = roundtrip(original);

    const definedKeys = Object.entries(original)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k)
      .sort();
    const restoredKeys = Object.keys(restored).sort();
    expect(restoredKeys).toEqual(definedKeys);

    for (const value of Object.values(restored)) {
      expect(value).not.toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Empty documents array survives
  // ---------------------------------------------------------------------------

  it('empty documents array survives roundtrip', () => {
    const original = resolveFromExplicit(fullExplicitMetadata);
    original.documents = [];

    const restored = roundtrip(original);
    expect(restored.documents).toEqual([]);
    expect(Array.isArray(restored.documents)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 7. Large content survives
  // ---------------------------------------------------------------------------

  it('large document content survives roundtrip', () => {
    const largeContent = 'A'.repeat(500_000);
    const original = resolveFromInfer(baseReport);
    (original as any).documents = [
      { path: 'large.md', content: largeContent, role: 'context' },
    ];

    const restored = roundtrip(original);
    expect(restored.documents![0].content).toBe(largeContent);
    expect(restored.documents![0].content.length).toBe(500_000);
  });
});

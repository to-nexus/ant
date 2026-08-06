/**
 * Spec doc single-root invariant — unit tests for the completion-time
 * self-heal guard (plan spec-design-reflective-fox, Axis 3).
 *
 * Live incident: a rev-spec (refactor mode) run appended a full re-authored
 * document below the original via <append>, leaving TWO complete spec
 * documents (contradictory in one case) in one file that the code job then
 * consumed as a single authoritative ref. The guard keeps the LAST root
 * (refactor's contract is "output the FULL modified document") and flags —
 * without destroying — anything it cannot prove is a full document.
 */

import { describe, it, expect } from 'vitest';
import {
  healDuplicateSpecRoots,
  isSpecDocTask,
  isRevisableDesignDocTask,
  extractMarkdownHeadings,
  evaluateRevisionPreservation,
  reconcileSpecDoc,
  buildSpecRevisionRetryMessage,
} from '../../src/agents/architect/graph/design/nodes/checkTaskStatus/specDocIntegrity';

const DOC_A = `# Spec: Wallet Login

## Overview

Old revision body.

## Acceptance Criteria

1. Old criterion.
`;

const DOC_B = `# Spec: Wallet Login

## Overview

New revision body with the responsive table.

## Acceptance Criteria

1. New criterion.
`;

describe('healDuplicateSpecRoots', () => {
  it('single root → none', () => {
    const r = healDuplicateSpecRoots(DOC_A);
    expect(r.action).toBe('none');
    expect(r.rootCount).toBe(1);
  });

  it('two concatenated documents → healed to the LAST full document', () => {
    const r = healDuplicateSpecRoots(DOC_A + '\n' + DOC_B);
    expect(r.action).toBe('healed');
    expect(r.rootCount).toBe(2);
    expect(r.healed).toContain('New revision body');
    expect(r.healed).not.toContain('Old revision body');
    expect(r.healed!.startsWith('# Spec: Wallet Login')).toBe(true);
  });

  it('preserves YAML frontmatter (consumed markers) on heal', () => {
    const fm = '---\nant:\n  status: consumed\n  consumedBy: some-job\n---\n';
    const r = healDuplicateSpecRoots(fm + DOC_A + '\n' + DOC_B);
    expect(r.action).toBe('healed');
    expect(r.healed!.startsWith('---\nant:')).toBe(true);
    expect(r.healed).toContain('New revision body');
    expect(r.healed).not.toContain('Old revision body');
  });

  it('ignores `# ` lines inside fenced code blocks', () => {
    const withFence = `# Spec: Only Root

## Setup

\`\`\`bash
# this is a shell comment, not a heading
echo hi
\`\`\`
`;
    const r = healDuplicateSpecRoots(withFence);
    expect(r.action).toBe('none');
    expect(r.rootCount).toBe(1);
  });

  it('flags (does not destroy) when the last segment is not a full document', () => {
    const addendum = '# Addendum note\n\njust one paragraph, no sections\n';
    const r = healDuplicateSpecRoots(DOC_A + '\n' + addendum);
    expect(r.action).toBe('flagged');
    expect(r.rootCount).toBe(2);
    expect(r.healed).toBeUndefined();
  });
});

describe('isSpecDocTask', () => {
  it('true for explicit architecture/spec targetDir (current prefix-less naming)', () => {
    expect(isSpecDocTask({ targetDir: 'architecture/spec', targetFile: 'landing-page.md' })).toBe(true);
  });

  it('true for legacy spec- prefixed file without targetDir (designDirOf fallback)', () => {
    expect(isSpecDocTask({ targetFile: 'spec-wallet-login.md' })).toBe(true);
  });

  it('false for system-design / ui docs and missing targetFile', () => {
    expect(isSpecDocTask({ targetDir: 'architecture/system', targetFile: 'fe-system-main.md' })).toBe(false);
    expect(isSpecDocTask({ targetFile: 'ui-spec.json', targetDir: 'visual/ui/ant' })).toBe(false);
    expect(isSpecDocTask(undefined)).toBe(false);
    expect(isSpecDocTask({})).toBe(false);
  });
});

describe('isRevisableDesignDocTask', () => {
  it('true for spec and system markdown docs', () => {
    expect(isRevisableDesignDocTask({ targetDir: 'architecture/spec', targetFile: 'landing.md' })).toBe(true);
    expect(isRevisableDesignDocTask({ targetDir: 'architecture/system', targetFile: 'fe-system-main.md' })).toBe(true);
  });

  it('false for JSON artifacts and other dirs', () => {
    expect(isRevisableDesignDocTask({ targetDir: 'visual/ui/ant', targetFile: 'ui-spec.json' })).toBe(false);
    expect(isRevisableDesignDocTask({ targetDir: 'architecture/system', targetFile: 'api.json' })).toBe(false);
    expect(isRevisableDesignDocTask({ targetDir: 'plan', targetFile: 'prd.md' })).toBe(false);
    expect(isRevisableDesignDocTask(undefined)).toBe(false);
  });
});

describe('extractMarkdownHeadings', () => {
  it('collects # and ## headings, skips fences and frontmatter', () => {
    const doc = `---
ant:
  status: draft
---
# Spec: Title

## Overview

\`\`\`bash
# not a heading
## also not
\`\`\`

## Acceptance Criteria

### h3 ignored
`;
    expect(extractMarkdownHeadings(doc)).toEqual([
      { level: 1, text: 'Spec: Title' },
      { level: 2, text: 'Overview' },
      { level: 2, text: 'Acceptance Criteria' },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Revision preservation gate (refactor mode)
// ─────────────────────────────────────────────────────────────

const ORIGINAL_SPEC = `# Spec: Game Defect Refactor

## 1. Overview & Defect Catalog

Six defects.

## 2. Root Cause Analysis

Deep dive.

## 3. HP HUD Rendering

The HUD to be removed.

## 4. Acceptance Criteria

1. Criterion.
`;

const NARROW_REWRITE = `# Spec: Unit HP HUD Complete Removal

## Removal Scope

Only about the HUD.

## Acceptance Criteria

1. HUD gone.
`;

const FAITHFUL_REVISION = `# Spec: Game Defect Refactor

## 1. Overview & Defect Catalog

Six defects, HUD removal folded in.

## 2. Root Cause Analysis

Deep dive.

## 4. Acceptance Criteria

1. Criterion.
`;

const BASELINE = [
  '1. Overview & Defect Catalog',
  '2. Root Cause Analysis',
  '3. HP HUD Rendering',
  '4. Acceptance Criteria',
];

describe('evaluateRevisionPreservation', () => {
  it('passes when every baseline section survives (numbering-insensitive)', () => {
    const r = evaluateRevisionPreservation({
      baselineHeadings: ['Overview & Defect Catalog', '2. Root Cause Analysis'],
      candidate: FAITHFUL_REVISION,
    });
    expect(r.ok).toBe(true);
  });

  it('Directive Q&A is ephemeral — removal always sanctioned without plan/directive mention', () => {
    const r = evaluateRevisionPreservation({
      baselineHeadings: ['Overview & Defect Catalog', '2. Root Cause Analysis', 'Directive Q&A'],
      candidate: FAITHFUL_REVISION,
    });
    expect(r.ok).toBe(true);
  });

  it('violates when sections vanish without sanction', () => {
    const r = evaluateRevisionPreservation({
      baselineHeadings: BASELINE,
      candidate: NARROW_REWRITE,
      directive: '유닛 hp hud는 필요없다. 완전 제거하도록 해라.',
    });
    expect(r.ok).toBe(false);
    expect(r.violation?.isRetryable).toBe(true);
    expect(r.violation?.missingHeadings).toEqual([
      '1. Overview & Defect Catalog',
      '2. Root Cause Analysis',
      '3. HP HUD Rendering',
    ]);
  });

  it('plan disposition "remove" sanctions the removal', () => {
    const planText = JSON.stringify({
      documentOutline: [
        { section: 'Overview & Defect Catalog', disposition: 'modify' },
        { section: 'HP HUD Rendering', disposition: 'remove' },
      ],
    });
    const r = evaluateRevisionPreservation({
      baselineHeadings: BASELINE,
      candidate: FAITHFUL_REVISION,
      planText,
    });
    expect(r.ok).toBe(true);
  });

  it('directive mention sanctions removal when plan is unparseable', () => {
    const r = evaluateRevisionPreservation({
      baselineHeadings: BASELINE,
      candidate: FAITHFUL_REVISION,
      planText: 'not json {',
      directive: 'Remove the HP HUD Rendering section entirely.',
    });
    expect(r.ok).toBe(true);
  });

  it('empty baseline passes trivially', () => {
    expect(evaluateRevisionPreservation({ baselineHeadings: [], candidate: NARROW_REWRITE }).ok).toBe(true);
  });
});

function memFs(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  return {
    store,
    readFile: async (p: string) => {
      const c = store.get(p);
      if (c === undefined) throw new Error(`ENOENT ${p}`);
      return c;
    },
    writeFile: async (p: string, c: string) => {
      store.set(p, c);
    },
  };
}

const TASK = { targetDir: 'architecture/spec', targetFile: 'game-defect-refactor.md' };
const FILE = '/ws/architecture/spec/game-defect-refactor.md';

describe('reconcileSpecDoc — refactor mode', () => {
  it('append(original + narrow rewrite) → rolls back to original + retryable violation', async () => {
    const fs = memFs({ [FILE]: ORIGINAL_SPEC + '\n' + NARROW_REWRITE });
    const r = await reconcileSpecDoc(fs, '/ws', TASK, 'refactor', { logPrefix: 'test' });
    expect(r.action).toBe('rolled-back');
    expect(r.violation?.isRetryable).toBe(true);
    expect(r.violation?.missingHeadings).toContain('2. Root Cause Analysis');
    expect(fs.store.get(FILE)).toContain('## 2. Root Cause Analysis');
    expect(fs.store.get(FILE)).not.toContain('Removal Scope');
  });

  it('append(original + faithful revision) → candidate replaces the file', async () => {
    const planText = JSON.stringify({
      documentOutline: [{ section: 'HP HUD Rendering', disposition: 'remove' }],
    });
    const fs = memFs({ [FILE]: ORIGINAL_SPEC + '\n' + FAITHFUL_REVISION });
    const r = await reconcileSpecDoc(fs, '/ws', TASK, 'refactor', { logPrefix: 'test', planText });
    expect(r.action).toBe('replaced');
    const final = fs.store.get(FILE)!;
    expect(final).toContain('HUD removal folded in');
    expect(final).not.toContain('The HUD to be removed');
    expect(final.match(/^# /gm)!.length).toBe(1);
  });

  it('preserves frontmatter across rollback and replace', async () => {
    const fm = '---\nant:\n  status: consumed\n---\n';
    const fs = memFs({ [FILE]: fm + ORIGINAL_SPEC + '\n' + NARROW_REWRITE });
    const r = await reconcileSpecDoc(fs, '/ws', TASK, 'refactor', { logPrefix: 'test' });
    expect(r.action).toBe('rolled-back');
    expect(fs.store.get(FILE)!.startsWith('---\nant:')).toBe(true);
  });

  it('single root + baseline from task → flags without violation (no recoverable original)', async () => {
    const fs = memFs({ [FILE]: NARROW_REWRITE });
    const r = await reconcileSpecDoc(
      fs,
      '/ws',
      { ...TASK, revisionBaselineHeadings: BASELINE },
      'refactor',
      { logPrefix: 'test', directive: 'remove hp hud' },
    );
    expect(r.action).toBe('flagged');
    expect(r.violation).toBeUndefined();
    expect(fs.store.get(FILE)).toBe(NARROW_REWRITE);
  });

  it('single root, faithful in-place revision → none (nothing to reconcile)', async () => {
    const fs = memFs({ [FILE]: FAITHFUL_REVISION });
    const r = await reconcileSpecDoc(
      fs,
      '/ws',
      { ...TASK, revisionBaselineHeadings: ['Overview & Defect Catalog', 'Root Cause Analysis'] },
      'refactor',
      { logPrefix: 'test' },
    );
    expect(r.action).toBe('none');
  });

  it('covers system-design markdown docs in refactor mode', async () => {
    const sysFile = '/ws/architecture/system/fe-system-main.md';
    const sysOriginal = '# System: FE\n\n## Ports\n\nport list.\n\n## Partitions\n\npartition list.\n';
    const sysNarrow = '# System: FE\n\n## Ports\n\nonly ports now.\n';
    const fs = memFs({ [sysFile]: sysOriginal + '\n' + sysNarrow });
    const r = await reconcileSpecDoc(
      fs,
      '/ws',
      { targetDir: 'architecture/system', targetFile: 'fe-system-main.md' },
      'refactor',
      { logPrefix: 'test' },
    );
    expect(r.action).toBe('rolled-back');
    expect(r.violation?.missingHeadings).toEqual(['Partitions']);
  });

  it('generate mode keeps heal semantics and ignores system docs', async () => {
    const fs = memFs({ [FILE]: DOC_A + '\n' + DOC_B });
    const r = await reconcileSpecDoc(fs, '/ws', TASK, 'generate', { logPrefix: 'test' });
    expect(r.action).toBe('healed');
    expect(fs.store.get(FILE)).toContain('New revision body');

    const sysFile = '/ws/architecture/system/fe-system-main.md';
    const fs2 = memFs({ [sysFile]: DOC_A + '\n' + DOC_B });
    const r2 = await reconcileSpecDoc(
      fs2,
      '/ws',
      { targetDir: 'architecture/system', targetFile: 'fe-system-main.md' },
      'generate',
      { logPrefix: 'test' },
    );
    expect(r2.action).toBe('none');
    expect(fs2.store.get(sysFile)).toBe(DOC_A + '\n' + DOC_B);
  });

  it('missing file → none', async () => {
    const fs = memFs({});
    const r = await reconcileSpecDoc(fs, '/ws', TASK, 'refactor', { logPrefix: 'test' });
    expect(r.action).toBe('none');
  });
});

describe('buildSpecRevisionRetryMessage', () => {
  it('names dropped sections and the restored-original contract', () => {
    const msg = buildSpecRevisionRetryMessage(['2. Root Cause Analysis'], 'game-defect-refactor.md');
    expect(msg).toContain('REVISION VALIDATION FAILED');
    expect(msg).toContain('- 2. Root Cause Analysis');
    expect(msg).toContain('restored to the pre-revision original');
    expect(msg).toContain('create_file');
  });
});

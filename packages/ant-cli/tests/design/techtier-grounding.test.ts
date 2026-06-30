/**
 * Design-job techTier grounding (spec/sys + rev variants).
 *
 * Covers the convergent fix that anchors a code-grounded design doc's techTier
 * to the real existing codebase and injects framework/language grounding:
 *  - matrix gate: gen-spec / rev-spec / rev-sys activate techTier (SYS_TIERS)
 *  - resolveDesignBasisTechTier: codebase-anchored, greenfield-safe (no fabrication)
 *  - CodebaseAnalyzer.detectStack: backend fixture → backend; empty dir → no signal
 *  - design-side techTier partials exist and stay design-flavored (no code-authoring)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { getConfigSlots } from '@ant/shared';
import type { Basis } from '@ant/shared';
import { resolveDesignBasisTechTier } from '../../src/agents/architect/graph/design/nodes/decompose/resolveDesignBasisTechTier';
import { CodebaseAnalyzer } from '../../src/periphery/adapters/analyzer/CodebaseAnalyzer';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { PromptBuilder } from '../../src/core/prompt/builder/PromptBuilder';

// ── matrix gate ────────────────────────────────────────────────
describe('matrix: code-grounded design intents activate techTier', () => {
  for (const intent of ['gen-spec', 'rev-spec', 'rev-sys'] as const) {
    it(`${intent} basis.tiers includes techTier`, () => {
      const tiers = getConfigSlots(intent)?.basis?.tiers ?? [];
      expect(tiers).toContain('techTier');
    });
  }

  it('gen-sys-be already activates techTier (unchanged reference)', () => {
    expect(getConfigSlots('gen-sys-be')?.basis?.tiers ?? []).toContain('techTier');
  });

  // Frontend-output design intents must NOT be flipped to a codebase stack.
  it('gen-ui-desc does not gain techTier (frontend-by-design, out of scope)', () => {
    const tiers = getConfigSlots('gen-ui-desc')?.basis?.tiers ?? [];
    expect(tiers).not.toContain('techTier');
  });
});

// ── resolveDesignBasisTechTier (shared owner) ──────────────────
function makeState(opts: {
  hasCodebase?: boolean;
  detectStack?: () => Promise<any>;
  featurePath?: string;
}): any {
  return {
    workspaceState: opts.hasCodebase !== undefined ? { hasCodebase: opts.hasCodebase } : undefined,
    context: { featurePath: opts.featurePath ?? '/feat' },
    deps: opts.detectStack ? { analyzer: { detectStack: opts.detectStack } } : {},
    resolvedAction: { intent: 'gen-spec' },
  };
}

describe('resolveDesignBasisTechTier', () => {
  it('returns undefined for greenfield (no hasCodebase) — analyzer never called', async () => {
    let called = false;
    const state = makeState({ hasCodebase: false, detectStack: async () => { called = true; return { stack: 'frontend' }; } });
    expect(await resolveDesignBasisTechTier(state)).toBeUndefined();
    expect(called).toBe(false);
  });

  it('returns undefined when analyzer is absent', async () => {
    const state = makeState({ hasCodebase: true });
    expect(await resolveDesignBasisTechTier(state)).toBeUndefined();
  });

  it('returns undefined when detectStack yields no signal', async () => {
    const state = makeState({ hasCodebase: true, detectStack: async () => undefined });
    expect(await resolveDesignBasisTechTier(state)).toBeUndefined();
  });

  it('anchors to a backend NestJS codebase (single slot, no frontend)', async () => {
    const state = makeState({
      hasCodebase: true,
      detectStack: async () => ({ stack: 'backend', language: 'typescript', framework: 'nestjs' }),
    });
    const config = await resolveDesignBasisTechTier(state);
    expect(config?.stack).toBe('backend');
    expect(config?.backend?.framework).toBe('nestjs');
    expect(config?.backend?.stack).toBe('backend');
    expect(config?.frontend).toBeUndefined();
  });

  it('anchors a fullstack codebase to both slots', async () => {
    const state = makeState({
      hasCodebase: true,
      detectStack: async () => ({ stack: 'fullstack', language: 'typescript', framework: 'nestjs' }),
    });
    const config = await resolveDesignBasisTechTier(state);
    expect(config?.stack).toBe('fullstack');
    expect(config?.frontend?.stack).toBe('frontend');
    expect(config?.backend?.stack).toBe('backend');
  });
});

// ── CodebaseAnalyzer.detectStack (fixture) ─────────────────────
describe('CodebaseAnalyzer.detectStack', () => {
  let backendDir: string;
  let emptyDir: string;

  beforeAll(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-detectstack-'));
    backendDir = path.join(base, 'backend');
    emptyDir = path.join(base, 'empty');
    await fs.mkdir(backendDir, { recursive: true });
    await fs.mkdir(path.join(backendDir, 'src'), { recursive: true });
    await fs.mkdir(emptyDir, { recursive: true });
    await fs.writeFile(
      path.join(backendDir, 'package.json'),
      JSON.stringify({
        name: 'be', dependencies: {
          '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0', '@nestjs/platform-express': '^10.0.0',
        },
      }),
    );
    await fs.writeFile(path.join(backendDir, 'src', 'main.ts'), `import { NestFactory } from '@nestjs/core';`);
  });

  afterAll(async () => {
    await fs.rm(path.dirname(backendDir), { recursive: true, force: true });
  });

  it('detects a NestJS backend as stack=backend', async () => {
    const result = await new CodebaseAnalyzer().detectStack(backendDir);
    expect(result?.stack).toBe('backend');
    expect(result?.language).toBe('typescript');
  });

  it('returns no signal (undefined) for an empty directory', async () => {
    const result = await new CodebaseAnalyzer().detectStack(emptyDir);
    // empty dir → low-confidence default → no fabricated stack
    expect(result === undefined || result.stack === undefined).toBe(true);
  });
});

// ── design partial discipline (6-check: no code-authoring leak) ─
describe('design-side techTier partials', () => {
  const dir = path.join(
    __dirname, '..', '..',
    'src/core/prompt/templates/jobs/design/basis/techTier',
  );
  const frameworks = ['nestjs', 'react', 'react-native', 'gin', 'nextjs', 'go'];
  const languages = ['typescript-node', 'typescript-browser'];

  it('all supported framework partials exist', async () => {
    for (const fw of frameworks) {
      await expect(fs.access(path.join(dir, 'framework', `${fw}.md`))).resolves.toBeUndefined();
    }
  });

  it('language variant partials exist', async () => {
    for (const lang of languages) {
      await expect(fs.access(path.join(dir, 'language', `${lang}.md`))).resolves.toBeUndefined();
    }
  });

  it('new partials reference their gate (SBS) and avoid code-authoring directives', async () => {
    const checks: Array<[string, string]> = [
      ['framework/nestjs.md', 'NestJS'],
      ['framework/react.md', 'React'],
      ['framework/gin.md', 'Gin'],
      ['framework/react-native.md', 'React Native'],
      ['language/typescript-node.md', 'TypeScript'],
      ['language/typescript-browser.md', 'TypeScript'],
    ];
    for (const [rel, token] of checks) {
      const body = await fs.readFile(path.join(dir, rel), 'utf-8');
      expect(body).toContain(token); // SBS: gate discriminator named
      // MECE: design partials ground the spec; they must not carry code-authoring
      // directives (install commands / forbidden-code sections).
      expect(body.toLowerCase()).not.toMatch(/npm install|pnpm install|forbidden patterns/);
    }
  });
});

// ── end-to-end: spec basis renders the NestJS grounding partial ─
describe('renderBasis injects design techTier grounding for a backend spec', () => {
  let promptBuilder: PromptBuilder;

  beforeAll(async () => {
    const templatesDir = path.join(__dirname, '..', '..', 'src/core/prompt/templates');
    await initPartials(templatesDir);
    promptBuilder = new PromptBuilder(new FilePromptAdapter(templatesDir));
  });

  const backendBasis: Basis = {
    techTier: { stack: 'backend', backend: { language: 'typescript', framework: 'nestjs', stack: 'backend' } },
  };
  const specSlot = getConfigSlots('gen-spec')?.basis;

  it('renders the NestJS design partial (SYS_TIERS gate active)', async () => {
    const out = await promptBuilder.renderBasis(
      backendBasis,
      'design',
      backendBasis.techTier!.backend ? [backendBasis.techTier!.backend] : [],
      'service',
      specSlot,
    );
    expect(out).toContain('NestJS');
    // The design framework partial (not the code one) is what rendered.
    expect(out).toContain('the code job decides');
  });

  it('renders nothing when basis has no techTier (greenfield-safe)', async () => {
    const out = await promptBuilder.renderBasis({}, 'design', [], 'service', specSlot);
    expect(out).not.toContain('NestJS');
  });
});

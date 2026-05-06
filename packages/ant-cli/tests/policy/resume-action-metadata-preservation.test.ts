import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import {
  resolveResumeActionSlots,
  resolveResumedActionContext,
} from '../../src/agents/common/graph/resumeActionMetadata';
import { planResolveStrategy } from '../../src/agents/planner/graph/plan/nodes/resolve';
import { visualResolveStrategy } from '../../src/agents/creator/graph/visual/nodes/resolve';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLAN_RESOLVE_PATH = resolve(
  __dirname,
  '../../src/agents/planner/graph/plan/nodes/resolve.ts',
);
const VISUAL_RESOLVE_PATH = resolve(
  __dirname,
  '../../src/agents/creator/graph/visual/nodes/resolve.ts',
);
const VISUAL_RUNNER_PATH = resolve(
  __dirname,
  '../../src/agents/creator/graph/visual/runner.ts',
);
const planResolveSource = readFileSync(PLAN_RESOLVE_PATH, 'utf8');
const visualResolveSource = readFileSync(VISUAL_RESOLVE_PATH, 'utf8');
const visualRunnerSource = readFileSync(VISUAL_RUNNER_PATH, 'utf8');

describe('resumeActionMetadata helper — SSOT priority', () => {
  it('uses actionMetadata when present', () => {
    const out = resolveResumeActionSlots({
      actionMetadata: {
        target: ['plan/from-action.md'],
        refs: ['architecture/from-action.md'],
        context: ['meta/from-action.md'],
      },
      resolvedAction: {
        target: ['plan/from-session.md'],
        refs: ['architecture/from-session.md'],
        context: ['meta/from-session.md'],
      } as any,
      inferTarget: ['plan/from-infer.md'],
    });
    expect(out.target).toEqual(['plan/from-action.md']);
    expect(out.refs).toEqual(['architecture/from-action.md']);
    expect(out.context).toEqual(['meta/from-action.md']);
    expect(out.sources).toEqual({
      target: 'actionMetadata',
      refs: 'actionMetadata',
      context: 'actionMetadata',
    });
  });

  it('falls back to resolvedAction on resume when actionMetadata is absent', () => {
    const out = resolveResumeActionSlots({
      actionMetadata: undefined,
      resolvedAction: {
        target: ['plan/from-session.md'],
        refs: ['architecture/from-session.md'],
        context: ['meta/from-session.md'],
      } as any,
      inferTarget: ['plan/from-infer.md'],
    });
    expect(out.target).toEqual(['plan/from-session.md']);
    expect(out.refs).toEqual(['architecture/from-session.md']);
    expect(out.context).toEqual(['meta/from-session.md']);
    expect(out.sources).toEqual({
      target: 'resolvedAction',
      refs: 'resolvedAction',
      context: 'resolvedAction',
    });
  });

  it('keeps explicit empty arrays from actionMetadata (no hidden fallback)', () => {
    const out = resolveResumeActionSlots({
      actionMetadata: {
        target: [],
        refs: [],
        context: [],
      },
      resolvedAction: {
        target: ['plan/from-session.md'],
        refs: ['architecture/from-session.md'],
        context: ['meta/from-session.md'],
      } as any,
      inferTarget: ['plan/from-infer.md'],
    });
    expect(out.target).toEqual([]);
    expect(out.refs).toEqual([]);
    expect(out.context).toEqual([]);
  });

  it('resolveResumedActionContext returns existing RAC when actionMetadata.intent is absent', () => {
    const existing = {
      intent: 'gen-plan',
      mode: 'generate',
      target: ['plan/prd.md'],
      refs: ['architecture/system.md'],
      context: ['meta/directives/plan.md'],
    } as any;
    const out = resolveResumedActionContext({
      actionMetadata: undefined,
      resolvedAction: existing,
    });
    expect(out).toBe(existing);
  });

  it('resolveResumedActionContext rebuilds RAC from explicit actionMetadata intent', () => {
    const out = resolveResumedActionContext({
      actionMetadata: {
        intent: 'gen-visual-icon' as any,
        target: ['visual/ui/ant/ui-spec.json'],
        refs: ['visual/ui/ant/ui-tokens.json'],
        context: ['plan/prd.md'],
      } as any,
      resolvedAction: {
        intent: 'gen-visual-logo',
        mode: 'generate',
        target: ['visual/ui/ant/ui-logo.json'],
      } as any,
    });
    expect(out?.intent).toBe('gen-visual-icon');
    expect(out?.target).toEqual(['visual/ui/ant/ui-spec.json']);
    expect(out?.refs).toEqual(['visual/ui/ant/ui-tokens.json']);
    expect(out?.context).toEqual(['plan/prd.md']);
  });
});

describe('plan resolve — resume refs/context preservation', () => {
  function setupFeatureDir() {
    const base = mkdtempSync(join(os.tmpdir(), 'ant-plan-resume-'));
    mkdirSync(join(base, 'plan'), { recursive: true });
    mkdirSync(join(base, 'architecture'), { recursive: true });
    mkdirSync(join(base, 'meta'), { recursive: true });
    return base;
  }

  it('loads refs/context from state.resolvedAction when actionMetadata is absent', async () => {
    const featurePath = setupFeatureDir();
    try {
      writeFileSync(join(featurePath, 'plan/prd.md'), 'target plan doc', 'utf-8');
      writeFileSync(join(featurePath, 'architecture/ref.md'), 'ref doc', 'utf-8');
      writeFileSync(join(featurePath, 'meta/context.md'), 'ctx doc', 'utf-8');

      const state = {
        featurePath,
        actionMetadata: undefined,
        resolvedAction: {
          target: ['plan/prd.md'],
          refs: ['architecture/ref.md'],
          context: ['meta/context.md'],
        },
        workspaceState: { planFileNames: ['prd.md'] },
        overrideDirective: undefined,
        isResume: true,
        chatSource: true,
      } as any;

      const out = await planResolveStrategy.loadArtifacts(state);
      const docs = (out as any).resolvedArtifacts || [];
      const roles = new Map(docs.map((d: any) => [d.path, d.role]));
      expect(roles.get('architecture/ref.md')).toBe('ref');
      expect(roles.get('meta/context.md')).toBe('context');
    } finally {
      rmSync(featurePath, { recursive: true, force: true });
    }
  });

  it('prefers actionMetadata refs/context over resolvedAction on the current turn', async () => {
    const featurePath = setupFeatureDir();
    try {
      writeFileSync(join(featurePath, 'plan/prd.md'), 'target plan doc', 'utf-8');
      writeFileSync(join(featurePath, 'architecture/ref-action.md'), 'ref action', 'utf-8');
      writeFileSync(join(featurePath, 'architecture/ref-session.md'), 'ref session', 'utf-8');
      writeFileSync(join(featurePath, 'meta/context-action.md'), 'ctx action', 'utf-8');
      writeFileSync(join(featurePath, 'meta/context-session.md'), 'ctx session', 'utf-8');

      const state = {
        featurePath,
        actionMetadata: {
          intent: 'gen-plan',
          target: ['plan/prd.md'],
          refs: ['architecture/ref-action.md'],
          context: ['meta/context-action.md'],
        },
        resolvedAction: {
          target: ['plan/prd.md'],
          refs: ['architecture/ref-session.md'],
          context: ['meta/context-session.md'],
        },
        workspaceState: { planFileNames: ['prd.md'] },
      } as any;

      const out = await planResolveStrategy.loadArtifacts(state);
      const docs = (out as any).resolvedArtifacts || [];
      const paths = docs.map((d: any) => d.path);
      expect(paths).toContain('architecture/ref-action.md');
      expect(paths).toContain('meta/context-action.md');
      expect(paths).not.toContain('architecture/ref-session.md');
      expect(paths).not.toContain('meta/context-session.md');
    } finally {
      rmSync(featurePath, { recursive: true, force: true });
    }
  });
});

describe('visual resolve — resume RAC preservation', () => {
  function setupFeatureDir() {
    const base = mkdtempSync(join(os.tmpdir(), 'ant-visual-resume-'));
    mkdirSync(join(base, 'sessions/creator'), { recursive: true });
    return base;
  }

  it('restores resolvedAction from visual session when actionMetadata is absent', async () => {
    const featurePath = setupFeatureDir();
    try {
      const sessionResolvedAction = {
        intent: 'gen-visual-logo',
        mode: 'generate',
        target: ['visual/ui/ant/ui-logo.json'],
        refs: ['visual/ui/ant/ui-tokens.json'],
        context: ['plan/prd.md'],
      };
      writeFileSync(
        join(featurePath, 'sessions/creator/visual.json'),
        JSON.stringify({ state: { resolvedAction: sessionResolvedAction, interruption: { reason: 'user_stopped' } } }, null, 2),
        'utf-8',
      );

      const out = await visualResolveStrategy.loadArtifacts({
        featurePath,
        directive: 'resume visual job',
        overrideDirective: 'resume visual job',
        actionMetadata: undefined,
        resolvedAction: undefined,
        isResume: true,
        clarifyCount: 0,
      } as any);

      expect((out as any).resolvedAction).toEqual(sessionResolvedAction);
    } finally {
      rmSync(featurePath, { recursive: true, force: true });
    }
  });
});

describe('wiring guards — plan/visual route through common SSOT', () => {
  it('plan resolve imports and uses resolveResumeActionSlots', () => {
    expect(planResolveSource).toMatch(/resolveResumeActionSlots/);
    expect(planResolveSource).toMatch(/const slots = resolveResumeActionSlots\(/);
  });

  it('visual resolve imports and uses resolveResumedActionContext', () => {
    expect(visualResolveSource).toMatch(/resolveResumedActionContext/);
    expect(visualResolveSource).toMatch(/const resolvedAction = resolveResumedActionContext\(/);
  });

  it('visual runner persists resolvedAction in session state', () => {
    expect(visualRunnerSource).toMatch(/resolvedAction:\s*finalState\.resolvedAction/);
  });
});

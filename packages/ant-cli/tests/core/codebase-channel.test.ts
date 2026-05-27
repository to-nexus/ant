/**
 * Codebase Channel SSOT — regression guard.
 *
 * Locks the four invariants that make existing-project workspaces
 * receive the codebase awareness partial without RAC slot pollution:
 *
 *   1. WorkspaceState.hasCodebase reflects a real dependency/build manifest
 *      OR memory index (workspaceAnalyzer manifest-based detection path).
 *   2. getConfigSlots / getConfigSlotsForDomain dynamically inject the
 *      auto codebase context slot for plan/design intents when
 *      hasCodebase is true; greenfield workspaces stay unaffected.
 *   3. deriveCodebaseRole returns 'ref' for code-anchored intents (any
 *      workspace), 'context' for plan/design + hasCodebase, undefined
 *      otherwise.
 *   4. The codebase-channel partial gates on `codebaseRole` and emits
 *      no body when the role is undefined.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getConfigSlots,
  getConfigSlotsForDomain,
  deriveCodebaseRole,
  type IntentId,
} from '@ant/shared';
import { analyzeWorkspace } from '../../src/agents/common/graph/nodes/triage/workspaceAnalyzer';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

// ────────────────────────────────────────────────────────────────
// 1. workspaceAnalyzer disk walk
// ────────────────────────────────────────────────────────────────

describe('workspaceAnalyzer — codebase disk walk (Codebase Channel SSOT)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-channel-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('hasCodebase=false when codebase/ does not exist', async () => {
    const state = await analyzeWorkspace(tmpRoot);
    expect(state.hasCodebase).toBe(false);
    expect(state.codebaseEntryPoints).toBeUndefined();
  });

  it('hasCodebase=false when codebase/ exists but is empty', async () => {
    fs.mkdirSync(path.join(tmpRoot, 'codebase'));
    const state = await analyzeWorkspace(tmpRoot);
    expect(state.hasCodebase).toBe(false);
  });

  it('hasCodebase=true with entry points when codebase/ has package.json', async () => {
    fs.mkdirSync(path.join(tmpRoot, 'codebase'));
    fs.writeFileSync(path.join(tmpRoot, 'codebase', 'package.json'), '{}');
    fs.mkdirSync(path.join(tmpRoot, 'codebase', 'src'));
    const state = await analyzeWorkspace(tmpRoot);
    expect(state.hasCodebase).toBe(true);
    expect(state.codebaseEntryPoints).toContain('package.json');
    expect(state.codebaseEntryPoints).toContain('src');
  });

  it('hasCodebase=false when codebase/ has only non-manifest files (.txt)', async () => {
    fs.mkdirSync(path.join(tmpRoot, 'codebase'));
    fs.writeFileSync(path.join(tmpRoot, 'codebase', 'random.txt'), 'x');
    const state = await analyzeWorkspace(tmpRoot);
    expect(state.hasCodebase).toBe(false);
    expect(state.codebaseEntryPoints).toBeUndefined();
  });

  it('hasCodebase=false when codebase/ has only docs (README.md)', async () => {
    fs.mkdirSync(path.join(tmpRoot, 'codebase'));
    fs.writeFileSync(path.join(tmpRoot, 'codebase', 'README.md'), '# notes');
    const state = await analyzeWorkspace(tmpRoot);
    expect(state.hasCodebase).toBe(false);
    expect(state.codebaseEntryPoints).toBeUndefined();
  });

  it('hasCodebase=true for a non-package.json manifest (go.mod)', async () => {
    fs.mkdirSync(path.join(tmpRoot, 'codebase'));
    fs.writeFileSync(path.join(tmpRoot, 'codebase', 'go.mod'), 'module example');
    const state = await analyzeWorkspace(tmpRoot);
    expect(state.hasCodebase).toBe(true);
    expect(state.codebaseEntryPoints).toContain('go.mod');
  });
});

// ────────────────────────────────────────────────────────────────
// 2. Dynamic injection — getConfigSlots × hasCodebase × intent
// ────────────────────────────────────────────────────────────────

const PLAN_DESIGN_INTENTS: IntentId[] = [
  'gen-plan',
  'rev-plan',
  'explain-plan',
  'gen-sys-fe',
  'rev-sys',
  'gen-ui-figma',
  'rev-ui',
  'gen-game-art-desc',
  'rev-game-art',
  'gen-spec',
  'rev-spec',
];

const CODE_ANCHORED_INTENTS: IntentId[] = ['rev-code', 'gen-learn', 'explain-code'];

describe('getConfigSlots — codebase context auto-injection', () => {
  it('plan/design intent + hasCodebase=true → context has auto codebase slot', () => {
    for (const intent of PLAN_DESIGN_INTENTS) {
      const slots = getConfigSlots(intent, { hasCodebase: true });
      expect(slots, `${intent} matrix entry`).not.toBeNull();
      const codebaseCtx = slots!.context.find(s => s.codebase === true);
      expect(codebaseCtx, `${intent} should expose codebase context slot`).toBeDefined();
      expect(codebaseCtx!.auto).toBe(true);
      expect(codebaseCtx!.locked).toBe(true);
      expect(codebaseCtx!.required).toBe(false);
    }
  });

  it('plan/design intent + hasCodebase=false → no codebase slot', () => {
    for (const intent of PLAN_DESIGN_INTENTS) {
      const slots = getConfigSlots(intent, { hasCodebase: false });
      const inRefs = slots!.refs.some(s => s.codebase === true);
      const inCtx = slots!.context.some(s => s.codebase === true);
      expect(inRefs || inCtx, `${intent} should not expose codebase slot in greenfield`).toBe(false);
    }
  });

  it('code-anchored intents always carry codebase ref slot regardless of hasCodebase', () => {
    for (const intent of CODE_ANCHORED_INTENTS) {
      for (const hasCodebase of [true, false]) {
        const slots = getConfigSlots(intent, { hasCodebase });
        const codebaseRef = slots!.refs.find(s => s.codebase === true);
        expect(codebaseRef, `${intent} (hasCodebase=${hasCodebase})`).toBeDefined();
        expect(codebaseRef!.required).toBe(true);
        expect(codebaseRef!.locked).toBe(true);
        expect(codebaseRef!.auto).toBe(false);
      }
    }
  });

  it('getConfigSlotsForDomain forwards workspaceContext into the slot', () => {
    const greenfield = getConfigSlotsForDomain('gen-plan', 'service');
    const existing = getConfigSlotsForDomain('gen-plan', 'service', { hasCodebase: true });
    expect(greenfield!.context.some(s => s.codebase === true)).toBe(false);
    expect(existing!.context.some(s => s.codebase === true)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. deriveCodebaseRole — partial-gate single source
// ────────────────────────────────────────────────────────────────

describe('deriveCodebaseRole — partial gate SSOT', () => {
  it("returns 'ref' for code-anchored intents (any workspace)", () => {
    for (const intent of CODE_ANCHORED_INTENTS) {
      expect(deriveCodebaseRole(intent, { hasCodebase: false })).toBe('ref');
      expect(deriveCodebaseRole(intent, { hasCodebase: true })).toBe('ref');
    }
  });

  it("returns 'context' for plan/design + hasCodebase=true", () => {
    for (const intent of PLAN_DESIGN_INTENTS) {
      expect(deriveCodebaseRole(intent, { hasCodebase: true })).toBe('context');
    }
  });

  it('returns undefined for plan/design without hasCodebase', () => {
    for (const intent of PLAN_DESIGN_INTENTS) {
      expect(deriveCodebaseRole(intent, { hasCodebase: false })).toBeUndefined();
      expect(deriveCodebaseRole(intent, undefined)).toBeUndefined();
    }
  });

  it('returns undefined for unrelated intents (visual / ask)', () => {
    expect(deriveCodebaseRole('gen-visual-logo', { hasCodebase: true })).toBeUndefined();
    expect(deriveCodebaseRole('ask-general', { hasCodebase: true })).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 4. codebase-channel partial — role gate
// ────────────────────────────────────────────────────────────────

describe('codebase-channel partial — role gate', () => {
  const adapter = new FilePromptAdapter();
  const partialPath = 'jobs/shared/injections/codebase-channel';

  it('renders empty body when codebaseRole is undefined', async () => {
    const out = await adapter.render(partialPath, { codebaseRole: undefined });
    expect(out.trim()).toBe('');
  });

  it('renders ref-tone body when codebaseRole is "ref"', async () => {
    const out = await adapter.render(partialPath, {
      codebaseRole: 'ref',
      codebaseEntryPoints: ['package.json', 'src'],
    });
    expect(out).toContain('PRIMARY AUTHORITY');
    expect(out).toContain('MUST inspect the codebase before producing output');
    expect(out).toContain('codebase/package.json');
    expect(out).toContain('codebase/src');
  });

  it('renders context-tone body when codebaseRole is "context"', async () => {
    const out = await adapter.render(partialPath, {
      codebaseRole: 'context',
      codebaseEntryPoints: ['tsconfig.json'],
    });
    expect(out).toContain('BINDING CONTEXT');
    expect(out).toContain('MUST inspect the codebase before decomposing');
    expect(out).toContain('codebase/tsconfig.json');
  });
});

/**
 * Workspace-domain axis — `resolveWorkspaceDomain` SSOT + its two collaborators
 * (the workspace-shape signal that feeds its legacy rung, and the domain-scoped
 * intent catalog that replaced its intent rung).
 *
 * Precedence: `WorkspaceConfig.domain` (config.json — absolute) →
 * `actionMetadata.domain` (FE mirror) → game-shaped workspaceState hint
 * (legacy, pre-persisted-domain projects) → default `'service'`.
 *
 * `intentId` is NOT an input. It used to be rung 2 (`design-game-art` ⇒ game),
 * which inverted the axis: the intent is picked by the triage LLM from a
 * domain-scoped catalog, so treating it as domain evidence let a mis-picked
 * intent overrule the project's own setting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveWorkspaceDomain } from '../../src/agents/common/graph/nodes/triage/derive.js';
import { renderIntentCatalog } from '../../src/agents/common/graph/nodes/triage/index.js';
import { analyzeWorkspace } from '../../src/agents/common/graph/nodes/triage/workspaceAnalyzer.js';
import type { WorkspaceState } from '../../src/agents/common/graph/nodes/triage/types.js';
import type { ActionMetadata } from '@ant/shared';

const emptyWs: WorkspaceState = {
  hasPlan: false,
  hasMetaDirectives: false,
  hasMetaEvals: false,
  hasVisualUi: false,
  hasVisualGameArt: false,
  hasFigmaConfig: false,
  hasAssets: false,
  hasArchitectureSystem: false,
  hasArchitectureSpec: false,
  hasDesignDoc: false,
  hasCodebase: false,
};
const gameShapedWs: WorkspaceState = { ...emptyWs, hasVisualGameArt: true };

describe('resolveWorkspaceDomain — precedence ladder', () => {
  const CASES: Array<{
    name: string;
    input: Parameters<typeof resolveWorkspaceDomain>[0];
    expected: 'service' | 'game';
  }> = [
    {
      name: '1) config.json domain wins — explicit game',
      input: { configDomain: 'game', workspaceState: emptyWs },
      expected: 'game',
    },
    {
      name: '2) config.json domain=service beats a game-shaped workspace (the true-oaring-crane case)',
      input: { configDomain: 'service', workspaceState: gameShapedWs },
      expected: 'service',
    },
    {
      name: '3) config.json domain beats a conflicting FE metadata mirror',
      input: { configDomain: 'service', actionMetadata: { domain: 'game' } as ActionMetadata },
      expected: 'service',
    },
    {
      name: '4) config absent → actionMetadata.domain is consulted',
      input: { actionMetadata: { domain: 'game' } as ActionMetadata, workspaceState: emptyWs },
      expected: 'game',
    },
    {
      name: '5) config absent + no metadata (plain chat turn) + game-shaped → legacy hint fires',
      input: { workspaceState: gameShapedWs },
      expected: 'game',
    },
    {
      name: '6) an unrecognised config value falls through instead of being trusted',
      input: { configDomain: 'arcade', workspaceState: emptyWs },
      expected: 'service',
    },
    {
      name: '7) nothing known → service default',
      input: {},
      expected: 'service',
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      expect(resolveWorkspaceDomain(c.input)).toBe(c.expected);
    });
  }
});

describe('renderIntentCatalog — domain-scoped candidate set', () => {
  it('a service workspace is never offered game-art intents', () => {
    const catalog = renderIntentCatalog('service');
    expect(catalog).not.toContain('design-game-art');
    expect(catalog).not.toContain('gen-game-art-desc');
    expect(catalog).toContain('design-ui');
    // Domain-agnostic groups stay available in both domains.
    expect(catalog).toContain('gen-plan');
  });

  it('a game workspace is offered game-art and not the service-only UI group', () => {
    const catalog = renderIntentCatalog('game');
    expect(catalog).toContain('design-game-art');
    expect(catalog).not.toContain('design-ui');
    expect(catalog).toContain('gen-plan');
  });
});

describe('analyzeWorkspace — game-art surface must require populated content', () => {
  let featurePath: string;

  beforeEach(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-domain-'));
  });

  afterEach(() => {
    fs.rmSync(featurePath, { recursive: true, force: true });
  });

  function writeFigma(surface: 'ui' | 'game-art', body: unknown) {
    const dir = path.join(featurePath, 'visual', surface, 'figma');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'figma.json'), JSON.stringify(body));
  }

  it('the scaffolded `{"file": null}` placeholder is NOT a design surface', async () => {
    // `ensureCanonicalStructure` writes this into BOTH surfaces for every
    // project regardless of domain. Counting it made every workspace
    // game-shaped, which flipped the legacy domain rung to 'game'.
    writeFigma('game-art', { file: null });
    writeFigma('ui', { file: null });
    const ws = await analyzeWorkspace(featurePath);
    expect(ws.hasVisualGameArt).toBe(false);
    expect(ws.hasVisualUi).toBe(false);
    expect(resolveWorkspaceDomain({ workspaceState: ws })).toBe('service');
  });

  it('a populated game-art figma workfile IS a design surface', async () => {
    writeFigma('game-art', { file: 'https://www.figma.com/design/abc/art' });
    const ws = await analyzeWorkspace(featurePath);
    expect(ws.hasVisualGameArt).toBe(true);
    expect(resolveWorkspaceDomain({ workspaceState: ws })).toBe('game');
  });

  it('a handoff bundle still counts by file presence (free-form, no fixed schema)', async () => {
    const dir = path.join(featurePath, 'visual', 'game-art', 'handoff');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), '# art');
    const ws = await analyzeWorkspace(featurePath);
    expect(ws.hasVisualGameArt).toBe(true);
  });
});

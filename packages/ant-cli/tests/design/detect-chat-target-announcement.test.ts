/**
 * Detect chat target announcement — derived from RAC target, not hardcoded.
 *
 * outer-blending-prism RCA: `renderDesignUiOutputSection` printed the
 * ant-JSON trio for EVERY design-ui / design-game-art intent (rev on handoff,
 * gen-*-desc whose matrix target is the handoff dir, even chat-only
 * explain-*) while suppressing the real `rac.target`. The hardcode is
 * retired; the announcement now flows through `renderTargetSection` from
 * `rac.target` (populated by `getDefaultTargetPaths`, sub-source aware).
 */

import { describe, it, expect } from 'vitest';
import { formatRACForChat } from '../../src/core/types/detection';
import type { ResolvedActionContext } from '@ant/shared';

const baseRAC = {
  intentGroup: 'design-game-art',
  intent: 'rev-game-art',
  mode: 'refactor',
  domain: 'game',
  source: 'explicit',
} as unknown as ResolvedActionContext;

describe('detect chat target announcement', () => {
  it('rev-game-art on a handoff bundle announces the bundle, NOT the ant trio', () => {
    const rac = {
      ...baseRAC,
      target: [
        'visual/game-art/handoff/README.md',
        'visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html',
      ],
      refs: [
        'visual/game-art/handoff/README.md',
        'visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html',
      ],
    } as ResolvedActionContext;
    const out = formatRACForChat(rac, undefined, 'ko', 'detect', {
      target: [{ kind: 'folder', path: 'visual/game-art/handoff', fileCount: 18 }],
      refs: [{ kind: 'folder', path: 'visual/game-art/handoff', fileCount: 18 }],
      context: [],
    } as any);
    expect(out).toContain('🎯');
    expect(out).toContain('visual/game-art/handoff');
    expect(out).not.toContain('game-art-tokens.json');
    expect(out).not.toContain('생성 문서');
  });

  it('figma revise (target = ant trio from the matrix) announces the trio under 🎯', () => {
    const rac = {
      ...baseRAC,
      target: [
        'visual/game-art/ant/game-art-tokens.json',
        'visual/game-art/ant/game-art-assets.json',
        'visual/game-art/ant/game-art-spec.json',
      ],
      refs: ['visual/game-art/figma/figma.json'],
    } as ResolvedActionContext;
    const out = formatRACForChat(rac, undefined, 'en');
    expect(out).toContain('🎯 **Target**');
    expect(out).toContain('visual/game-art/ant/game-art-tokens.json');
    expect(out).not.toContain('Output Documents');
  });

  it('explain (chat-only, empty target) announces no target section', () => {
    const rac = {
      ...baseRAC,
      intent: 'explain-game-art',
      mode: 'explain',
      target: undefined,
      refs: ['visual/game-art/ant/game-art-spec.json'],
    } as unknown as ResolvedActionContext;
    const out = formatRACForChat(rac, undefined, 'ko');
    expect(out).not.toContain('🎯');
    expect(out).not.toContain('생성 문서');
    // refs still shown
    expect(out).toContain('📎');
  });

  it('ui group parity: handoff target announced, hardcoded trio gone', () => {
    const rac = {
      ...baseRAC,
      intentGroup: 'design-ui',
      intent: 'rev-ui',
      domain: 'service',
      target: ['visual/ui/handoff/site/index.html'],
      refs: ['visual/ui/handoff/site/index.html'],
    } as unknown as ResolvedActionContext;
    const out = formatRACForChat(rac, undefined, 'en');
    expect(out).toContain('visual/ui/handoff/site/index.html');
    expect(out).not.toContain('ui-tokens.json');
  });
});

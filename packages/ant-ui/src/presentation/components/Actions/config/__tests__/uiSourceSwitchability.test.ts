/**
 * ui-source subgroup switchability + surface-aware bundle warning.
 *
 * The hard-exclusive ui-source slot used to render every NON-active subgroup
 * `disabled` (`onToggle: undefined`). On a `refsSingleSelect` slot that stranded
 * the user on whichever source happened to be auto-selected first — the
 * "only the handoff bundle is selectable" report for `rev-game-art`. Exclusivity
 * is now enforced by REPLACING the selection, so siblings stay clickable.
 *
 * The DOM behaviour is locked by source scan (this package's tests run under
 * `environment: 'node'`), mirroring `resolveSlotsCodebase.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SlotDef } from '@ant/shared';
import { resolveSlotEntries } from '../resolveSlots';

const fileMeta = {
  size: 100,
  mtime: 0,
  isTemplate: false,
  templateReason: null,
  templateContentLength: 0,
  templateThreshold: 0,
};

const gameArtRevSlot: SlotDef = {
  path: 'visual/game-art',
  label: { en: 'Game Art Design', ko: '게임 아트 설계' },
  type: 'ui-source',
  required: true,
  uiSources: [
    { id: 'figma', dir: 'visual/game-art/figma', label: { en: 'Figma', ko: 'Figma' } },
    { id: 'handoff', dir: 'visual/game-art/handoff', label: { en: 'Handoff', ko: '핸드오프' } },
  ],
};

const antSlot: SlotDef = {
  ...gameArtRevSlot,
  uiSources: [
    { id: 'ant', dir: 'visual/game-art/ant', label: { en: 'Ant Canonical', ko: 'Ant 설계 문서' } },
  ],
};

const tree = [
  {
    name: 'visual',
    path: 'visual',
    type: 'directory',
    children: [
      {
        name: 'game-art',
        path: 'visual/game-art',
        type: 'directory',
        children: [
          {
            name: 'figma',
            path: 'visual/game-art/figma',
            type: 'directory',
            children: [
              { name: 'figma.json', path: 'visual/game-art/figma/figma.json', type: 'file', meta: fileMeta },
            ],
          },
          {
            name: 'handoff',
            path: 'visual/game-art/handoff',
            type: 'directory',
            children: [
              { name: 'DESIGN.md', path: 'visual/game-art/handoff/DESIGN.md', type: 'file', meta: fileMeta },
            ],
          },
          {
            name: 'ant',
            path: 'visual/game-art/ant',
            type: 'directory',
            children: [
              { name: 'game-art-tokens.json', path: 'visual/game-art/ant/game-art-tokens.json', type: 'file', meta: fileMeta },
            ],
          },
        ],
      },
    ],
  },
] as any;

describe('rev-game-art ui-source subgroups', () => {
  it('both authored sub-sources resolve as selectable when populated', () => {
    const [entry] = resolveSlotEntries([gameArtRevSlot], tree, undefined, {
      figmaPopulated: true,
      bridgeConnected: true,
      figmaDesktopReachable: true,
      onOpenFigmaSettings: () => {},
    });
    const byId = Object.fromEntries((entry.subgroups ?? []).map(s => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual(['figma', 'handoff']);
    expect(byId.figma.hasValidFiles).toBe(true);
    expect(byId.handoff.hasValidFiles).toBe(true);
  });

  it('an unconfigured figma workfile is invalid but the subgroup still renders', () => {
    const [entry] = resolveSlotEntries([gameArtRevSlot], tree, undefined, {
      figmaPopulated: false,
      bridgeConnected: true,
      figmaDesktopReachable: true,
      onOpenFigmaSettings: () => {},
    });
    const figma = (entry.subgroups ?? []).find(s => s.id === 'figma')!;
    expect(figma.hasFiles).toBe(true);
    expect(figma.hasValidFiles).toBe(false);
    expect(figma.files[0].warnings.map(w => w.type)).toContain('invalid-file');
  });
});

describe('ant bundle-completeness warning is surface-aware', () => {
  it('names game-art, not UI, for the game surface', () => {
    const [entry] = resolveSlotEntries([antSlot], tree);
    const ant = (entry.subgroups ?? []).find(s => s.id === 'ant')!;
    // Only 1 of the canonical trio is present → the bundle warning fires.
    expect(ant.warnings?.[0].message.en).toContain('game-art');
    expect(ant.warnings?.[0].message.en).not.toContain('UI');
    expect(ant.warnings?.[0].message.ko).toContain('게임아트');
  });
});

describe('exclusivity lock is scoped to multi-select slots', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', '..', rel), 'utf-8');

  it('SlotEntryList exempts single-select slots from the sibling lock', () => {
    const source = read('config/SlotEntryList.tsx');
    // The lock must be conjoined with `!singleSelect`; without it a sibling
    // subgroup renders `disabled` and cannot be clicked to switch.
    expect(source).toMatch(/isLocked\s*=\s*!singleSelect/);
  });

  it('ActionConfigView replaces (not appends) batch ref selections when single-select', () => {
    const source = read('ActionConfigView.tsx');
    expect(source).toMatch(/const replace = field === 'refs' && !!slots\?\.refsSingleSelect;/);
    expect(source).toMatch(/singleSelect=\{slots\.refsSingleSelect\}/);
  });

  it('every revise-target writer routes through the getDefaultTargetPaths SSOT', () => {
    const source = read('ActionConfigView.tsx');
    // 3 call sites: mount effect, toggleFile, toggleFiles.
    expect(source.match(/resolveTargetPaths\(/g)?.length).toBe(3);
    // The old "target mirrors refs verbatim" shortcut must not come back.
    expect(source).not.toMatch(/target: next\.length > 0 \? next : undefined/);
  });
});

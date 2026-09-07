/**
 * shared/rail — the two primitives that carry logic (the rest is markup):
 * immutable collapse-set toggling and the icon switch's tooltip derivation.
 */
import { describe, it, expect } from 'vitest';
import { Boxes, Code2 } from 'lucide-react';
import { toggleSetMember } from '../../src/presentation/components/shared/rail/collapse';
import { railSwitchLabel } from '../../src/presentation/components/shared/rail/RailIconSwitch';

describe('toggleSetMember', () => {
  it('adds a missing key and removes a present one, never mutating the input', () => {
    const base = new Set(['user']);
    const added = toggleSetMember(base, 'org');
    expect([...added].sort()).toEqual(['org', 'user']);
    const removed = toggleSetMember(added, 'user');
    expect([...removed]).toEqual(['org']);
    expect([...base]).toEqual(['user']);
    expect(added).not.toBe(base);
  });
});

describe('railSwitchLabel', () => {
  const options = [
    { id: 'workspace' as const, icon: Boxes, label: 'Workspace' },
    { id: 'codespace' as const, icon: Code2, label: 'Codespace' },
  ] as const;

  it.each([
    ['explicit label wins', 'workspace', { workspace: 'File view — switch to Structure' }, undefined, 'File view — switch to Structure'],
    ['derived through the switchTo template', 'workspace', undefined, (n: string) => `Switch to ${n}`, 'Switch to Codespace'],
    ['falls back to the other option label', 'codespace', undefined, undefined, 'Workspace'],
    ['explicit map missing the current value derives', 'codespace', { workspace: 'x' }, (n: string) => `→ ${n}`, '→ Workspace'],
  ] as const)('%s', (_name, value, labels, switchTo, expected) => {
    expect(railSwitchLabel(value, options, labels, switchTo)).toBe(expected);
  });

  it('label-less options fall back to the id', () => {
    const bare = [
      { id: 'human' as const, icon: Boxes },
      { id: 'files' as const, icon: Code2 },
    ] as const;
    expect(railSwitchLabel('human', bare)).toBe('files');
  });
});

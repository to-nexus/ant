/**
 * Codebase Channel SSOT — FE rendering side
 *
 * `getConfigSlots(intent, { hasCodebase: true })` injects an auto codebase
 * context slot for plan/design intents (gen-spec / rev-spec / explain-spec
 * / gen-sys-* / rev-sys / explain-sys / gen-plan / rev-plan / explain-plan
 * / gen-ui-* / rev-ui / explain-ui / gen-game-art-* / rev-game-art /
 * explain-game-art — see PLAN_DESIGN_INTENTS_FOR_CODEBASE_CONTEXT in
 * action-config-matrix.ts).
 *
 * The FE rendering side MUST translate that injected slot into a
 * SlotEntry whose `hasFiles` reflects the workspace's actual codebase
 * presence — `resolveSlotEntries` takes a `codebaseHasFiles` parameter
 * for exactly that purpose.
 *
 * Regression this test guards: ActionConfigView previously called
 * `resolveSlotEntries(slots.context, ...)` WITHOUT passing the parameter
 * (only `slots.refs` did). The codebase context slot's `hasFiles` always
 * resolved to `false`, so SlotEntryList rendered an amber "Codebase
 * empty" card on every spec / sys / plan / ui / game-art gen·rev·explain
 * intent — even when the workspace clearly had a codebase. The fix is a
 * single missing argument; this test locks the wiring so a future
 * refactor cannot drop it again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getConfigSlots } from '@ant/shared';
import { resolveSlotEntries } from '../resolveSlots';

describe('resolveSlotEntries — codebase context slot (Codebase Channel SSOT)', () => {
  it('propagates codebaseHasFiles=true to the auto-injected codebase context entry (gen-spec)', () => {
    const slots = getConfigSlots('gen-spec', { hasCodebase: true });
    expect(slots).not.toBeNull();
    // Auto-injected codebase context slot is prepended.
    const codebaseSlotDef = slots!.context.find(s => s.codebase === true);
    expect(codebaseSlotDef).toBeDefined();
    expect(codebaseSlotDef!.auto).toBe(true);

    const entries = resolveSlotEntries(slots!.context, [], undefined, undefined, true);
    const codebaseEntry = entries.find(e => e.def.codebase === true);
    expect(codebaseEntry).toBeDefined();
    expect(codebaseEntry!.hasFiles).toBe(true);
    expect(codebaseEntry!.hasValidFiles).toBe(true);
  });

  it('propagates codebaseHasFiles=false to the auto-injected codebase context entry (gen-spec)', () => {
    const slots = getConfigSlots('gen-spec', { hasCodebase: true });
    const entries = resolveSlotEntries(slots!.context, [], undefined, undefined, false);
    const codebaseEntry = entries.find(e => e.def.codebase === true);
    expect(codebaseEntry).toBeDefined();
    expect(codebaseEntry!.hasFiles).toBe(false);
    expect(codebaseEntry!.hasValidFiles).toBe(false);
  });

  it.each([
    'gen-sys-fe',
    'gen-sys-be',
    'gen-sys-full',
    'rev-sys',
    'explain-sys',
    'rev-spec',
    'explain-spec',
  ] as const)(
    'plan/design intent %s exposes a codebase context slot whose hasFiles tracks codebaseHasFiles',
    (intent) => {
      const slots = getConfigSlots(intent, { hasCodebase: true });
      expect(slots).not.toBeNull();
      const codebaseSlotDef = slots!.context.find(s => s.codebase === true);
      expect(codebaseSlotDef).toBeDefined();

      const entriesTrue = resolveSlotEntries(slots!.context, [], undefined, undefined, true);
      const entriesFalse = resolveSlotEntries(slots!.context, [], undefined, undefined, false);
      expect(entriesTrue.find(e => e.def.codebase === true)!.hasFiles).toBe(true);
      expect(entriesFalse.find(e => e.def.codebase === true)!.hasFiles).toBe(false);
    },
  );

  it('greenfield workspace (hasCodebase=false) does not inject the codebase context slot', () => {
    const slots = getConfigSlots('gen-spec', { hasCodebase: false });
    expect(slots!.context.some(s => s.codebase === true)).toBe(false);
  });

  it('code-anchored ref intents already work — codebaseHasFiles=true makes the ref entry non-empty (rev-code)', () => {
    const slots = getConfigSlots('rev-code');
    expect(slots).not.toBeNull();
    const codebaseRef = slots!.refs.find(s => s.codebase === true);
    expect(codebaseRef).toBeDefined();

    const entries = resolveSlotEntries(slots!.refs, [], undefined, undefined, true);
    const codebaseEntry = entries.find(e => e.def.codebase === true);
    expect(codebaseEntry!.hasFiles).toBe(true);
  });

  /**
   * lint-as-test — the original bug was a single missing argument at the
   * `ActionConfigView.ctxEntries` call site (refs path passed the flag,
   * context path did not). The unit tests above lock the function
   * contract; this lint locks the call sites so a future refactor
   * cannot quietly drop the argument and re-trigger the regression.
   */
  it('ActionConfigView passes codebaseHasFiles to BOTH refEntries and ctxEntries call sites', () => {
    const source = readFileSync(
      resolve(__dirname, '../../ActionConfigView.tsx'),
      'utf8',
    );
    const refCallMatch = source.match(/refEntries\s*=\s*useMemo\([\s\S]*?resolveSlotEntries\(([^)]*)\)/);
    const ctxCallMatch = source.match(/ctxEntries\s*=\s*useMemo\([\s\S]*?resolveSlotEntries\(([^)]*)\)/);
    expect(refCallMatch, 'refEntries useMemo not found').not.toBeNull();
    expect(ctxCallMatch, 'ctxEntries useMemo not found').not.toBeNull();
    expect(refCallMatch![1]).toContain('codebaseHasFiles');
    expect(ctxCallMatch![1]).toContain('codebaseHasFiles');
  });
});

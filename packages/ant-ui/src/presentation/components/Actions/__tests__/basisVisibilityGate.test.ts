/**
 * Regression tests for the `BasisSummaryBar Section disappears under
 * hasCodebase=true` bug and its sibling `gen-ui-figma Section appears
 * with empty rows on service domain`. Pins the dual-SSOT contract:
 *
 *   - **Section visibility** (`ActionConfigView.tsx` Section gate +
 *     `ActionsPanel.tsx` basis-edit render gate) → consults
 *     `listActiveTiers(slot, domain)` with an *empty runtime context*.
 *     Static slot × TIER_DOMAIN_MATRIX gate only; runtime suppressors
 *     (`hasCodebase`, `hasUiDoc`, backend stack) MUST NOT hide the
 *     Section or block the wizard from mounting, because the user must
 *     keep a manual override entry-point. Re-coupling these two gates to
 *     runtime suppressors re-introduces the regression where users with
 *     an existing codebase have no way to open the wizard at all.
 *
 *   - **Row / step content** (`BasisSummaryBar` tier rows,
 *     `useBasisWizard` tabs + steps) and **routing**
 *     (`decideActionsStepAfterIntent`) → consult
 *     `listActiveTiers(slot, domain, runtime)` with the real workspace
 *     runtime context. `hasCodebase=true` collapses techTier + visualTier
 *     so an existing project is never re-prompted for a stack its own code
 *     already decided; the summary bar swaps in the detected
 *     `ProjectProfile` (`DetectedProfileRow`) instead.
 *
 *   - **Manual override** — the deliberate edit path sets
 *     `basisEditOverride`, which the wizard forwards as
 *     `{ hasCodebase: false }`, restoring the full static tier set.
 *     Without it the override link would open a wizard with nothing in it.
 */

import { describe, it, expect } from 'vitest';
import { getConfigSlots, listActiveTiers, type IntentId, type Domain } from '@ant/shared';

const visibilityCount = (intent: IntentId, domain: Domain): number =>
  listActiveTiers(getConfigSlots(intent)?.basis, domain).length;

const activeWithCodebase = (intent: IntentId, domain: Domain): string[] =>
  listActiveTiers(getConfigSlots(intent)?.basis, domain, { hasCodebase: true });

describe('Basis visibility gate — static slot × domain matrix (no runtime suppressors)', () => {
  describe('Section MUST render — manual override entry must survive runtime suppression', () => {
    it('gen-ui-desc on service → visualTier passes', () => {
      // UI_TIERS = ['visualTier']
      expect(visibilityCount('gen-ui-desc', 'service')).toBeGreaterThan(0);
    });

    it('gen-code-sys on service → techTier + visualTier pass (game tier domain-blocked)', () => {
      // CODE_TIERS = ['techTier','visualTier','gameArtTier']
      expect(visibilityCount('gen-code-sys', 'service')).toBeGreaterThan(0);
    });

    it('gen-code-spec on service → passes', () => {
      expect(visibilityCount('gen-code-spec', 'service')).toBeGreaterThan(0);
    });

    it('gen-code-directive on service → passes', () => {
      expect(visibilityCount('gen-code-directive', 'service')).toBeGreaterThan(0);
    });
  });

  describe('Section MUST stay hidden — declared tiers are all domain-blocked or empty', () => {
    it('gen-ui-figma on service → 0 (empty static tiers)', () => {
      // gen-ui-figma's basis.tiers === [] because figma is the visual
      // authority — the wizard would add nothing → 0 tiers → Section
      // hidden. Without this the Section would render an anonymous
      // "Configure" CTA which the user explicitly does NOT want here.
      expect(visibilityCount('gen-ui-figma', 'service')).toBe(0);
    });

    it('rev-plan on service → 0 (basis.tiers absent)', () => {
      expect(visibilityCount('rev-plan', 'service')).toBe(0);
    });

    it('explain-plan on service → 0', () => {
      expect(visibilityCount('explain-plan', 'service')).toBe(0);
    });
  });

  describe('Game domain — game-only tiers unlock', () => {
    it('gen-game-art-desc on game → gameArtTier passes', () => {
      // GAME_ART_TIERS = ['gameArtTier']; game-only, unlocks on game domain.
      expect(visibilityCount('gen-game-art-desc', 'game')).toBeGreaterThan(0);
    });

    it('gen-code-sys on game → techTier + gameArtTier pass (visualTier is service-only)', () => {
      expect(visibilityCount('gen-code-sys', 'game')).toBeGreaterThan(0);
    });
  });
});

describe('Codebase suppression — runtime gate feeding rows / steps / routing', () => {
  // The stack an existing project uses is a fact its manifests already
  // encode, and its stylesheets / tokens already carry a visual identity —
  // re-prompting for either is the "steps get tangled" bug.
  it.each<[IntentId, Domain, string[]]>([
    ['gen-code-sys', 'service', []],
    ['gen-code-spec', 'service', []],
    ['gen-code-directive', 'service', []],
    ['gen-sys-fe', 'service', []],
    ['gen-ui-desc', 'service', []],
    // game: techTier suppressed, visualTier domain-blocked, art survives —
    // the wizard must land straight on gameArtTier, not walk techTier first.
    ['gen-code-sys', 'game', ['gameArtTier']],
    ['gen-game-art-desc', 'game', ['gameArtTier']],
  ])('%s on %s with an existing codebase → %j', (intent, domain, expected) => {
    expect(activeWithCodebase(intent, domain)).toEqual(expected);
  });

  it('greenfield keeps the full static set (no suppression)', () => {
    expect(listActiveTiers(getConfigSlots('gen-code-sys')?.basis, 'service', { hasCodebase: false }))
      .toEqual(['techTier', 'visualTier']);
  });

  it('manual override (hasCodebase:false) restores what the suppressor hid', () => {
    // What `BasisWizard allowSuppressedTiers` forwards. Must equal the static
    // visibility set, otherwise the override link opens an empty wizard.
    const overridden = listActiveTiers(
      getConfigSlots('gen-code-sys')?.basis,
      'service',
      { hasCodebase: false },
    );
    expect(overridden.length).toBe(visibilityCount('gen-code-sys', 'service'));
  });
});

describe('useBasisWizard funnels every tier through the matrix', () => {
  const wizardSource = (
    import.meta.glob('/src/presentation/components/Actions/basis/useBasisWizard.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
  )['/src/presentation/components/Actions/basis/useBasisWizard.ts'];

  it('has no raw slot.tiers check that bypasses the gate', () => {
    // The original defect: `hasTechTier` read `basisSlot.tiers?.includes(...)`
    // directly, so `computeTechSteps` kept emitting Stack → Language →
    // Framework even after the matrix closed techTier.
    expect(wizardSource).toBeTruthy();
    expect(wizardSource).not.toMatch(/basisSlot\.tiers\?\.includes/);
  });

  it('derives its tier set from the useActiveTiers facade', () => {
    expect(wizardSource).toMatch(/useActiveTiers\s*\(/);
  });
});

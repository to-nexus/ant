/**
 * Axis: what text becomes a job's `overrideDirective` when a BUILD action runs.
 *
 * The regression this exists for: universal BUILD used to mint the directive
 * from `CustomIntentDef.infer` — the inference criterion already rendered into
 * the Intent Catalog every turn. That posted third-person criterion prose as
 * the user's own message and, because `orchestrator.ts` sniffs the turn locale
 * off the directive (`/[가-힣]/`), dragged the whole turn to the author's file
 * language. The type now makes the first half unreachable (the footer takes an
 * intent id, not a def); these rows guard the locale half, which no type can.
 *
 * i18next is instantiated for real, with production's `fallbackLng: 'ko'`,
 * because that fallback resolves BEFORE an inline `defaultValue` — a key that
 * ships in `ko` only would silently hand English users Korean copy.
 */

import { describe, it, expect } from 'vitest';
import i18next, { type TFunction } from 'i18next';
import * as fs from 'fs';
import * as path from 'path';
import { canonicalBuildDirective, universalBuildDirective } from '../buildDirective';

const LOCALES_DIR = path.join(__dirname, '../../../../i18n/locales');
const load = (locale: string) =>
  JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'actions.json'), 'utf-8'));

async function translator(lng: 'en' | 'ko'): Promise<TFunction> {
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    fallbackLng: 'ko', // production parity — see the header note
    ns: ['actions'],
    defaultNS: 'actions',
    resources: { en: { actions: load('en') }, ko: { actions: load('ko') } },
    interpolation: { escapeValue: false },
  });
  return inst.t;
}

const HANGUL = /[가-힣]/;
const LANGS = ['en', 'ko'] as const;

describe('universalBuildDirective — one template, every custom intent', () => {
  // Author-written criterion prose. Never allowed to reach the directive.
  const CRITERION =
    'User asks for an exhaustive, written analysis of one topic — "analyze", "deep dive", "full report".';

  it.each(LANGS)('%s: the directive is the localized template, not the criterion', async (lng) => {
    const t = await translator(lng);
    const directive = universalBuildDirective({ intentId: 'deep-dive', t });

    expect(directive).not.toContain(CRITERION);
    expect(directive).toContain('deep-dive');
    // Not a bare id, and not an unresolved key / unsubstituted placeholder.
    expect(directive).not.toBe('deep-dive');
    expect(directive).not.toContain('universal.buildDirective');
    expect(directive).not.toContain('{{');
  });

  // Binds `composition/orchestrator.ts`'s Hangul locale sniff: the directive's
  // language must be the UI's, and intent ids are ASCII (CUSTOM_ID_PATTERN) so
  // interpolation can never contaminate it.
  it('en renders with no Hangul — the turn must not be sniffed as ko', async () => {
    const t = await translator('en');
    expect(HANGUL.test(universalBuildDirective({ intentId: 'deep-dive', t }))).toBe(false);
  });

  it('ko renders Hangul — the turn must not be sniffed as en', async () => {
    const t = await translator('ko');
    expect(HANGUL.test(universalBuildDirective({ intentId: 'deep-dive', t }))).toBe(true);
  });
});

describe('canonicalBuildDirective — authored i18n → catalog copy → fallback', () => {
  it('uses the authored per-intent directive', async () => {
    const t = await translator('ko');
    expect(canonicalBuildDirective({ intentId: 'gen-spec', domain: undefined, lang: 'ko', t }))
      .toBe(t('buildDirective.gen-spec'));
  });

  it.each(LANGS)('%s: a game workspace resolves the _game context variant', async (lng) => {
    const t = await translator(lng);
    const game = canonicalBuildDirective({ intentId: 'gen-plan', domain: 'game', lang: lng, t });
    const service = canonicalBuildDirective({ intentId: 'gen-plan', domain: 'service', lang: lng, t });
    expect(game).toBe(t('buildDirective.gen-plan_game'));
    expect(game).not.toBe(service);
  });

  // A persisted session can still carry a retired id; `deriveFromIntent`
  // normalizes it, so the directive must agree or the run's stated goal and its
  // routing disagree.
  it('normalizes a legacy intent id instead of collapsing to the button label', async () => {
    const t = await translator('ko');
    const directive = canonicalBuildDirective({ intentId: 'rev-code', domain: undefined, lang: 'ko', t });
    expect(directive).toBe(t('buildDirective.gen-code-directive'));
    expect(directive).not.toBe(t('footer.build'));
  });

  it('falls back to the catalog description when no directive key exists', async () => {
    const t = await translator('ko');
    const directive = canonicalBuildDirective({ intentId: 'rev-spec', domain: undefined, lang: 'ko', t });
    expect(t('buildDirective.rev-spec', { defaultValue: '' })).toBe('');
    expect(directive).not.toBe(t('footer.build'));
    expect(directive.length).toBeGreaterThan(0);
  });

  it('honors a caller fallback ahead of the button label for an unknown id', async () => {
    const t = await translator('ko');
    expect(
      canonicalBuildDirective({ intentId: 'not-an-intent', domain: undefined, lang: 'ko', t, fallback: 'Implement x.md' }),
    ).toBe('Implement x.md');
  });
});

describe('tombstone — the footer cannot reach an intent criterion', () => {
  it('ActionFooter neither imports the intent def nor reads a criterion', () => {
    // Comments are stripped so the prop's own explanatory JSDoc — which names
    // `CustomIntentDef` on purpose — does not read as a usage.
    const code = fs
      .readFileSync(path.join(__dirname, '../ActionFooter.tsx'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bCustomIntentDef\b/);
    expect(code).not.toMatch(/\.infer\b/);
  });
});

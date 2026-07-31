import { Pencil, Settings2, Palette, Brush, RotateCcw } from 'lucide-react';
import { useStore } from '@/domain/store';
import type { BasisSlotConfig, Basis, Domain, TierRuntimeContext } from '@ant/shared';
import {
  STACK_OPTIONS, TECH_TIER_LANGUAGES, FRAMEWORK_LABELS,
  VISUAL_LANGUAGE_OPTIONS, SURFACE_SYSTEM_OPTIONS,
  GAME_ENGINE_OPTIONS,
  GAME_ART_CONCEPT_OPTIONS, GAME_ART_PERSPECTIVE_OPTIONS,
  listActiveTiers,
  getEffectiveDomain,
  pathsContainUiDoc,
} from '@ant/shared';
import { useHasCodebase } from '@/application/hooks/features/useActiveTiers';
import { TierBadge as TierBadgeComponent, type TierBadgeData } from './TierBadge';
import { DetectedProfileRow } from './DetectedProfileRow';
import type { TierKey } from './types';

export interface TierBadgeRow {
  tierKey: TierKey;
  badges: TierBadgeData[];
  subLabel?: string;
  /**
   * The row is fully locked by the intent matrix (currently:
   * techTier when `BasisSlotConfig.lockedStack` is set). The reset
   * affordance is hidden; edit still navigates so the user can
   * change non-locked fields (language / framework / gameEngine).
   */
  resetDisabled?: boolean;
}

// Domain SSOT: an unset (undefined) field on basis.techTier / basis.visualTier
// means "let decompose auto-detect from the codebase". The wizard, BE
// PromptBuilder, and AutoInjectionResolver already treat undefined as the
// auto-detect signal — so the UI label must read "Auto", not "Not set".
const AUTO_LABEL = { en: 'Auto', ko: '자동' };

const LAYER_KEY_LABELS: Record<string, { en: string; ko: string }> = {
  stack: { en: 'Stack', ko: '스택' },
  language: { en: 'Language', ko: '언어' },
  framework: { en: 'Framework', ko: '프레임워크' },
  gameEngine: { en: 'Engine', ko: '엔진' },
  visualLanguage: { en: 'Visual', ko: '비주얼' },
  surfaceSystem: { en: 'Surface', ko: '서피스' },
  concept: { en: 'Concept', ko: '컨셉' },
  perspective: { en: 'Perspective', ko: '시점' },
};

function keyLabel(key: string, lang: 'en' | 'ko') {
  return LAYER_KEY_LABELS[key]?.[lang] ?? key;
}

export function getTierBadgeRows(
  basis: Basis | undefined,
  basisSlot: BasisSlotConfig,
  lang: 'en' | 'ko',
  opts: {
    draftBasis?: Basis;
    /** Suppressor inputs. `techTier` is filled from the displayed basis when
     *  omitted so callers only pass what they actually know. */
    runtime?: Omit<TierRuntimeContext, 'techTier'>;
    domain?: Domain;
  } = {},
): TierBadgeRow[] {
  const { draftBasis, runtime, domain } = opts;
  const rows: TierBadgeRow[] = [];
  const display = draftBasis ?? basis;
  const saved = basis;
  const effectiveDomain = getEffectiveDomain(domain);
  // SSOT D27 — single facade call replaces the four per-tier
  // `isTierActive` calls that used to inline the gate computation. Active
  // set is queried once and consulted by membership below.
  const active = new Set(
    listActiveTiers(basisSlot, effectiveDomain, { ...runtime, techTier: display?.techTier }),
  );

  if (active.has('techTier')) {
    const tc = display?.techTier;
    const isFullstack = tc?.stack === 'fullstack';
    const showGameEngine = effectiveDomain === 'game';
    const lockedStack = basisSlot.lockedStack;

    if (isFullstack) {
      const buildSideBadges = (
        tier: typeof tc extends undefined ? undefined : NonNullable<typeof tc>['frontend'],
        savedTier: typeof saved extends undefined ? undefined : NonNullable<NonNullable<typeof saved>['techTier']>['frontend'],
        side: 'frontend' | 'backend',
      ): TierBadgeData[] => {
        const badges: TierBadgeData[] = [];
        if (tier?.language) {
          const opt = TECH_TIER_LANGUAGES.find(o => o.id === tier.language);
          badges.push({ keyLabel: keyLabel('language', lang), label: opt?.label[lang] ?? tier.language, isChanged: draftBasis ? tier.language !== savedTier?.language : false });
        } else {
          badges.push({ keyLabel: keyLabel('language', lang), label: AUTO_LABEL[lang], isAuto: true });
        }
        if (tier?.framework) {
          const lbl = FRAMEWORK_LABELS[tier.framework];
          badges.push({ keyLabel: keyLabel('framework', lang), label: lbl?.[lang] ?? tier.framework, isChanged: draftBasis ? tier.framework !== savedTier?.framework : false });
        } else {
          badges.push({ keyLabel: keyLabel('framework', lang), label: AUTO_LABEL[lang], isAuto: true });
        }
        // Game engine 5th slot — only meaningful on the frontend tier in
        // fullstack projects (Phaser sub-engine runs in the browser).
        if (showGameEngine && side === 'frontend') {
          if (tier?.gameEngine) {
            const opt = GAME_ENGINE_OPTIONS.find(o => o.id === tier.gameEngine);
            badges.push({ keyLabel: keyLabel('gameEngine', lang), label: opt?.label[lang] ?? tier.gameEngine, isChanged: draftBasis ? tier.gameEngine !== savedTier?.gameEngine : false });
          } else {
            badges.push({ keyLabel: keyLabel('gameEngine', lang), label: AUTO_LABEL[lang], isAuto: true });
          }
        }
        return badges;
      };

      // FE row carries an inline locked-stack badge (e.g. gen-sys-full)
      // so the user sees the immutable scope decision next to the
      // editable language/framework badges.
      const lockedBadge: TierBadgeData[] = lockedStack
        ? [{
            keyLabel: keyLabel('stack', lang),
            label: STACK_OPTIONS.find(o => o.id === lockedStack)?.label[lang] ?? lockedStack,
            isLocked: true,
          }]
        : [];
      const feBadges = [...lockedBadge, ...buildSideBadges(tc?.frontend, saved?.techTier?.frontend, 'frontend')];
      rows.push({ tierKey: 'techTier', subLabel: 'FE', badges: feBadges, resetDisabled: !!lockedStack });
      rows.push({ tierKey: 'techTier', subLabel: 'BE', badges: buildSideBadges(tc?.backend, saved?.techTier?.backend, 'backend'), resetDisabled: !!lockedStack });
    } else {
      const badges: TierBadgeData[] = [];
      if (tc?.stack) {
        const opt = STACK_OPTIONS.find(o => o.id === tc.stack);
        badges.push({
          keyLabel: keyLabel('stack', lang),
          label: opt?.label[lang] ?? tc.stack,
          isChanged: draftBasis ? tc.stack !== saved?.techTier?.stack : false,
          isLocked: !!lockedStack,
        });
      } else {
        badges.push({ keyLabel: keyLabel('stack', lang), label: AUTO_LABEL[lang], isAuto: true });
      }

      const tier = tc?.frontend ?? tc?.backend;
      const savedTier = saved?.techTier?.frontend ?? saved?.techTier?.backend;
      if (tier?.language) {
        const opt = TECH_TIER_LANGUAGES.find(o => o.id === tier.language);
        badges.push({ keyLabel: keyLabel('language', lang), label: opt?.label[lang] ?? tier.language, isChanged: draftBasis ? tier.language !== savedTier?.language : false });
      } else if (tc) {
        badges.push({ keyLabel: keyLabel('language', lang), label: AUTO_LABEL[lang], isAuto: true });
      }
      if (tier?.framework) {
        const lbl = FRAMEWORK_LABELS[tier.framework];
        badges.push({ keyLabel: keyLabel('framework', lang), label: lbl?.[lang] ?? tier.framework, isChanged: draftBasis ? tier.framework !== savedTier?.framework : false });
      } else if (tc) {
        badges.push({ keyLabel: keyLabel('framework', lang), label: AUTO_LABEL[lang], isAuto: true });
      }
      // game-domain only — gameEngine 5th slot, frontend stack only.
      if (showGameEngine && tc?.stack === 'frontend') {
        if (tier?.gameEngine) {
          const opt = GAME_ENGINE_OPTIONS.find(o => o.id === tier.gameEngine);
          badges.push({ keyLabel: keyLabel('gameEngine', lang), label: opt?.label[lang] ?? tier.gameEngine, isChanged: draftBasis ? tier.gameEngine !== savedTier?.gameEngine : false });
        } else if (tc) {
          badges.push({ keyLabel: keyLabel('gameEngine', lang), label: AUTO_LABEL[lang], isAuto: true });
        }
      }

      rows.push({ tierKey: 'techTier', badges, resetDisabled: !!lockedStack });
    }
  }

  if (active.has('visualTier')) {
    const badges: TierBadgeData[] = [];
    const vt = display?.visualTier;

    const visLayers = [
      { key: 'visualLanguage' as const, options: VISUAL_LANGUAGE_OPTIONS },
      { key: 'surfaceSystem' as const, options: SURFACE_SYSTEM_OPTIONS },
    ];

    for (const { key, options } of visLayers) {
      const val = vt?.[key] as string | undefined;
      if (val) {
        const opt = options.find(o => o.id === val);
        const label = opt?.label[lang] ?? val;
        const savedVal = saved?.visualTier?.[key] as string | undefined;
        badges.push({ keyLabel: keyLabel(key, lang), label, isChanged: draftBasis ? val !== savedVal : false });
      } else {
        badges.push({ keyLabel: keyLabel(key, lang), label: AUTO_LABEL[lang], isAuto: true });
      }
    }

    rows.push({ tierKey: 'visualTier', badges });
  }

  if (active.has('gameArtTier')) {
    const badges: TierBadgeData[] = [];
    const gat = display?.gameArtTier;
    const gameArtLayers = [
      { key: 'concept' as const, options: GAME_ART_CONCEPT_OPTIONS },
      { key: 'perspective' as const, options: GAME_ART_PERSPECTIVE_OPTIONS },
    ];
    for (const { key, options } of gameArtLayers) {
      const val = gat?.[key] as string | undefined;
      if (val) {
        const opt = options.find(o => o.id === val);
        const label = opt?.label[lang] ?? val;
        const savedVal = saved?.gameArtTier?.[key] as string | undefined;
        badges.push({ keyLabel: keyLabel(key, lang), label, isChanged: draftBasis ? val !== savedVal : false });
      } else {
        badges.push({ keyLabel: keyLabel(key, lang), label: AUTO_LABEL[lang], isAuto: true });
      }
    }
    rows.push({ tierKey: 'gameArtTier', badges });
  }

  return rows;
}

const TIER_ICON: Record<TierKey, typeof Settings2> = {
  techTier: Settings2,
  visualTier: Palette,
  gameArtTier: Brush,
};

const TIER_ICON_COLOR: Record<TierKey, string> = {
  techTier: 'var(--violet-500)',
  visualTier: 'var(--pink-500)',
  gameArtTier: 'var(--amber-500)',
};

interface BasisSummaryBarProps {
  basisSlot: BasisSlotConfig;
  onEdit?: () => void;
  onEditTier?: (tierKey: TierKey) => void;
  onResetTier?: (tierKey: TierKey) => void;
  lang: 'en' | 'ko';
  draftBasis?: Basis;
  savedBasis?: Basis;
  mode?: 'default' | 'inline';
}

function TierRow({ row, onReset, onEdit, hasValues }: { row: TierBadgeRow; onReset?: () => void; onEdit?: () => void; hasValues?: boolean }) {
  const Icon = TIER_ICON[row.tierKey];
  const color = TIER_ICON_COLOR[row.tierKey];
  // Locked rows still surface the edit button (user can change non-stack
  // fields like language / framework) but hide reset because resetting
  // would destroy the matrix-pinned stack value.
  const showReset = !!onReset && hasValues && !row.resetDisabled;

  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      {row.subLabel && (
        <span
          className="text-[10px] font-semibold shrink-0 w-5"
          style={{ color: 'var(--text-3)' }}
        >
          {row.subLabel}
        </span>
      )}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        {row.badges.map((badge, idx) => (
          <TierBadgeComponent key={idx} badge={badge} variant={row.tierKey} />
        ))}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {showReset && (
          <button
            type="button"
            onClick={onReset}
            className="p-1 rounded transition-colors hover:bg-[color:var(--bg-surface-2)]"
            style={{ color: 'var(--text-3)' }}
            aria-label="Reset tier"
            title={(() => {
              switch (row.tierKey) {
                case 'techTier': return 'Reset Tech Tier';
                case 'visualTier': return 'Reset Visual Tier';
                case 'gameArtTier': return 'Reset Game Art Tier';
              }
            })()}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="p-1 rounded transition-colors hover:bg-[color:var(--bg-surface-2)]"
            style={{ color: 'var(--text-3)' }}
            aria-label="Edit tier"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function BasisSummaryBar({ basisSlot, onEdit, onEditTier, onResetTier, lang, draftBasis, savedBasis, mode = 'default' }: BasisSummaryBarProps) {
  const actionMetadata = useStore(s => s.actionMetadata);
  const basis = mode === 'inline' ? (savedBasis ?? actionMetadata.basis) : actionMetadata.basis;
  // User-included UI design doc in RAC (refs or context) closes the Visual
  // Tier row: the doc IS the design-system authority. Tier matrix gate
  // (`isTierActive`) consults `hasUiDoc` via runtime suppressors.
  const hasUiDoc = pathsContainUiDoc([
    ...(actionMetadata.refs ?? []),
    ...(actionMetadata.context ?? []),
  ]);
  // D27 — an existing codebase implicitly fixes techTier (its manifests) and
  // visualTier (its stylesheets / tokens). Inside the wizard (`inline`) the
  // user is already overriding on purpose, so the suppressor stays off there.
  const hasCodebase = useHasCodebase() && mode !== 'inline';
  const rows = getTierBadgeRows(basis, basisSlot, lang, {
    draftBasis,
    runtime: { hasUiDoc, hasCodebase },
    domain: actionMetadata.domain,
  });
  // Anything the codebase suppressor closed is represented by the detected
  // project profile instead of a re-prompt. Compared on TIERS, not rows —
  // a fullstack techTier renders two rows (FE / BE) for a single tier.
  const runtimeWithoutCodebase = {
    techTier: (draftBasis ?? basis)?.techTier,
    hasUiDoc,
  };
  const effectiveDomain = getEffectiveDomain(actionMetadata.domain);
  const suppressedByCodebase =
    hasCodebase &&
    listActiveTiers(basisSlot, effectiveDomain, runtimeWithoutCodebase).length >
      listActiveTiers(basisSlot, effectiveDomain, { ...runtimeWithoutCodebase, hasCodebase }).length;

  // Empty-rows fallback — when every tier is closed by the matrix (and the
  // codebase suppressor is not the reason) there is nothing to enumerate, so
  // we surface a single dashed CTA that still hands the user into the wizard
  // (manual override entry). When at least one tier row exists, render it
  // as-is — its per-layer "Auto" badges and per-row edit pencil already
  // convey the unset state without collapsing the whole bar into one
  // anonymous button.
  if (mode === 'default' && rows.length === 0 && !suppressedByCodebase) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors"
        style={{
          border: '1px dashed var(--border-2)',
          color: 'var(--text-3)',
        }}
      >
        <Settings2 className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">
          {lang === 'ko' ? '기술/디자인 프리셋 설정' : 'Configure tech/design preset'}
        </span>
      </button>
    );
  }

  const tierHasValues = (tierKey: TierKey) => {
    switch (tierKey) {
      case 'techTier': return !!basis?.techTier;
      case 'visualTier': return !!basis?.visualTier;
      case 'gameArtTier': return !!basis?.gameArtTier;
    }
  };

  const resolveEditHandler = (tierKey: TierKey) => {
    if (mode !== 'default') return undefined;
    if (onEditTier) return () => onEditTier(tierKey);
    if (onEdit) return onEdit;
    return undefined;
  };

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg px-3 py-2"
      style={
        mode === 'inline'
          ? undefined
          : { background: 'var(--bg-surface-2)', border: '1px solid var(--border-2)' }
      }
    >
      {suppressedByCodebase && (
        <DetectedProfileRow lang={lang} onOverride={mode === 'default' ? onEdit : undefined} />
      )}
      {rows.map(row => (
        <TierRow
          key={`${row.tierKey}${row.subLabel ? `-${row.subLabel}` : ''}`}
          row={row}
          onReset={mode === 'default' && onResetTier ? () => onResetTier(row.tierKey) : undefined}
          onEdit={resolveEditHandler(row.tierKey)}
          hasValues={tierHasValues(row.tierKey)}
        />
      ))}
    </div>
  );
}

import { Pencil, Settings2, Palette, RotateCcw } from 'lucide-react';
import { useStore } from '@/domain/store';
import type { BasisSlotConfig, Basis } from '@ant/shared';
import {
  STACK_OPTIONS, TECH_TIER_LANGUAGES, FRAMEWORK_LABELS,
  VISUAL_LANGUAGE_OPTIONS, SURFACE_SYSTEM_OPTIONS, SPATIAL_SYSTEM_OPTIONS,
} from '@ant/shared';
import { TierBadge as TierBadgeComponent, type TierBadgeData } from './TierBadge';

export interface TierBadgeRow {
  tierKey: 'techTier' | 'visualTier';
  badges: TierBadgeData[];
  subLabel?: string;
}

const NOT_SET_LABEL = { en: 'Not set', ko: '미설정' };

const LAYER_KEY_LABELS: Record<string, { en: string; ko: string }> = {
  stack: { en: 'Stack', ko: '스택' },
  language: { en: 'Language', ko: '언어' },
  framework: { en: 'Framework', ko: '프레임워크' },
  visualLanguage: { en: 'Visual', ko: '비주얼' },
  surfaceSystem: { en: 'Surface', ko: '서피스' },
  spatialSystem: { en: 'Spatial', ko: '공간' },
};

function keyLabel(key: string, lang: 'en' | 'ko') {
  return LAYER_KEY_LABELS[key]?.[lang] ?? key;
}

export function getTierBadgeRows(
  basis: Basis | undefined,
  basisSlot: BasisSlotConfig,
  lang: 'en' | 'ko',
  draftBasis?: Basis,
): TierBadgeRow[] {
  const rows: TierBadgeRow[] = [];
  const display = draftBasis ?? basis;
  const saved = basis;

  if (basisSlot.techTier) {
    const tc = display?.techTier;
    const isFullstack = tc?.stack === 'fullstack';

    if (isFullstack) {
      const buildSideBadges = (
        tier: typeof tc extends undefined ? undefined : NonNullable<typeof tc>['frontend'],
        savedTier: typeof saved extends undefined ? undefined : NonNullable<NonNullable<typeof saved>['techTier']>['frontend'],
      ): TierBadgeData[] => {
        const badges: TierBadgeData[] = [];
        if (tier?.language) {
          const opt = TECH_TIER_LANGUAGES.find(o => o.id === tier.language);
          badges.push({ keyLabel: keyLabel('language', lang), label: opt?.label[lang] ?? tier.language, isChanged: draftBasis ? tier.language !== savedTier?.language : false });
        } else {
          badges.push({ keyLabel: keyLabel('language', lang), label: NOT_SET_LABEL[lang], isAuto: true });
        }
        if (tier?.framework) {
          const lbl = FRAMEWORK_LABELS[tier.framework];
          badges.push({ keyLabel: keyLabel('framework', lang), label: lbl?.[lang] ?? tier.framework, isChanged: draftBasis ? tier.framework !== savedTier?.framework : false });
        } else {
          badges.push({ keyLabel: keyLabel('framework', lang), label: NOT_SET_LABEL[lang], isAuto: true });
        }
        return badges;
      };

      rows.push({ tierKey: 'techTier', subLabel: 'FE', badges: buildSideBadges(tc?.frontend, saved?.techTier?.frontend) });
      rows.push({ tierKey: 'techTier', subLabel: 'BE', badges: buildSideBadges(tc?.backend, saved?.techTier?.backend) });
    } else {
      const badges: TierBadgeData[] = [];
      if (tc?.stack) {
        const opt = STACK_OPTIONS.find(o => o.id === tc.stack);
        badges.push({ keyLabel: keyLabel('stack', lang), label: opt?.label[lang] ?? tc.stack, isChanged: draftBasis ? tc.stack !== saved?.techTier?.stack : false });
      } else {
        badges.push({ keyLabel: keyLabel('stack', lang), label: NOT_SET_LABEL[lang], isAuto: true });
      }

      const tier = tc?.frontend ?? tc?.backend;
      const savedTier = saved?.techTier?.frontend ?? saved?.techTier?.backend;
      if (tier?.language) {
        const opt = TECH_TIER_LANGUAGES.find(o => o.id === tier.language);
        badges.push({ keyLabel: keyLabel('language', lang), label: opt?.label[lang] ?? tier.language, isChanged: draftBasis ? tier.language !== savedTier?.language : false });
      } else if (tc) {
        badges.push({ keyLabel: keyLabel('language', lang), label: NOT_SET_LABEL[lang], isAuto: true });
      }
      if (tier?.framework) {
        const lbl = FRAMEWORK_LABELS[tier.framework];
        badges.push({ keyLabel: keyLabel('framework', lang), label: lbl?.[lang] ?? tier.framework, isChanged: draftBasis ? tier.framework !== savedTier?.framework : false });
      } else if (tc) {
        badges.push({ keyLabel: keyLabel('framework', lang), label: NOT_SET_LABEL[lang], isAuto: true });
      }

      rows.push({ tierKey: 'techTier', badges });
    }
  }

  if (basisSlot.visualTier) {
    const badges: TierBadgeData[] = [];
    const vt = display?.visualTier;

    const visLayers = [
      { key: 'visualLanguage' as const, options: VISUAL_LANGUAGE_OPTIONS },
      { key: 'surfaceSystem' as const, options: SURFACE_SYSTEM_OPTIONS },
      { key: 'spatialSystem' as const, options: SPATIAL_SYSTEM_OPTIONS },
    ];

    for (const { key, options } of visLayers) {
      const val = vt?.[key] as string | undefined;
      if (val) {
        const opt = options.find(o => o.id === val);
        const label = opt?.label[lang] ?? val;
        const savedVal = saved?.visualTier?.[key] as string | undefined;
        badges.push({ keyLabel: keyLabel(key, lang), label, isChanged: draftBasis ? val !== savedVal : false });
      } else {
        badges.push({ keyLabel: keyLabel(key, lang), label: NOT_SET_LABEL[lang], isAuto: true });
      }
    }

    rows.push({ tierKey: 'visualTier', badges });
  }

  return rows;
}

const TIER_ICON = {
  techTier: Settings2,
  visualTier: Palette,
} as const;

const TIER_ICON_COLOR = {
  techTier: 'text-violet-500 dark:text-violet-400',
  visualTier: 'text-pink-500 dark:text-pink-400',
} as const;

interface BasisSummaryBarProps {
  basisSlot: BasisSlotConfig;
  onEdit?: () => void;
  onEditTier?: (tierKey: 'techTier' | 'visualTier') => void;
  onResetTier?: (tierKey: 'techTier' | 'visualTier') => void;
  lang: 'en' | 'ko';
  draftBasis?: Basis;
  savedBasis?: Basis;
  mode?: 'default' | 'inline';
}

function TierRow({ row, onReset, onEdit, hasValues }: { row: TierBadgeRow; onReset?: () => void; onEdit?: () => void; hasValues?: boolean }) {
  const Icon = TIER_ICON[row.tierKey];
  const color = TIER_ICON_COLOR[row.tierKey];

  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
      {row.subLabel && (
        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 shrink-0 w-5">
          {row.subLabel}
        </span>
      )}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        {row.badges.map((badge, idx) => (
          <TierBadgeComponent key={idx} badge={badge} variant={row.tierKey} />
        ))}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {onReset && hasValues && (
          <button
            type="button"
            onClick={onReset}
            className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            aria-label="Reset tier"
            title={row.tierKey === 'techTier' ? 'Reset Tech Tier' : 'Reset Visual Tier'}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
  const rows = getTierBadgeRows(basis, basisSlot, lang, draftBasis);
  const hasAnyBadge = rows.some(r => r.badges.some(b => !b.isAuto));

  if (mode === 'default' && !hasAnyBadge && !draftBasis) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <Settings2 className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">
          {lang === 'ko' ? '기술/디자인 프리셋 설정' : 'Configure tech/design preset'}
        </span>
      </button>
    );
  }

  const tierHasValues = (tierKey: 'techTier' | 'visualTier') => {
    if (tierKey === 'techTier') return !!basis?.techTier;
    return !!basis?.visualTier;
  };

  const resolveEditHandler = (tierKey: 'techTier' | 'visualTier') => {
    if (mode !== 'default') return undefined;
    if (onEditTier) return () => onEditTier(tierKey);
    if (onEdit) return onEdit;
    return undefined;
  };

  return (
    <div className={`flex flex-col gap-1.5 rounded-lg px-3 py-2 ${
      mode === 'inline'
        ? ''
        : 'bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50'
    }`}>
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

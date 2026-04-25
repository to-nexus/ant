import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  type BasisSlotConfig,
  type Domain,
  TIER_DOMAIN_MATRIX,
} from '@ant/shared';
import { Globe } from 'lucide-react';

interface DomainToggleProps {
  basisSlot?: BasisSlotConfig;
  className?: string;
}

/**
 * Phase 1 (D11) — explicit project-domain selector.
 *
 * Renders only when the slot opts into the `'domain'` tier. Selecting
 * `game` / `service` writes `actionMetadata.domain`, which the detect
 * pipeline reads to bypass LLM domain inference (10.2 — explicit > infer).
 *
 * The toggle resets domain-heterogeneous basis selections. Switching from
 * service to game wipes the existing `gameContentTier` / `artTier`
 * preset (and vice-versa for the gameEngine 5th slot) so the wizard
 * starts from a clean state appropriate for the new domain.
 */
export function DomainToggle({ basisSlot, className }: DomainToggleProps) {
  const { t } = useTranslation('actions');
  const actionMetadata = useStore(s => s.actionMetadata);
  const updateActionMetadata = useStore(s => s.updateActionMetadata);

  // Static gate — only render when the slot opts into the `domain` tier
  // and the matrix recognises at least one domain. The runtime visibility
  // of the toggle therefore lives in the same SSOT as the rest of the
  // wizard: the BasisSlotConfig matrix.
  if (!basisSlot?.tiers?.includes('domain')) return null;
  const domains: ReadonlyArray<Domain> = TIER_DOMAIN_MATRIX.domain;
  if (domains.length < 2) return null;

  const current = actionMetadata.domain;

  const handleSelect = useCallback((next: Domain | undefined) => {
    if (current === next) return;
    // Reset domain-heterogeneous basis fields when crossing domains.
    // game ⇄ service swap erases tier-specific picks the user made for
    // the previous domain (gameContentTier, artTier, gameEngine).
    const prevBasis = actionMetadata.basis;
    let nextBasis = prevBasis;
    if (prevBasis) {
      const cleaned = { ...prevBasis };
      if (next !== 'game') {
        cleaned.artTier = undefined;
        cleaned.gameContentTier = undefined;
        if (cleaned.techTier?.frontend) {
          cleaned.techTier = {
            ...cleaned.techTier,
            frontend: { ...cleaned.techTier.frontend, gameEngine: undefined },
          };
        }
        if (cleaned.techTier?.backend) {
          cleaned.techTier = {
            ...cleaned.techTier,
            backend: { ...cleaned.techTier.backend, gameEngine: undefined },
          };
        }
      }
      const stillHasAny = cleaned.techTier || cleaned.visualTier || cleaned.artTier || cleaned.gameContentTier;
      nextBasis = stillHasAny ? cleaned : undefined;
    }
    updateActionMetadata({ domain: next, basis: nextBasis });
  }, [current, actionMetadata.basis, updateActionMetadata]);

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <Globe className="w-3.5 h-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300 shrink-0">
        {t('domain.toggle.label')}
      </span>
      <div role="radiogroup" className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 p-0.5 bg-white dark:bg-gray-900">
        {domains.map((d) => {
          const active = current === d;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => handleSelect(active ? undefined : d)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                active
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {t(`domain.toggle.option.${d}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  type Domain,
} from '@ant/shared';
import { Globe } from 'lucide-react';

interface DomainToggleProps {
  className?: string;
  /**
   * When true (Phase 2 — D22), the toggle behaves as the workspace-level
   * domain selector and is always visible. When false (legacy Phase 1
   * usage that still exists at lower wizard depths), the toggle reads
   * `actionMetadata.domain` for backward compatibility but skips the
   * basis-cleanup side-effect.
   *
   * Default: `false` (read-only chip rendering at lower depths).
   */
  topLevel?: boolean;
}

/**
 * Phase 2 (D22) — workspace-level project-domain selector.
 *
 * Always rendered at the ActionsPanel TOP screen. Selecting `game` /
 * `service` writes `actionMetadata.domain` (sticky for the workspace);
 * the detect pipeline reads it to bypass LLM domain inference (10.2 —
 * explicit > infer).
 *
 * Switching domains resets domain-heterogeneous basis selections —
 * service → game wipes `gameContentTier` / `gameArtTier`; the reverse
 * additionally clears the `gameEngine` 5th slot.
 */
// TEMP: `game` 도메인은 아직 개발 중이라 UI에서만 숨긴다 (contract /
// store / matrix / mention 자동완성 등 도메인 분기 로직은 그대로 유지).
// 추후 `game` UI 복원 시 이 배열에 `'game'`을 다시 추가하면 된다.
// 기본 domain이 `'service'`이고 mention 자동완성에 `@domain:`이 빠져 있어
// (D22) 사용자가 `game`을 고를 수 있는 경로 자체가 없으므로 chip 모드까지
// 같은 목록으로 통일해도 안전하다.
const VISIBLE_DOMAINS: ReadonlyArray<Domain> = ['service'];

export function DomainToggle({ className, topLevel = false }: DomainToggleProps) {
  const { t } = useTranslation('actions');
  const actionMetadata = useStore(s => s.actionMetadata);
  const updateActionMetadata = useStore(s => s.updateActionMetadata);

  // Phase 2 (D22): the toggle is always visible at the top level. At lower
  // depths it renders as a read-only chip via the `topLevel === false`
  // branch — `BasisSummaryBar` / `ActionConfigView` show the current
  // domain inline so users can verify it without leaving their wizard.
  const current = actionMetadata.domain;
  const domains = VISIBLE_DOMAINS;

  const handleSelect = useCallback((next: Domain) => {
    if (!topLevel) return; // chip mode is read-only
    if (current === next) return; // active re-click is a no-op (D22: domain is required)
    // The store's `updateActionMetadata` centralizes the domain-transition
    // contract: it cleans up game-only basis tiers + unwinds the wizard
    // when the active action card no longer passes the matrix gate.
    // Same contract is shared by `@domain:` mention.
    updateActionMetadata({ domain: next });
  }, [current, updateActionMetadata, topLevel]);

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
              onClick={() => handleSelect(d)}
              disabled={!topLevel}
              aria-disabled={!topLevel}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                active
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              } ${!topLevel ? 'cursor-default opacity-80' : ''}`}
            >
              {t(`domain.toggle.option.${d}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

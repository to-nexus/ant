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
      <Globe className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blue-500)' }} />
      <span
        className="text-xs font-medium shrink-0"
        style={{ color: 'var(--text-2)' }}
      >
        {t('domain.toggle.label')}
      </span>
      <div
        role="radiogroup"
        className="flex items-center gap-1 rounded-md p-0.5"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)',
        }}
      >
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
                active ? 'font-medium' : ''
              } ${!topLevel ? 'cursor-default opacity-80' : ''}`}
              style={
                active
                  ? {
                      background: 'var(--gradient-violet-pink)',
                      color: 'var(--text-on-brand)',
                    }
                  : { color: 'var(--text-3)' }
              }
            >
              {t(`domain.toggle.option.${d}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

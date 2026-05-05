import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import type { GitOperationError } from '@/domain/git-world';

/**
 * Centralised PAT-class error routing — single source of truth.
 *
 * Both `useGitMenuActions` (top bar dropdown) and `ProjectWizardModal`
 * (clone / init flow) consume this hook so the user always sees the
 * same "Configure PAT" affordance routed to AccountConfig regardless
 * of where the auth failure surfaces.
 *
 * Returns `{ handled: true }` when the routing dialog has been shown,
 * letting callers `return` early instead of bubbling a generic error.
 * `{ handled: false }` means the caller should fall back to its own
 * error display (toast / inline message / generic alert).
 *
 * Why a single hook (not inline `if (err.kind==='auth')`):
 *   - Three sites needed the same dialog (wizard clone, wizard init,
 *     git menu) — diverging strings would confuse users.
 *   - i18n keys + AccountConfig tab id live in one place; renames stay
 *     contained.
 *   - Static lint guard (see Phase 5 tests/wizard/pat-auth-routing
 *     spec) can grep for inline `kind === 'auth'` to prevent
 *     regression.
 */
export function useGitErrorRouting(): (err: GitOperationError | undefined) => { handled: boolean } {
  const { t } = useTranslation('explorer');
  const { showError } = useAlertModalContext();
  const openMainPanelTab = useStore((s) => s.openMainPanelTab);

  return useCallback(
    (err: GitOperationError | undefined) => {
      if (err?.kind === 'auth' || err?.suggestedAction === 'configurePat') {
        showError(t('git.patNotConfigured'), {
          confirmText: t('git.configurePat'),
          onConfirm: () => openMainPanelTab('accountConfig'),
        });
        return { handled: true };
      }
      return { handled: false };
    },
    [showError, openMainPanelTab, t],
  );
}

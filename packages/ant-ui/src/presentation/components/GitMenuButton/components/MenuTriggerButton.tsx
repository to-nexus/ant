import { useTranslation } from 'react-i18next';
import { Github } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';
import { Tooltip } from '@/presentation/components/common/Tooltip';

interface MenuTriggerButtonProps {
  /** When `null`, show the tooltip-wrapped setup guide instead of an
   *  active toggle. Corresponds to `githubRepo` on projectConfig. */
  githubRepo: string | null;
  onToggle: () => void;
  disabled: boolean;
}

/**
 * The GitHub-icon toggle button. Two visual variants, picked by whether
 * a GitHub repo has been declared in the project config:
 *
 *  - `githubRepo === null` → passive button inside a Tooltip explaining
 *    the PAT + repo setup steps. Click is a no-op; the icon is dimmed.
 *  - otherwise → active toggle that opens the dropdown.
 */
export function MenuTriggerButton({
  githubRepo,
  onToggle,
  disabled,
}: MenuTriggerButtonProps) {
  const { t } = useTranslation('explorer');

  if (!githubRepo) {
    return (
      <Tooltip
        content={
          <div className="max-w-xs space-y-2">
            <p className="font-semibold">{t('config:git.repoSetupRequired')}</p>
            <ol className="list-decimal list-inside space-y-1.5 text-xs">
              <li>
                <strong>{t('config:git.setupStep1')}</strong>
                <div className="ml-4 text-[color:var(--text-4)]">{t('config:git.setupStep1Desc')}</div>
              </li>
              <li>
                <strong>{t('config:git.setupStep2')}</strong>
                <div className="ml-4 text-[color:var(--text-4)]">{t('config:git.setupStep2Desc')}</div>
              </li>
            </ol>
            <p className="text-xs text-[color:var(--text-4)] border-t border-[color:var(--border-1)] pt-1.5">{t('config:git.setupComplete')}</p>
          </div>
        }
        placement="bottom"
      >
        <Button
          variant="outline"
          size="sm"
          className="flex items-center justify-center w-[26px] h-[26px] p-0 flex-shrink-0 opacity-50 cursor-pointer"
        >
          <Github className="w-3.5 h-3.5" />
        </Button>
      </Tooltip>
    );
  }

  return (
    <Button
      onClick={onToggle}
      variant="outline"
      size="sm"
      className="flex items-center justify-center w-[26px] h-[26px] p-0 flex-shrink-0"
      disabled={disabled}
      title={t('config:git.management')}
    >
      <Github className="w-3.5 h-3.5" />
    </Button>
  );
}

import { useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Github } from 'lucide-react';
import { Tooltip } from '@/presentation/components/common/Tooltip';

interface MenuTriggerButtonProps {
  /** When `null`, show the tooltip-wrapped setup guide instead of an
   *  active toggle. Corresponds to `githubRepo` on projectConfig. */
  githubRepo: string | null;
  onToggle: () => void;
  disabled: boolean;
}

// 26x26 surface-bordered icon button per handoff b3-explorer.jsx git menu trigger.
const BASE_TRIGGER_STYLE: CSSProperties = {
  width: 26,
  height: 26,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--surface-1)',
  border: '1px solid var(--border-2)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text-2)',
  flexShrink: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

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

  const [hovered, setHovered] = useState(false);
  const handleEnter = (_e: MouseEvent<HTMLButtonElement>) => setHovered(true);
  const handleLeave = (_e: MouseEvent<HTMLButtonElement>) => setHovered(false);

  if (!githubRepo) {
    const style: CSSProperties = {
      ...BASE_TRIGGER_STYLE,
      opacity: 0.6,
      cursor: 'pointer',
      background: hovered ? 'var(--bg-hover)' : BASE_TRIGGER_STYLE.background,
    };
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
        <button
          type="button"
          style={style}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <Github width={13} height={13} />
        </button>
      </Tooltip>
    );
  }

  const style: CSSProperties = {
    ...BASE_TRIGGER_STYLE,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: hovered && !disabled ? 'var(--bg-hover)' : BASE_TRIGGER_STYLE.background,
  };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      style={style}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      title={t('config:git.management')}
    >
      <Github width={13} height={13} />
    </button>
  );
}

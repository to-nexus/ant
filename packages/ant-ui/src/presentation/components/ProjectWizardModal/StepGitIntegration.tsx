import { useState, type CSSProperties } from 'react';
import { KeyRound } from 'lucide-react';
import { Toggle } from '@/presentation/components/aurora';
import { normalizeRepoUrl } from '@/shared/utils/git-utils';
import type { GitSnapshot } from '@ant/shared';

// ─── shared style helpers (Aurora tokens) ──────────────────────────────

const inputBaseStyle = (
  disabled: boolean,
  hasError: boolean,
  focused: boolean,
): CSSProperties => {
  const borderColor = disabled
    ? 'var(--border-1)'
    : hasError
      ? 'var(--red-500, oklch(70% 0.18 25))'
      : focused
        ? 'var(--violet-500)'
        : 'var(--border-2)';
  return {
    background: disabled ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
    color: disabled ? 'var(--text-3)' : 'var(--text-1)',
    border: `1.5px solid ${borderColor}`,
    borderRadius: 'var(--r-lg, 10px)',
    boxShadow: focused && !disabled && !hasError ? '0 0 0 3px oklch(64% 0.20 290 / 0.18)' : 'none',
    cursor: disabled ? 'not-allowed' : 'text',
    outline: 'none',
    transition: 'all 150ms var(--ease-smooth)',
  };
};

function TokenInput({
  value,
  onChange,
  disabled,
  readOnly,
  placeholder,
  hasError = false,
  onKeyDown,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  hasError?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  type?: 'text' | 'password';
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      className="w-full px-3 py-2 text-sm"
      style={inputBaseStyle(!!disabled, hasError, focused)}
    />
  );
}

interface StepGitIntegrationProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  gitEnabled: boolean;
  onGitEnabledChange: (v: boolean) => void;
  readOnly?: boolean;
  gitSnapshot?: GitSnapshot | null;
  patStatus: { configured: boolean; username?: string } | null;
  showPatInput: boolean;
  onShowPatInput: () => void;
  patInput: string;
  onPatInputChange: (v: string) => void;
  patSaving: boolean;
  patError: string | null;
  onSavePat: () => void;
  repositoryName: string;
  onRepositoryNameChange: (v: string) => void;
  onRepoManualEdit: () => void;
  gitUrl: string;
  onGitUrlChange: (v: string) => void;
  gitUrlFromConfig: boolean;
  ownerInfo: { orgOwner?: string; personalOwner?: string };
  activeOwner: 'org' | 'personal' | null;
  onApplyOwner: (owner: string) => void;
  gitAction: 'none' | 'clone' | 'init';
  onGitActionChange: (action: 'clone' | 'init') => void;
}

export function StepGitIntegration({
  t, gitEnabled, onGitEnabledChange, readOnly, gitSnapshot,
  patStatus, showPatInput, onShowPatInput,
  patInput, onPatInputChange, patSaving, patError, onSavePat,
  repositoryName, onRepositoryNameChange, onRepoManualEdit,
  gitUrl, onGitUrlChange, gitUrlFromConfig,
  ownerInfo, activeOwner, onApplyOwner,
  gitAction, onGitActionChange,
}: StepGitIntegrationProps) {
  const fieldDisabled = readOnly || !patStatus?.configured;

  // Only derive badge from the snapshot in readOnly (existing project with
  // config URL). For a new project in the wizard, the snapshot in the slice
  // belongs to the previously selected project — suppress the badge.
  const badgeState: 'none' | 'not-connected' | 'connected' | 'error' = (() => {
    if (!gitEnabled || !gitUrl) return 'none';
    if (!readOnly) return 'none';
    if (!gitSnapshot) return 'none';
    if (!gitSnapshot.hasGit) return 'not-connected';
    const hasRemote = !!gitSnapshot.remoteUrl;
    if (hasRemote) {
      const match = normalizeRepoUrl(gitUrl) === normalizeRepoUrl(gitSnapshot.remoteUrl!);
      return match ? 'connected' : 'error';
    }
    return 'error';
  })();

  return (
    <>
      {/* Git toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
            {t('quickstart.projectWizard.gitEnable')}
          </label>
          {badgeState === 'not-connected' && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                background: 'var(--bg-surface-2)',
                color: 'var(--text-3)',
                border: '1px solid var(--border-2)',
              }}
            >
              {t('quickstart.projectWizard.gitNotConnected')}
            </span>
          )}
          {badgeState === 'connected' && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                background: 'var(--status-done-bg)',
                color: 'var(--status-done-fg)',
                border: '1px solid oklch(80% 0.10 155)',
              }}
            >
              {t('quickstart.projectWizard.gitConnected')}
            </span>
          )}
          {badgeState === 'error' && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                background: 'var(--status-error-bg)',
                color: 'var(--status-error-fg)',
                border: '1px solid oklch(82% 0.12 25)',
              }}
            >
              {t('quickstart.projectWizard.gitError')}
            </span>
          )}
        </div>
        <Toggle
          checked={gitEnabled}
          onChange={(next) => onGitEnabledChange(next)}
          disabled={readOnly}
          size="sm"
          aria-label={t('quickstart.projectWizard.gitEnable')}
        />
      </div>

      {!gitEnabled ? (
        <p
          className="text-xs italic"
          style={{ color: 'var(--text-4)' }}
        >
          {t('quickstart.projectWizard.gitSkipHint')}
        </p>
      ) : (
        <>
          {/* PAT section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>GitHub PAT</span>
              {patStatus?.configured && patStatus.username && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: 'var(--status-done-bg)',
                    color: 'var(--status-done-fg)',
                    border: '1px solid oklch(80% 0.10 155)',
                  }}
                >
                  {t('quickstart.projectWizard.patConnected', { username: patStatus.username })}
                </span>
              )}
            </div>

            {!readOnly && !patStatus?.configured && (
              <div
                className="p-3"
                style={{
                  background: 'oklch(96% 0.05 75 / 0.6)',
                  border: '1px solid oklch(82% 0.10 75)',
                  borderRadius: 'var(--r-lg, 10px)',
                }}
              >
                <p
                  className="text-xs mb-2"
                  style={{ color: 'oklch(45% 0.16 65)' }}
                >
                  {t('quickstart.projectWizard.patRequired')}
                </p>
                {showPatInput ? (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <TokenInput
                        type="password"
                        value={patInput}
                        onChange={onPatInputChange}
                        placeholder={t('quickstart.projectWizard.patPlaceholder')}
                        onKeyDown={(e) => e.key === 'Enter' && onSavePat()}
                      />
                    </div>
                    <button
                      onClick={onSavePat}
                      disabled={patSaving || !patInput.trim()}
                      className="px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        background:
                          'linear-gradient(135deg, oklch(75% 0.16 75), oklch(65% 0.18 50))',
                        color: 'white',
                        borderRadius: 'var(--r-md, 8px)',
                        border: 'none',
                        boxShadow: '0 4px 12px -2px oklch(65% 0.18 60 / 0.35)',
                      }}
                    >
                      {patSaving ? t('quickstart.projectWizard.patSaving') : t('quickstart.projectWizard.patSave')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={onShowPatInput}
                    className="text-xs underline transition-opacity hover:opacity-80"
                    style={{ color: 'oklch(50% 0.16 65)' }}
                  >
                    {t('quickstart.projectWizard.patRequiredHint')}
                  </button>
                )}
                {patError && (
                  <p
                    className="mt-1.5 text-xs"
                    style={{ color: 'var(--status-error-fg)' }}
                  >
                    {t('quickstart.projectWizard.patError', { error: patError })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Repository name */}
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: 'var(--text-2)' }}
            >
              {t('quickstart.projectWizard.repositoryName')}
            </label>
            <TokenInput
              value={repositoryName}
              onChange={(v) => { onRepositoryNameChange(v); onRepoManualEdit(); }}
              disabled={fieldDisabled}
              readOnly={readOnly}
              placeholder="my-project"
            />
            {!readOnly && (
              <p
                className="mt-1 text-[11px]"
                style={{ color: 'var(--text-4)' }}
              >
                {t('quickstart.projectWizard.repositoryNameHint')}
              </p>
            )}
          </div>

          {/* Git URL + owner quick-fill */}
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: 'var(--text-2)' }}
            >
              {t('quickstart.projectWizard.gitUrl')}
              {gitUrlFromConfig && (
                <span
                  className="ml-2 text-xs font-normal"
                  style={{ color: 'var(--text-4)' }}
                >
                  {t('quickstart.projectWizard.gitUrlFromConfig')}
                </span>
              )}
            </label>
            {!readOnly && patStatus?.configured && (ownerInfo.orgOwner || ownerInfo.personalOwner) && (
              <div className="flex items-center gap-2 mb-2">
                {ownerInfo.orgOwner && (
                  <OwnerPill
                    active={activeOwner === 'org'}
                    tone="violet"
                    onClick={() => onApplyOwner(ownerInfo.orgOwner!)}
                  >
                    Organization: {ownerInfo.orgOwner}
                  </OwnerPill>
                )}
                {ownerInfo.personalOwner && (
                  <OwnerPill
                    active={activeOwner === 'personal'}
                    tone="emerald"
                    onClick={() => onApplyOwner(ownerInfo.personalOwner!)}
                  >
                    Personal: {ownerInfo.personalOwner}
                  </OwnerPill>
                )}
              </div>
            )}
            <TokenInput
              value={gitUrl}
              onChange={onGitUrlChange}
              disabled={fieldDisabled}
              readOnly={readOnly}
              placeholder="https://github.com/owner/repo"
            />
          </div>

          {/* Clone / Init radio — hidden when readOnly */}
          {!readOnly && gitUrl.trim() && patStatus?.configured && (
            <div className="space-y-2">
              <ActionRadio
                selected={gitAction === 'clone'}
                onSelect={() => onGitActionChange('clone')}
                title={t('quickstart.projectWizard.gitActionClone')}
                hint={t('quickstart.projectWizard.gitActionCloneHint')}
                name="gitAction"
              />
              <ActionRadio
                selected={gitAction === 'init'}
                onSelect={() => onGitActionChange('init')}
                title={t('quickstart.projectWizard.gitActionInit')}
                hint={t('quickstart.projectWizard.gitActionInitHint')}
                name="gitAction"
              />
            </div>
          )}

          {/* Read-only hint */}
          {readOnly && (
            <p
              className="text-[11px] italic"
              style={{ color: 'var(--text-4)' }}
            >
              {t('quickstart.projectWizard.gitReadOnlyHint')}
            </p>
          )}
        </>
      )}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function OwnerPill({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: 'violet' | 'emerald';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);

  const activeStyle: CSSProperties = tone === 'violet'
    ? {
        background: 'oklch(96% 0.04 285)',
        color: 'var(--violet-700)',
        border: '1px solid oklch(80% 0.10 285)',
        fontWeight: 600,
      }
    : {
        background: 'oklch(94% 0.06 155)',
        color: 'oklch(45% 0.12 155)',
        border: '1px solid oklch(80% 0.10 155)',
        fontWeight: 600,
      };

  const inactiveStyle: CSSProperties = {
    background: hover ? 'var(--bg-hover)' : 'var(--bg-surface)',
    color: 'var(--text-3)',
    border: `1px solid ${hover ? 'var(--border-3)' : 'var(--border-2)'}`,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="text-xs px-2.5 py-1 transition-colors"
      style={{
        borderRadius: 'var(--r-md, 8px)',
        ...(active ? activeStyle : inactiveStyle),
      }}
    >
      {children}
    </button>
  );
}

function ActionRadio({
  selected,
  onSelect,
  title,
  hint,
  name,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
  name: string;
}) {
  const [hover, setHover] = useState(false);

  const style: CSSProperties = selected
    ? {
        border: '1.5px solid var(--violet-500)',
        background: 'oklch(96% 0.04 285)',
      }
    : {
        border: '1.5px solid var(--border-2)',
        background: hover ? 'var(--bg-hover)' : 'transparent',
      };

  return (
    <label
      className="flex items-start gap-3 p-3 cursor-pointer transition-colors"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 'var(--r-lg, 10px)',
        ...style,
      }}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        onChange={onSelect}
        className="mt-0.5"
        style={{ accentColor: 'var(--violet-500)' }}
      />
      <div>
        <div
          className="text-sm font-medium"
          style={{ color: selected ? 'var(--violet-700)' : 'var(--text-2)' }}
        >
          {title}
        </div>
        <div
          className="text-[11px]"
          style={{ color: 'var(--text-3)' }}
        >
          {hint}
        </div>
      </div>
    </label>
  );
}

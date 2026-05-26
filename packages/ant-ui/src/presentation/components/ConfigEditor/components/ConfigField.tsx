
import { useTranslation } from 'react-i18next';
import { ProjectConfig } from '@/infrastructure/http/api';
import { ConfigField as ConfigFieldType } from '../configSchema';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import { normalizeRepoUrl } from '@/shared/utils/git-utils';
import type { GitSnapshot } from '@ant/shared';
import { FieldLabel, AuroraInput, AuroraSelect } from '../aurora';

export interface GitHubOwnerInfo {
  orgOwner?: string;
  personalOwner?: string;
}

interface ConfigFieldProps {
  field: ConfigFieldType;
  value: any;
  hasError: boolean;
  errorMessage?: string;
  isRepoTypeDisabled: boolean;
  showLocalPath: boolean;
  onChange: (key: keyof ProjectConfig, value: any) => void;
  githubOwnerInfo?: GitHubOwnerInfo;
  projectName?: string;
  gitSnapshot?: GitSnapshot | null;
}

const PILL_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  borderRadius: 'var(--r-pill)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.02em',
};

export function ConfigField({
  field,
  value,
  hasError,
  errorMessage,
  isRepoTypeDisabled,
  showLocalPath,
  onChange,
  githubOwnerInfo,
  projectName,
  gitSnapshot,
}: ConfigFieldProps) {
  const { t } = useTranslation('config');

  if (!showLocalPath && (field.key === 'localPath' || field.key === 'repoType')) {
    return null;
  }

  const isGithubRepoField = field.key === 'githubRepo';
  const orgOwner = githubOwnerInfo?.orgOwner;
  const personalOwner = githubOwnerInfo?.personalOwner;
  const hasOwners = !!(isGithubRepoField && (orgOwner || personalOwner));

  const configUrl = typeof value === 'string' ? value : '';
  const hasGitRepo = isGithubRepoField && !!configUrl;
  const gitLoaded = hasGitRepo && gitSnapshot != null;
  const hasGit = gitLoaded && gitSnapshot.hasGit;
  const hasRemote = hasGit && !!gitSnapshot.remoteUrl;
  const isUrlMatch = hasRemote
    ? normalizeRepoUrl(configUrl) === normalizeRepoUrl(gitSnapshot.remoteUrl!)
    : false;

  const isNotConnected = gitLoaded && !gitSnapshot.hasGit;
  const isConnected = hasRemote && isUrlMatch;
  const isError = hasGit && (!gitSnapshot.remoteUrl || !isUrlMatch);

  const applyOwner = (owner: string) => {
    const repoName = projectName || 'my-project';
    onChange(field.key, `https://github.com/${owner}/${repoName}`);
  };

  const currentValue = typeof value === 'string' ? value : '';
  const activeOwner = orgOwner && currentValue.includes(`github.com/${orgOwner}/`)
    ? 'org'
    : personalOwner && currentValue.includes(`github.com/${personalOwner}/`)
      ? 'personal'
      : null;

  // Build status badge node (passed to FieldLabel's `action`)
  let badgeNode: React.ReactNode = null;
  if (isNotConnected) {
    badgeNode = (
      <Tooltip content={t('projectEditor.repoNotConnectedHint')} placement="bottom">
        <span
          style={{
            ...PILL_BASE,
            background: 'var(--bg-surface-2)',
            color: 'var(--text-3)',
            border: '1px solid var(--border-1)',
            cursor: 'help',
          }}
        >
          {t('projectEditor.repoNotConnected')}
        </span>
      </Tooltip>
    );
  } else if (isConnected) {
    badgeNode = (
      <span
        style={{
          ...PILL_BASE,
          background: 'oklch(94% 0.05 155 / 0.6)',
          color: 'oklch(45% 0.16 155)',
          border: '1px solid oklch(72% 0.14 155)',
        }}
      >
        {t('projectEditor.repoConnected')}
      </span>
    );
  } else if (isError) {
    badgeNode = (
      <Tooltip
        content={hasRemote && !isUrlMatch
          ? t('projectEditor.repoErrorUrlMismatch')
          : t('projectEditor.repoErrorNoRemote')}
        placement="bottom"
      >
        <span
          style={{
            ...PILL_BASE,
            background: 'oklch(94% 0.05 25 / 0.6)',
            color: 'var(--status-error-fg)',
            border: '1px solid oklch(72% 0.16 25)',
            cursor: 'help',
          }}
        >
          {t('projectEditor.repoError')}
        </span>
      </Tooltip>
    );
  }

  const placeholderText =
    field.key === 'localPath'
      ? t('projectEditor.localPathPlaceholder')
      : field.key === 'githubRepo'
        ? t('projectEditor.githubRepoPlaceholder')
        : t(field.label);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldLabel
        required={field.required}
        optional={!field.required && !hasOwners}
        action={badgeNode}
      >
        {t(field.label)}
      </FieldLabel>

      {field.description && (
        <p style={{ margin: '-2px 0 8px', fontSize: 11, color: 'var(--text-4)' }}>
          {t(field.description)}
          {isRepoTypeDisabled && field.key === 'repoType' && ` ${t('projectEditor.fixedInCloudMode')}`}
        </p>
      )}
      {isError && hasRemote && !isUrlMatch && (
        <p style={{ margin: '-2px 0 8px', fontSize: 11, color: 'var(--status-error-fg)' }}>
          {t('projectEditor.repoErrorUrlMismatch')}
        </p>
      )}
      {isError && !hasRemote && (
        <p style={{ margin: '-2px 0 8px', fontSize: 11, color: 'var(--status-error-fg)' }}>
          {t('projectEditor.repoErrorNoRemote')}
        </p>
      )}

      {hasOwners && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {orgOwner && (
            <OwnerPill
              active={activeOwner === 'org'}
              accentFg="oklch(45% 0.18 250)"
              accentBg="oklch(94% 0.06 250 / 0.6)"
              accentRing="oklch(72% 0.14 250)"
              onClick={() => applyOwner(orgOwner)}
            >
              {t('projectEditor.organization', { name: orgOwner })}
            </OwnerPill>
          )}
          {personalOwner && (
            <OwnerPill
              active={activeOwner === 'personal'}
              accentFg="oklch(45% 0.16 155)"
              accentBg="oklch(94% 0.05 155 / 0.6)"
              accentRing="oklch(72% 0.14 155)"
              onClick={() => applyOwner(personalOwner)}
            >
              {t('projectEditor.personal', { name: personalOwner })}
            </OwnerPill>
          )}
        </div>
      )}

      {field.type === 'text' && (
        <AuroraInput
          value={(value as string) || ''}
          onChange={(v) => onChange(field.key, v)}
          placeholder={placeholderText}
          hasError={hasError}
          mono={field.key === 'githubRepo' || field.key === 'localPath'}
        />
      )}

      {field.type === 'select' && (
        <AuroraSelect
          value={(value as string) || ''}
          onChange={(v) => onChange(field.key, v || undefined)}
          disabled={isRepoTypeDisabled}
          hasError={hasError}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          placeholder={!isRepoTypeDisabled ? t('projectEditor.selectOption') : undefined}
        />
      )}

      {field.type === 'boolean' && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--text-2)',
          }}
        >
          <input
            type="checkbox"
            checked={(value as boolean) || false}
            onChange={(e) => onChange(field.key, e.target.checked)}
            style={{
              width: 16,
              height: 16,
              accentColor: 'var(--violet-500)',
              cursor: 'pointer',
            }}
          />
          <span>{t('projectEditor.enabled')}</span>
        </label>
      )}

      {hasError && errorMessage && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--status-error-fg)' }}>{errorMessage}</p>
      )}
    </div>
  );
}

interface OwnerPillProps {
  active: boolean;
  accentFg: string;
  accentBg: string;
  accentRing: string;
  onClick: () => void;
  children: React.ReactNode;
}

function OwnerPill({ active, accentFg, accentBg, accentRing, onClick, children }: OwnerPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        fontWeight: active ? 700 : 600,
        padding: '4px 10px',
        borderRadius: 'var(--r-md)',
        background: active ? accentBg : 'var(--bg-surface-2)',
        color: active ? accentFg : 'var(--text-3)',
        border: active ? `1px solid ${accentRing}` : '1px solid var(--border-1)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

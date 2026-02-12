import { useTranslation } from 'react-i18next';
import { ProjectConfig } from '@/infrastructure/http/api';
import { ConfigField as ConfigFieldType } from '../configSchema';

export interface GitHubOwnerInfo {
  orgOwner?: string;      // Organization-level GitHub owner
  personalOwner?: string; // Personal GitHub username (from PAT)
}

interface ConfigFieldProps {
  field: ConfigFieldType;
  value: any;
  hasError: boolean;
  errorMessage?: string;
  isRepoTypeDisabled: boolean;
  showLocalPath: boolean;
  onChange: (key: keyof ProjectConfig, value: any) => void;
  /** GitHub owner info for githubRepo quick-fill */
  githubOwnerInfo?: GitHubOwnerInfo;
  /** Project name for building default URL */
  projectName?: string;
}

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
}: ConfigFieldProps) {
  const { t } = useTranslation('config');
  // Cloud 모드에서 localPath 필드 숨김
  if (!showLocalPath && field.key === 'localPath') {
    return null;
  }

  // githubRepo 필드: Owner 토글 버튼 추가
  const isGithubRepoField = field.key === 'githubRepo';
  const orgOwner = githubOwnerInfo?.orgOwner;
  const personalOwner = githubOwnerInfo?.personalOwner;
  const hasOwners = isGithubRepoField && (orgOwner || personalOwner);

  const applyOwner = (owner: string) => {
    const repoName = projectName || 'my-project';
    onChange(field.key, `https://github.com/${owner}/${repoName}`);
  };

  // Detect which owner is currently active
  const currentValue = typeof value === 'string' ? value : '';
  const activeOwner = orgOwner && currentValue.includes(`github.com/${orgOwner}/`)
    ? 'org'
    : personalOwner && currentValue.includes(`github.com/${personalOwner}/`)
      ? 'personal'
      : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t(field.label)}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {!field.required && !hasOwners && (
          <span className="text-xs text-gray-400 dark:text-gray-500">{t('field.optional')}</span>
        )}
      </div>
      
      {field.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t(field.description)}
          {isRepoTypeDisabled && field.key === 'repoType' && ` ${t('projectEditor.fixedInCloudMode')}`}
        </p>
      )}

      {/* Owner quick-fill buttons for githubRepo */}
      {hasOwners && (
        <div className="flex items-center gap-2">
          {orgOwner && (
            <button
              type="button"
              onClick={() => applyOwner(orgOwner)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                activeOwner === 'org'
                  ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 font-medium'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {t('projectEditor.organization', { name: orgOwner })}
            </button>
          )}
          {personalOwner && (
            <button
              type="button"
              onClick={() => applyOwner(personalOwner)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                activeOwner === 'personal'
                  ? 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 font-medium'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {t('projectEditor.personal', { name: personalOwner })}
            </button>
          )}
        </div>
      )}
      
      {field.type === 'text' && (
        <input
          type="text"
          value={value as string || ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          className={`w-full px-3 py-2 border rounded-md text-sm 
            bg-white dark:bg-gray-800 
            text-gray-900 dark:text-white
            ${
              hasError 
                ? 'border-red-500 dark:border-red-400' 
                : 'border-gray-300 dark:border-gray-600'
            } 
            focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
            placeholder:text-gray-400 dark:placeholder:text-gray-500`}
          placeholder={
            field.key === 'localPath' 
              ? t('projectEditor.localPathPlaceholder') 
              : field.key === 'githubRepo'
                ? t('projectEditor.githubRepoPlaceholder')
                : t(field.label)
          }
        />
      )}
      
      {field.type === 'select' && (
        <select
          value={value as string || ''}
          onChange={(e) => onChange(field.key, e.target.value || undefined)}
          disabled={isRepoTypeDisabled}
          className={`w-full px-3 py-2 border rounded-md text-sm 
            bg-white dark:bg-gray-800 
            text-gray-900 dark:text-white
            ${
              hasError 
                ? 'border-red-500 dark:border-red-400' 
                : 'border-gray-300 dark:border-gray-600'
            } 
            ${isRepoTypeDisabled ? 'opacity-50 cursor-not-allowed' : ''}
            focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400`}
        >
          {!isRepoTypeDisabled && <option value="">{t('projectEditor.selectOption')}</option>}
          {field.options?.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
      
      {field.type === 'boolean' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value as boolean || false}
            onChange={(e) => onChange(field.key, e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-700"
          />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {t('projectEditor.enabled')}
          </span>
        </label>
      )}
      
      {hasError && (
        <p className="text-xs text-red-500">{errorMessage}</p>
      )}
    </div>
  );
}

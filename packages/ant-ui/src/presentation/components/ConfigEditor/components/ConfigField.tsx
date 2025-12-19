import { ProjectConfig } from '@/infrastructure/http/api';
import { ConfigField as ConfigFieldType } from '../configSchema';

interface ConfigFieldProps {
  field: ConfigFieldType;
  value: any;
  hasError: boolean;
  errorMessage?: string;
  isRepoTypeDisabled: boolean;
  showLocalPath: boolean;
  onChange: (key: keyof ProjectConfig, value: any) => void;
}

export function ConfigField({
  field,
  value,
  hasError,
  errorMessage,
  isRepoTypeDisabled,
  showLocalPath,
  onChange
}: ConfigFieldProps) {
  // Cloud 모드에서 localPath 필드 숨김
  if (!showLocalPath && field.key === 'localPath') {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {!field.required && (
          <span className="text-xs text-gray-400 dark:text-gray-500">Optional</span>
        )}
      </div>
      
      {field.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {field.description}
          {isRepoTypeDisabled && field.key === 'repoType' && ' (Fixed in Cloud Mode)'}
        </p>
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
              ? '~/dev/my-repo or ../my-repo or /absolute/path' 
              : field.label
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
          {!isRepoTypeDisabled && <option value="">-- Select --</option>}
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
            Enabled
          </span>
        </label>
      )}
      
      {hasError && (
        <p className="text-xs text-red-500">{errorMessage}</p>
      )}
    </div>
  );
}

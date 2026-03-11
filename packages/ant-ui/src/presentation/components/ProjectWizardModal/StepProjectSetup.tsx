import { Compass, Code2, Check, X } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';

interface StepProjectSetupProps {
  t: (key: string) => string;
  mode: 'design' | 'code';
  onModeChange: (mode: 'design' | 'code') => void;
  existingProjectId?: string;
  projectName: string;
  onProjectNameChange: (v: string) => void;
  featureName: string;
  onFeatureNameChange: (v: string) => void;
  projectNameExists: boolean;
  featureNameExists: boolean;
  projectNameInvalid: boolean;
  featureNameInvalid: boolean;
}

export function StepProjectSetup({
  t, mode, onModeChange, existingProjectId,
  projectName, onProjectNameChange,
  featureName, onFeatureNameChange,
  projectNameExists, featureNameExists,
  projectNameInvalid, featureNameInvalid,
}: StepProjectSetupProps) {
  const projectNameError = projectNameExists || projectNameInvalid;
  const featureNameError = featureNameExists || featureNameInvalid;
  return (
    <>
      {/* Mode cards */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onModeChange('design')}
          className={cn(
            'flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all',
            mode === 'design'
              ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
          )}
        >
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            mode === 'design'
              ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
          )}>
            <Compass className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className={cn('text-sm font-semibold', mode === 'design' ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300')}>
              {t('quickstart.projectWizard.modeDesign')}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              {t('quickstart.projectWizard.modeDesignDesc')}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onModeChange('code')}
          className={cn(
            'flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all',
            mode === 'code'
              ? 'border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
          )}
        >
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            mode === 'code'
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
          )}>
            <Code2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className={cn('text-sm font-semibold', mode === 'code' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-700 dark:text-gray-300')}>
              {t('quickstart.projectWizard.modeCode')}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              {t('quickstart.projectWizard.modeCodeDesc')}
            </div>
          </div>
        </button>
      </div>

      {/* Project name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          {t('quickstart.projectWizard.projectName')}
        </label>
        <div className="relative">
          <input
            type="text"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            disabled={!!existingProjectId}
            readOnly={!!existingProjectId}
            className={cn(
              'w-full px-3 py-2 pr-9 text-sm border-2 rounded-lg outline-none transition-colors',
              existingProjectId
                ? 'bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 cursor-not-allowed'
                : projectNameError
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-red-300 dark:border-red-700 focus:border-red-500'
                  : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-200 dark:border-gray-700 focus:border-indigo-500 dark:focus:border-indigo-400',
            )}
            placeholder="my-project"
          />
          {!existingProjectId && projectName.trim() && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {projectNameError
                ? <X className="w-4 h-4 text-red-500" />
                : <Check className="w-4 h-4 text-emerald-500" />}
            </span>
          )}
        </div>
        {projectNameExists && (
          <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">
            {t('quickstart.projectWizard.nameExists')}
          </p>
        )}
        {projectNameInvalid && (
          <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">
            {t('quickstart.projectWizard.nameInvalid')}
          </p>
        )}
      </div>

      {/* Feature name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          {t('quickstart.projectWizard.featureName')}
        </label>
        <div className="relative">
          <input
            type="text"
            value={featureName}
            onChange={(e) => onFeatureNameChange(e.target.value)}
            className={cn(
              'w-full px-3 py-2 pr-9 text-sm border-2 rounded-lg outline-none transition-colors',
              featureNameError
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-red-300 dark:border-red-700 focus:border-red-500'
                : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-200 dark:border-gray-700 focus:border-indigo-500 dark:focus:border-indigo-400',
            )}
            placeholder="feature-name"
          />
          {featureName.trim() && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {featureNameError
                ? <X className="w-4 h-4 text-red-500" />
                : <Check className="w-4 h-4 text-emerald-500" />}
            </span>
          )}
        </div>
        {featureNameExists ? (
          <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">
            {t('quickstart.projectWizard.nameExists')}
          </p>
        ) : featureNameInvalid ? (
          <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">
            {t('quickstart.projectWizard.nameInvalid')}
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {t('quickstart.projectWizard.featureNameHint')}
          </p>
        )}
      </div>
    </>
  );
}

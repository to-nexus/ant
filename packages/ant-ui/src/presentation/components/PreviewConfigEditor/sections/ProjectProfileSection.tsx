import { useTranslation } from 'react-i18next';

export function ProjectProfileSection({
  structureType,
  projectProfile,
}: {
  structureType: string | null;
  projectProfile: { language?: string; framework?: string } | null;
}) {
  const { t } = useTranslation('explorer');

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        {t('preview.projectProfile', 'Project Profile')}
      </h3>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400 w-28">{t('preview.structureType', 'Structure Type:')}</span>
          {structureType ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200">
              {structureType}
            </span>
          ) : (
            <span className="text-sm text-gray-400 dark:text-gray-500 italic">
              {t('preview.notDetected', 'Not detected')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400 w-28">{t('preview.language', 'Language:')}</span>
          {projectProfile?.language ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200">
              {projectProfile.language}
            </span>
          ) : (
            <span className="text-sm text-gray-400 dark:text-gray-500 italic">
              {t('preview.notDetected', 'Not detected')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400 w-28">{t('preview.framework', 'Framework:')}</span>
          {projectProfile?.framework ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200">
              {projectProfile.framework}
            </span>
          ) : (
            <span className="text-sm text-gray-400 dark:text-gray-500 italic">
              {t('preview.notDetected', 'Not detected')}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

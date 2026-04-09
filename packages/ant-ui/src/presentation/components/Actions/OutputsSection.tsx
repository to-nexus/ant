import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';

interface OutputsSectionProps {
  outputDir: string;
  hasOutput: boolean;
}

export function OutputsSection({ outputDir, hasOutput }: OutputsSectionProps) {
  const { t } = useTranslation('actions');

  if (!outputDir) return null;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-5 space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <FolderOpen className="w-4 h-4" />
        {t('outputs.sectionTitle')}
      </h3>

      <code className="text-xs font-mono text-gray-500 bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 inline-block">
        {outputDir}
      </code>

      {!hasOutput && (
        <p className="text-xs text-gray-400 italic">{t('outputs.empty')}</p>
      )}
    </div>
  );
}

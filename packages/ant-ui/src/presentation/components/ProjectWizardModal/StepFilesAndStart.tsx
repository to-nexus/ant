import { AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';
import { FileUploadArea } from './FileUploadArea';
import { isCanonicalDesignDoc } from './constants';

interface StepFilesAndStartProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  mode: 'design' | 'code';
  sourcesFiles: File[];
  onSourcesChange: (f: File[]) => void;
  assetsFiles: File[];
  onAssetsChange: (f: File[]) => void;
  referencesFiles: File[];
  onReferencesChange: (f: File[]) => void;
  designDocsFiles: File[];
  onDesignDocsChange: (f: File[]) => void;
  directive: string;
  onDirectiveChange: (v: string) => void;
  showDirective: boolean;
  onShowDirectiveToggle: () => void;
  canSubmit: boolean;
}

export function StepFilesAndStart({
  t, mode,
  sourcesFiles, onSourcesChange,
  assetsFiles, onAssetsChange,
  referencesFiles, onReferencesChange,
  designDocsFiles, onDesignDocsChange,
  directive, onDirectiveChange,
  showDirective, onShowDirectiveToggle,
  canSubmit,
}: StepFilesAndStartProps) {
  const validDesignDocs = designDocsFiles.filter((f) => isCanonicalDesignDoc(f.name));

  return (
    <>
      {/* Artifact files — unified row layout */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t('quickstart.projectWizard.inputFiles')}
        </h4>
        <div className="space-y-3">
          <FileUploadArea
            label={t('quickstart.projectWizard.sources')}
            tooltip={t('quickstart.projectWizard.sourcesTooltip')}
            files={sourcesFiles}
            onFilesChange={onSourcesChange}
            dropzoneText={t('quickstart.projectWizard.fileDropzone')}
            addMoreText={t('quickstart.projectWizard.addMoreFiles')}
            maxFileListHeight="max-h-28"
          />
          <FileUploadArea
            label={t('quickstart.projectWizard.assets')}
            tooltip={t('quickstart.projectWizard.assetsTooltip')}
            files={assetsFiles}
            onFilesChange={onAssetsChange}
            dropzoneText={t('quickstart.projectWizard.fileDropzone')}
            addMoreText={t('quickstart.projectWizard.addMoreFiles')}
            maxFileListHeight="max-h-28"
          />
          <FileUploadArea
            label={t('quickstart.projectWizard.references')}
            tooltip={t('quickstart.projectWizard.referencesTooltip')}
            files={referencesFiles}
            onFilesChange={onReferencesChange}
            dropzoneText={t('quickstart.projectWizard.fileDropzone')}
            addMoreText={t('quickstart.projectWizard.addMoreFiles')}
            maxFileListHeight="max-h-28"
          />
          {mode === 'code' && (
            <div>
              <FileUploadArea
                label={t('quickstart.projectWizard.designDocs')}
                tooltip={t('quickstart.projectWizard.designDocsTooltip')}
                files={designDocsFiles}
                onFilesChange={onDesignDocsChange}
                patternHint={t('quickstart.projectWizard.designDocsPattern')}
                warning
                warningLabel={t('quickstart.projectWizard.designDocsAntFormat')}
                dropzoneText={t('quickstart.projectWizard.fileDropzone')}
                addMoreText={t('quickstart.projectWizard.addMoreFiles')}
                validateFilename={isCanonicalDesignDoc}
                invalidLabel={t('quickstart.projectWizard.designDocsInvalid')}
                maxFileListHeight="max-h-28"
              />
              {designDocsFiles.length > 0 && validDesignDocs.length < designDocsFiles.length && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  {t('quickstart.projectWizard.designDocsSkipWarning', {
                    skipped: designDocsFiles.length - validDesignDocs.length,
                    total: designDocsFiles.length,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Directive section */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('quickstart.projectWizard.directive')}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('quickstart.projectWizard.directiveEditToggle')}
            </span>
            <button
              type="button"
              onClick={onShowDirectiveToggle}
              className={cn(
                'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                showDirective ? 'bg-indigo-500 dark:bg-indigo-400' : 'bg-gray-200 dark:bg-gray-600',
              )}
            >
              <span className={cn(
                'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200',
                showDirective ? 'translate-x-4' : 'translate-x-0',
              )} />
            </button>
          </div>
        </div>

        {showDirective ? (
          <textarea
            value={directive}
            onChange={(e) => onDirectiveChange(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border-2 border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none resize-none"
            placeholder={t('quickstart.projectWizard.directivePlaceholder')}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 px-3 py-2">
            <p className="text-xs italic text-gray-600 dark:text-gray-300">
              &ldquo;{t(mode === 'design' ? 'quickstart.projectWizard.defaultDirectiveDesign' : 'quickstart.projectWizard.defaultDirectiveCode')}&rdquo;
            </p>
          </div>
        )}
        <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
          {t('quickstart.projectWizard.autoDirectiveHint')}
        </p>
      </div>

      {!canSubmit && (
        <p className="text-xs text-amber-600 dark:text-amber-400 text-right">
          {t(mode === 'design'
            ? 'quickstart.projectWizard.startRequiresDesignInput'
            : 'quickstart.projectWizard.startRequiresCodeInput')}
        </p>
      )}
    </>
  );
}

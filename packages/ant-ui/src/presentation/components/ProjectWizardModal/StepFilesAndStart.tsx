import { AlertTriangle } from 'lucide-react';
import { Toggle } from '@/presentation/components/aurora';
import { FileUploadArea } from './FileUploadArea';
import { isCanonicalDesignDoc } from './constants';

interface StepFilesAndStartProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  mode: 'design' | 'code';
  sourcesFiles: File[];
  onSourcesChange: (f: File[]) => void;
  assetsFiles: File[];
  onAssetsChange: (f: File[]) => void;
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
  designDocsFiles, onDesignDocsChange,
  directive, onDirectiveChange,
  showDirective, onShowDirectiveToggle,
  canSubmit,
}: StepFilesAndStartProps) {
  const validDesignDocs = designDocsFiles.filter((f) => isCanonicalDesignDoc(f.webkitRelativePath || f.name));

  return (
    <>
      {/* Artifact files — unified row layout */}
      <div>
        <h4
          className="text-sm font-medium mb-3"
          style={{ color: 'var(--text-2)' }}
        >
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
                <p
                  className="mt-1.5 text-xs flex items-center gap-1"
                  style={{ color: 'oklch(50% 0.16 65)' }}
                >
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
          <label
            className="text-sm font-medium"
            style={{ color: 'var(--text-2)' }}
          >
            {t('quickstart.projectWizard.directive')}
          </label>
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--text-3)' }}
            >
              {t('quickstart.projectWizard.directiveEditToggle')}
            </span>
            <Toggle
              checked={showDirective}
              onChange={() => onShowDirectiveToggle()}
              size="sm"
              aria-label={t('quickstart.projectWizard.directiveEditToggle')}
            />
          </div>
        </div>

        {showDirective ? (
          <textarea
            value={directive}
            onChange={(e) => onDirectiveChange(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm outline-none resize-none transition-all"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-1)',
              border: '1.5px solid var(--border-2)',
              borderRadius: 'var(--r-lg, 10px)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--violet-500)';
              e.currentTarget.style.boxShadow = '0 0 0 3px oklch(64% 0.20 290 / 0.18)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-2)';
              e.currentTarget.style.boxShadow = 'none';
            }}
            placeholder={t('quickstart.projectWizard.directivePlaceholder')}
          />
        ) : (
          <div
            className="px-3 py-2"
            style={{
              border: '1px dashed var(--border-1)',
              background: 'oklch(from var(--bg-surface-2) l c h / 0.6)',
              borderRadius: 'var(--r-lg, 10px)',
            }}
          >
            <p
              className="text-xs italic"
              style={{ color: 'var(--text-3)' }}
            >
              &ldquo;{t(mode === 'design' ? 'quickstart.projectWizard.defaultDirectiveDesign' : 'quickstart.projectWizard.defaultDirectiveCode')}&rdquo;
            </p>
          </div>
        )}
        <p
          className="mt-1.5 text-xs leading-relaxed"
          style={{ color: 'var(--text-4)' }}
        >
          {t('quickstart.projectWizard.autoDirectiveHint')}
        </p>
      </div>

      {!canSubmit && (
        <p
          className="text-xs text-right"
          style={{ color: 'oklch(50% 0.16 65)' }}
        >
          {t(mode === 'design'
            ? 'quickstart.projectWizard.startRequiresDesignInput'
            : 'quickstart.projectWizard.startRequiresCodeInput')}
        </p>
      )}
    </>
  );
}

import { useState, useRef } from 'react';
import { Upload, Plus, Info, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';

export interface FileUploadAreaProps {
  label: string;
  tooltip: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  patternHint?: string;
  warning?: boolean;
  warningLabel?: string;
  dropzoneText: string;
  addMoreText?: string;
  validateFilename?: (name: string) => boolean;
  invalidLabel?: string;
  maxFileListHeight?: string;
}

export function FileUploadArea({
  label, tooltip, files, onFilesChange, patternHint, warning, warningLabel, dropzoneText, addMoreText,
  validateFilename, invalidLabel, maxFileListHeight = 'max-h-24',
}: FileUploadAreaProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });

  const handleMouseEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setTooltipPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
    }
    setShowTooltip(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) onFilesChange([...files, ...dropped]);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length) onFilesChange([...files, ...selected]);
    e.target.value = '';
  };

  const removeFile = (idx: number) => onFilesChange(files.filter((_, i) => i !== idx));

  const hasFiles = files.length > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <div
          ref={iconRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 cursor-help" />
        </div>
        {showTooltip && (
          <div
            className="fixed z-[10000] -translate-x-1/2 -translate-y-full w-56 p-2 text-xs text-gray-200 bg-gray-800 dark:bg-gray-900 rounded-lg shadow-lg pointer-events-none"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
          >
            {tooltip}
          </div>
        )}
        {warning && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 font-medium">
            {warningLabel || 'Ant format'}
          </span>
        )}
      </div>
      {patternHint && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{patternHint}</div>
      )}

      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleChange} />

      {!hasFiles ? (
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors',
            'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
            'hover:bg-gray-50 dark:hover:bg-gray-800/50',
          )}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-4 h-4 mx-auto text-gray-400 dark:text-gray-500 mb-1" />
          <div className="text-xs text-gray-500 dark:text-gray-400">{dropzoneText}</div>
        </div>
      ) : (
        <>
          <div className={cn('space-y-1 overflow-y-auto', maxFileListHeight)}>
            {files.map((f, i) => {
              const isInvalid = validateFilename && !validateFilename(f.name);
              return (
                <div
                  key={`${f.name}-${i}`}
                  className={cn(
                    'flex items-center gap-2 text-xs rounded px-2 py-1',
                    isInvalid
                      ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                      : 'bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400',
                  )}
                >
                  {isInvalid && <AlertTriangle className="w-3 h-3 text-amber-500 dark:text-amber-400 flex-shrink-0" />}
                  <span className={cn('flex-1 truncate', isInvalid && 'line-through opacity-70')}>{f.name}</span>
                  {isInvalid && invalidLabel && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex-shrink-0 whitespace-nowrap">
                      {invalidLabel}
                    </span>
                  )}
                  {!isInvalid && (
                    <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}KB`}
                    </span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <div
            className={cn(
              'flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg cursor-pointer transition-colors',
              'border border-dashed border-gray-200 dark:border-gray-700',
              'hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/50',
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <Plus className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400">{addMoreText || dropzoneText}</span>
          </div>
        </>
      )}
    </div>
  );
}

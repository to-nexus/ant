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
        <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{label}</span>
        <div
          ref={iconRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <Info className="w-3.5 h-3.5 cursor-help" style={{ color: 'var(--text-4)' }} />
        </div>
        {showTooltip && (
          <div
            className="fixed z-[10000] -translate-x-1/2 -translate-y-full w-56 p-2 text-xs rounded-lg shadow-lg pointer-events-none"
            style={{
              top: tooltipPos.top,
              left: tooltipPos.left,
              background: 'var(--bg-tooltip, oklch(20% 0.02 290))',
              color: 'oklch(95% 0.01 290)',
            }}
          >
            {tooltip}
          </div>
        )}
        {warning && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{
              background: 'oklch(94% 0.06 75)',
              color: 'oklch(45% 0.16 65)',
            }}
          >
            {warningLabel || 'Ant format'}
          </span>
        )}
      </div>
      {patternHint && (
        <div
          className="text-[10px] font-mono"
          style={{ color: 'var(--text-4)' }}
        >{patternHint}</div>
      )}

      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleChange} />

      {!hasFiles ? (
        <Dropzone onDrop={handleDrop} onClick={() => inputRef.current?.click()}>
          <Upload className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--text-4)' }} />
          <div className="text-xs" style={{ color: 'var(--text-3)' }}>{dropzoneText}</div>
        </Dropzone>
      ) : (
        <>
          <div className={cn('space-y-1 overflow-y-auto', maxFileListHeight)}>
            {files.map((f, i) => {
              const isInvalid = !!validateFilename && !validateFilename(f.name);
              return (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 text-xs px-2 py-1"
                  style={{
                    borderRadius: 'var(--r-sm, 6px)',
                    background: isInvalid ? 'oklch(96% 0.05 75 / 0.6)' : 'var(--bg-surface-2)',
                    color: isInvalid ? 'oklch(50% 0.16 65)' : 'var(--text-2)',
                  }}
                >
                  {isInvalid && (
                    <AlertTriangle
                      className="w-3 h-3 flex-shrink-0"
                      style={{ color: 'oklch(60% 0.18 50)' }}
                    />
                  )}
                  <span className={cn('flex-1 truncate', isInvalid && 'line-through opacity-70')}>{f.name}</span>
                  {isInvalid && invalidLabel && (
                    <span
                      className="text-[10px] px-1 py-0.5 rounded flex-shrink-0 whitespace-nowrap"
                      style={{
                        background: 'oklch(94% 0.06 75)',
                        color: 'oklch(45% 0.16 65)',
                      }}
                    >
                      {invalidLabel}
                    </span>
                  )}
                  {!isInvalid && (
                    <span
                      className="flex-shrink-0"
                      style={{ color: 'var(--text-4)' }}
                    >
                      {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}KB`}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="flex-shrink-0 transition-colors"
                    style={{ color: 'var(--text-4)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--status-error-fg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-4)'; }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <Dropzone
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            variant="addMore"
          >
            <Plus className="w-3.5 h-3.5" style={{ color: 'var(--text-4)' }} />
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>{addMoreText || dropzoneText}</span>
          </Dropzone>
        </>
      )}
    </div>
  );
}

// ─── Dropzone (token-driven, hover-handled inline) ────────────────────

function Dropzone({
  children,
  onDrop,
  onClick,
  variant = 'main',
}: {
  children: React.ReactNode;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  variant?: 'main' | 'addMore';
}) {
  const [hover, setHover] = useState(false);
  const isMain = variant === 'main';
  return (
    <div
      className={cn(
        isMain
          ? 'p-3 text-center cursor-pointer transition-all'
          : 'flex items-center justify-center gap-1.5 py-1.5 px-2.5 cursor-pointer transition-all',
      )}
      style={{
        border: isMain
          ? `2px dashed ${hover ? 'var(--border-3)' : 'var(--border-2)'}`
          : `1px dashed ${hover ? 'var(--border-3)' : 'var(--border-2)'}`,
        borderRadius: 'var(--r-lg, 10px)',
        background: hover ? 'var(--bg-hover)' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

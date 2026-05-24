
import { useState, type ReactNode } from 'react';
import { Folder } from 'lucide-react';
import { ArtifactFileIcon } from '@/presentation/components/ArtifactsPanel/ArtifactFileIcon';
import { cn } from '@/shared/utils/design-system';
import { FileActionMenu } from '../../FileActionMenu';
import type { FileNode } from '@/infrastructure/http/api';

interface ArtifactRowProps {
  node: FileNode;
  level: number;
  isSelected: boolean;
  isMenuActive: boolean;
  isDragTarget: boolean;
  isStructural: boolean;
  isHighlighted: boolean;
  isSpotlighted: boolean;
  isUnseen: boolean;
  unseenCount: number;
  accentColor?: string;
  fileIndicator?: ReactNode;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onActivate: () => void;
  /** Hidden upload input id — when present, FileActionMenu's onUpload triggers it. */
  uploadInputId?: string;
  onMenuOpenChange: (open: boolean) => void;
  /** Pre-built FileActionMenu prop bundle from ArtifactsSection (which owns mutation policy). */
  menuProps: {
    isSessionPath: boolean;
    isClearableDir: boolean;
    isProtectedDir: boolean;
    onSend?: (path: string, type: 'file' | 'directory') => void;
    onDownload?: (path: string) => void;
    onMarkAllSeen?: () => void;
    onCreateFile?: () => void;
    onCreateDirectory?: () => void;
    onUpload?: () => void;
    onRename?: () => void;
    onDelete?: () => void;
    onClearContents?: () => void;
  };
}

/**
 * Single artifact tree row plus its inline rename input. Owns only:
 *  • per-row hover state
 *  • rename input rendering (rename target state is lifted to
 *    ArtifactsSection so a single rename target is enforced)
 *
 * Children recursion is the caller's responsibility — ArtifactRow
 * renders exactly one row plus its inline rename input.
 */
export function ArtifactRow({
  node,
  level,
  isSelected,
  isMenuActive,
  isDragTarget,
  isStructural,
  isHighlighted,
  isSpotlighted,
  isUnseen,
  accentColor,
  fileIndicator,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onActivate,
  uploadInputId,
  onMenuOpenChange,
  menuProps,
}: ArtifactRowProps) {
  const [hover, setHover] = useState(false);
  const isDirectory = node.type === 'directory';
  const folderIconColor = accentColor ?? 'var(--text-3)';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        'flex items-center justify-between group',
        isHighlighted && 'artifact-highlight',
        isSpotlighted && 'artifact-spotlight',
      )}
      style={(() => {
        const base: React.CSSProperties = {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: `4px 10px 4px ${10 + level * 14}px`,
          borderRadius: isSelected ? '0 var(--r-sm) var(--r-sm) 0' : 'var(--r-sm)',
          cursor: 'pointer',
          background: isSelected
            ? 'oklch(from var(--violet-300) l c h / 0.20)'
            : hover
              ? 'var(--bg-hover)'
              : 'transparent',
          borderLeft: isSelected ? '2px solid var(--violet-500)' : '2px solid transparent',
          transition: 'background var(--dur-fast)',
          minHeight: 22,
        };
        if (isHighlighted) {
          base.boxShadow = 'inset 0 0 0 1px var(--violet-300)';
        }
        if (isMenuActive && !isDragTarget) {
          if (isSelected) {
            base.boxShadow = 'inset 0 0 0 1px var(--violet-400)';
          } else {
            base.background = 'oklch(from var(--amber-500) l c h / 0.18)';
            base.boxShadow = 'inset 0 0 0 1px oklch(from var(--amber-500) l c h / 0.45)';
          }
        }
        if (isDragTarget && !isStructural) {
          base.background = 'oklch(from var(--violet-200) l c h / 0.30)';
          base.outline = '2px dashed var(--violet-400)';
          base.outlineOffset = '-2px';
        }
        return base;
      })()}
    >
      <div
        className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
        onClick={onActivate}
      >
        {isDirectory ? (
          <Folder size={12} style={{ color: folderIconColor, flexShrink: 0 }} />
        ) : (
          <ArtifactFileIcon name={node.name} size={12} />
        )}
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (renameValue.trim() && renameValue.trim() !== node.name) {
                  onRenameSubmit();
                } else {
                  onRenameCancel();
                }
              }
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={() => {
              if (renameValue.trim() && renameValue.trim() !== node.name) {
                onRenameSubmit();
              } else {
                onRenameCancel();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 px-1 py-0 text-sm rounded bg-[color:var(--bg-surface)] text-[color:var(--text-1)] outline-none"
            style={{ border: '1px solid var(--violet-400)' }}
            autoFocus
          />
        ) : (
          <>
            <span
              className="font-mono"
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11.5,
                color: isSelected ? 'var(--violet-700)' : 'var(--text-2)',
                fontWeight: isSelected ? 600 : isUnseen ? 700 : level === 0 ? 600 : 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {node.name}
            </span>
            {!isDirectory && fileIndicator}
          </>
        )}
      </div>

      <div
        className={cn(
          'flex items-center gap-1 transition-opacity',
          isMenuActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <FileActionMenu
          nodePath={node.path}
          nodeType={node.type as 'file' | 'directory'}
          nodeName={node.name}
          isSessionPath={menuProps.isSessionPath}
          isProtectedDir={menuProps.isProtectedDir}
          isClearableDir={menuProps.isClearableDir}
          onSend={menuProps.onSend}
          onDownload={menuProps.onDownload}
          onMarkAllSeen={menuProps.onMarkAllSeen}
          onCreateFile={menuProps.onCreateFile}
          onCreateDirectory={menuProps.onCreateDirectory}
          onUpload={menuProps.onUpload ?? (uploadInputId
            ? () => document.getElementById(uploadInputId)?.click()
            : undefined)}
          onRename={menuProps.onRename}
          onDelete={menuProps.onDelete}
          onClearContents={menuProps.onClearContents}
          onOpenChange={onMenuOpenChange}
        />
      </div>
    </div>
  );
}

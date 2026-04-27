/**
 * WorkingCard - Unified status card for both progress and complete states
 * 
 * Handles state transitions within one component (like TerminalCard, ShimmerCard)
 * - Progress: exploring, retrieving, grepping, reading, indexing, analyzing, storing
 * - Complete: explored, retrieved, grepped, read, indexed, analyzed, stored
 */

import { memo, useState } from 'react';
import { Eye, Search, FileSearch, Database, FileCode, Package, ChevronDown, ChevronRight, Download, Palette, Eraser } from 'lucide-react';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { useStore } from '@/domain/store';
import { TruncatableText } from '@/presentation/components/common/TruncatableText';
import { Spinner } from '@/presentation/components/common/async';
import { useImagePreview } from './useImagePreview';
import { ImageLightbox } from './ImageLightbox';
import { lineToContent } from './cards/lineToContent';

// Sentinel marker returned by getVariantConfig when the progress state
// should render a <Spinner> (instead of a specific lucide icon). Used to
// avoid importing the legacy spinner icon outside the primitives directory.
const SPINNER_MARKER = Symbol.for('working-card.spinner');
type IconKind = typeof SPINNER_MARKER | React.ComponentType<{ className?: string }>;

const PREVIEW_MAX_H_SCREENSHOT = 160; // figma_called: full screenshot (px)
const PREVIEW_MAX_H_ASSET = 40;       // downloaded: compact asset thumbnail (px)

interface WorkingCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  variant: 'exploring' | 'explored' | 'retrieving' | 'retrieved' | 'grepping' | 'grepped' | 'listing_files' | 'listed_files' | 'searching_code' | 'searched_code' | 'reading' | 'read' | 'reading_source' | 'read_source' | 'indexing' | 'indexed' | 'analyzing' | 'analyzed' | 'loading' | 'loaded' | 'storing' | 'stored' | 'learning' | 'learned' | 'processing' | 'processed' | 'downloading' | 'downloaded' | 'figma_calling' | 'figma_called';
}

/**
 * Determine if variant is a progress state (~ing) or complete state (~ed)
 */
function isProgressState(variant: string): boolean {
  return ['exploring', 'retrieving', 'grepping', 'listing_files', 'searching_code', 'reading', 'reading_source', 'indexing', 'analyzing', 'loading', 'storing', 'learning', 'processing', 'downloading', 'figma_calling'].includes(variant);
}

/**
 * Get icon and styles based on variant and state. The progress icon may be
 * the `SPINNER_MARKER` sentinel, in which case render <Spinner> instead.
 * `iconClass` never contains a spinner animation directly — any animation
 * below is an ambient domain indicator (`animate-status-pulse`).
 */
function getVariantConfig(
  variant: string,
  isProgress: boolean,
): {
  Icon: IconKind;
  iconClass: string;
  containerClass: string;
  iconColorClass: string;
  textClass: string;
  detailClass: string;
} {
  const baseVariant = variant.replace(/ing$|ed$/, '');

  switch (baseVariant) {
    case 'explor':
      return {
        Icon: isProgress ? SPINNER_MARKER : FileSearch,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
          : 'bg-blue-50/30 dark:bg-blue-900/20 hover:bg-blue-100/50 dark:hover:bg-blue-800/30',
        iconColorClass: isProgress ? 'text-blue-600 dark:text-blue-400' : 'text-blue-500 dark:text-blue-400',
        textClass: 'text-blue-800 dark:text-blue-300',
        detailClass: 'text-blue-600 dark:text-blue-400',
      };
    case 'retriev':
      return {
        Icon: isProgress ? SPINNER_MARKER : Database,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
          : 'bg-indigo-50/30 dark:bg-indigo-900/20 hover:bg-indigo-100/50 dark:hover:bg-indigo-800/30',
        iconColorClass: isProgress ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-500 dark:text-indigo-400',
        textClass: 'text-indigo-800 dark:text-indigo-300',
        detailClass: 'text-indigo-600 dark:text-indigo-400',
      };
    case 'grepp':
      return {
        Icon: Search,
        iconClass: isProgress ? 'animate-status-pulse' : '',
        containerClass: isProgress
          ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800'
          : 'bg-purple-50/30 dark:bg-purple-900/20 hover:bg-purple-100/50 dark:hover:bg-purple-800/30',
        iconColorClass: isProgress ? 'text-purple-600 dark:text-purple-400' : 'text-purple-500 dark:text-purple-400',
        textClass: 'text-purple-800 dark:text-purple-300',
        detailClass: 'text-purple-600 dark:text-purple-400',
      };
    case 'listing_files':
    case 'listed_files':
      return {
        Icon: isProgress ? SPINNER_MARKER : FileSearch,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800'
          : 'bg-cyan-50/30 dark:bg-cyan-900/20 hover:bg-cyan-100/50 dark:hover:bg-cyan-800/30',
        iconColorClass: isProgress ? 'text-cyan-600 dark:text-cyan-400' : 'text-cyan-500 dark:text-cyan-400',
        textClass: 'text-cyan-800 dark:text-cyan-300',
        detailClass: 'text-cyan-600 dark:text-cyan-400',
      };
    case 'searching_code':
    case 'searched_code':
      return {
        Icon: isProgress ? SPINNER_MARKER : Search,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800'
          : 'bg-violet-50/30 dark:bg-violet-900/20 hover:bg-violet-100/50 dark:hover:bg-violet-800/30',
        iconColorClass: isProgress ? 'text-violet-600 dark:text-violet-400' : 'text-violet-500 dark:text-violet-400',
        textClass: 'text-violet-800 dark:text-violet-300',
        detailClass: 'text-violet-600 dark:text-violet-400',
      };
    case 'read':
    case 'reading_source':
    case 'read_source':
      return {
        Icon: Eye,
        iconClass: isProgress ? 'animate-status-pulse' : '',
        containerClass: isProgress
          ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
          : 'bg-indigo-50/30 dark:bg-indigo-900/20 hover:bg-indigo-100/50 dark:hover:bg-indigo-800/30',
        iconColorClass: isProgress ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-500 dark:text-indigo-400',
        textClass: 'text-indigo-800 dark:text-indigo-300',
        detailClass: 'text-indigo-600 dark:text-indigo-400',
      };
    case 'index':
      return {
        Icon: isProgress ? SPINNER_MARKER : Database,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800'
          : 'bg-purple-50/30 dark:bg-purple-900/20 hover:bg-purple-100/50 dark:hover:bg-purple-800/30',
        iconColorClass: isProgress ? 'text-purple-600 dark:text-purple-400' : 'text-purple-500 dark:text-purple-400',
        textClass: 'text-purple-800 dark:text-purple-300',
        detailClass: 'text-purple-600 dark:text-purple-400',
      };
    case 'analyz':
      return {
        Icon: isProgress ? SPINNER_MARKER : FileCode,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'
          : 'bg-emerald-50/30 dark:bg-emerald-900/20 hover:bg-emerald-100/50 dark:hover:bg-emerald-800/30',
        iconColorClass: isProgress ? 'text-emerald-600 dark:text-emerald-400' : 'text-emerald-500 dark:text-emerald-400',
        textClass: 'text-emerald-800 dark:text-emerald-300',
        detailClass: 'text-emerald-600 dark:text-emerald-400',
      };
    case 'load':
      return {
        Icon: isProgress ? SPINNER_MARKER : FileSearch,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800'
          : 'bg-teal-50/30 dark:bg-teal-900/20 hover:bg-teal-100/50 dark:hover:bg-teal-800/30',
        iconColorClass: isProgress ? 'text-teal-600 dark:text-teal-400' : 'text-teal-500 dark:text-teal-400',
        textClass: 'text-teal-800 dark:text-teal-300',
        detailClass: 'text-teal-600 dark:text-teal-400',
      };
    case 'stor':
      return {
        Icon: isProgress ? SPINNER_MARKER : Package,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
          : 'bg-amber-50/30 dark:bg-amber-900/20 hover:bg-amber-100/50 dark:hover:bg-amber-800/30',
        iconColorClass: isProgress ? 'text-amber-600 dark:text-amber-400' : 'text-amber-500 dark:text-amber-400',
        textClass: 'text-amber-800 dark:text-amber-300',
        detailClass: 'text-amber-600 dark:text-amber-400',
      };
    case 'learn':
      return {
        Icon: isProgress ? SPINNER_MARKER : Database,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-200 dark:border-fuchsia-800'
          : 'bg-fuchsia-50/30 dark:bg-fuchsia-900/20 hover:bg-fuchsia-100/50 dark:hover:bg-fuchsia-800/30',
        iconColorClass: isProgress ? 'text-fuchsia-600 dark:text-fuchsia-400' : 'text-fuchsia-500 dark:text-fuchsia-400',
        textClass: 'text-fuchsia-800 dark:text-fuchsia-300',
        detailClass: 'text-fuchsia-600 dark:text-fuchsia-400',
      };
    case 'processing':
    case 'processed':
      return {
        Icon: isProgress ? SPINNER_MARKER : Eraser,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800'
          : 'bg-rose-50/30 dark:bg-rose-900/20 hover:bg-rose-100/50 dark:hover:bg-rose-800/30',
        iconColorClass: isProgress ? 'text-rose-600 dark:text-rose-400' : 'text-rose-500 dark:text-rose-400',
        textClass: 'text-rose-800 dark:text-rose-300',
        detailClass: 'text-rose-600 dark:text-rose-400',
      };
    case 'download':
      return {
        Icon: isProgress ? SPINNER_MARKER : Download,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800'
          : 'bg-orange-50/30 dark:bg-orange-900/20 hover:bg-orange-100/50 dark:hover:bg-orange-800/30',
        iconColorClass: isProgress ? 'text-orange-600 dark:text-orange-400' : 'text-orange-500 dark:text-orange-400',
        textClass: 'text-orange-800 dark:text-orange-300',
        detailClass: 'text-orange-600 dark:text-orange-400',
      };
    case 'figma_call':
      return {
        Icon: isProgress ? SPINNER_MARKER : Palette,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800'
          : 'bg-pink-50/30 dark:bg-pink-900/20 hover:bg-pink-100/50 dark:hover:bg-pink-800/30',
        iconColorClass: isProgress ? 'text-pink-600 dark:text-pink-400' : 'text-pink-500 dark:text-pink-400',
        textClass: 'text-pink-800 dark:text-pink-300',
        detailClass: 'text-pink-600 dark:text-pink-400',
      };
    default:
      return {
        Icon: isProgress ? SPINNER_MARKER : FileSearch,
        iconClass: '',
        containerClass: isProgress
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
          : 'bg-blue-50/30 dark:bg-blue-900/20 hover:bg-blue-100/50 dark:hover:bg-blue-800/30',
        iconColorClass: isProgress ? 'text-blue-600 dark:text-blue-400' : 'text-blue-500 dark:text-blue-400',
        textClass: 'text-blue-800 dark:text-blue-300',
        detailClass: 'text-blue-600 dark:text-blue-400',
      };
  }
}

/** Renders either the primitive <Spinner> or the custom lucide icon. */
function WorkingIcon({ icon, iconClass, colorClass }: { icon: IconKind; iconClass: string; colorClass: string }) {
  if (icon === SPINNER_MARKER) {
    return <Spinner size="md" tone="inherit" className={`flex-shrink-0 ${colorClass}`} />;
  }
  const IconComp = icon;
  return <IconComp className={`w-4 h-4 ${colorClass} ${iconClass} flex-shrink-0`} />;
}

/**
 * Shared header row used by every chat status card layout in this file
 * (inline strip and expandable card). Keeps the flex chain consistent so
 * `TruncatableText`'s `truncate` span stays inside the row's `min-w-0`
 * budget and never wraps the trailing chevron onto a second line.
 *
 * Structure:
 *   [icon][flex-1 min-w-0: title row + optional detail][optional chevron]
 *
 * Rendered directly as flex children of its parent row — the caller owns
 * the outer container (div / button) and its padding / gap / bg color.
 */
interface WorkingCardHeaderProps {
  icon: IconKind;
  iconClass: string;
  iconColorClass: string;
  title: string;
  titleClassName: string;
  titleButtonClassName: string;
  detail?: string | undefined;
  detailClassName: string;
  isExpanded: boolean;
  hasExpandable: boolean;
}

function WorkingCardHeader({
  icon,
  iconClass,
  iconColorClass,
  title,
  titleClassName,
  titleButtonClassName,
  detail,
  detailClassName,
  isExpanded,
  hasExpandable,
}: WorkingCardHeaderProps) {
  return (
    <>
      <WorkingIcon icon={icon} iconClass={iconClass} colorClass={iconColorClass} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <TruncatableText
            text={title}
            maxLength={60}
            className={`text-xs font-medium ${titleClassName}`}
            buttonClassName={titleButtonClassName}
          />
        </div>
        {detail && (
          <div className={`text-xs mt-0.5 ${detailClassName} break-all`}>
            {detail}
          </div>
        )}
      </div>
      {hasExpandable && (
        <div className="flex-shrink-0">
          {isExpanded
            ? <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400 opacity-60" />
            : <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400 opacity-60" />}
        </div>
      )}
    </>
  );
}

export const WorkingCard = memo(function WorkingCard({ line, pending, variant }: WorkingCardProps) {
  const content = lineToContent(line, pending);
  const [isExpanded, setIsExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isProgress = isProgressState(variant);
  const { Icon, iconClass, containerClass, iconColorClass, textClass, detailClass } = getVariantConfig(variant, isProgress);

  const selectedFile = useStore(state => state.selectedFile);
  const selectFile = useStore(state => state.selectFile);
  const setLastViewMode = useStore(state => state.setLastViewMode);
  const hasImagePreview = !isProgress && (variant === 'figma_called' || variant === 'downloaded') && !!content.metadata?.imagePath;
  const previewUrl = useImagePreview(hasImagePreview ? content.metadata!.imagePath : undefined);
  
  // Extract data from metadata (for complete states)
  const filesList = content.metadata?.filesList || [];
  const hasFiles = filesList.length > 0;
  
  // Stats for indexed/analyzed results
  const stats: Array<{ icon: React.ReactNode; label: string; value: string | number }> = [];
  if (content.metadata?.filesIndexed) {
    stats.push({ 
      icon: <FileSearch className="w-3 h-3" />, 
      label: 'Files', 
      value: content.metadata.filesIndexed 
    });
  }
  if (content.metadata?.chunks) {
    stats.push({ 
      icon: <Database className="w-3 h-3" />, 
      label: 'Chunks', 
      value: content.metadata.chunks 
    });
  }
  if (content.metadata?.tokens) {
    const tokensK = Math.round(content.metadata.tokens / 1000);
    stats.push({ 
      icon: <Package className="w-3 h-3" />, 
      label: 'Tokens', 
      value: `~${tokensK}K` 
    });
  }

  const hasStats = stats.length > 0;
  const hasError = !!(content.metadata as { error?: unknown } | undefined)?.error;
  // Progress cards become expandable when an aggregator (see
  // aggregateChatStatuses) has merged multiple slots and attached a
  // `filesList`. Non-aggregated single progress cards render as the
  // compact inline strip below. Error slots never expand — the drawer
  // would hide the failure path, and a chevron suggests interactivity
  // that the card does not offer.
  const hasExpandable = !hasError && (hasFiles || (!isProgress && hasStats));

  // Shared header props for both layouts. Title / button colours follow
  // variant config for in-flight cards and a neutral gray for completed
  // cards (matches the prior design for the expandable variant).
  const headerProps: Omit<WorkingCardHeaderProps, 'isExpanded' | 'hasExpandable'> = {
    icon: Icon,
    iconClass: isProgress ? iconClass : '',
    iconColorClass,
    title: content.content || '',
    titleClassName: isProgress ? textClass : 'text-gray-700 dark:text-gray-300',
    titleButtonClassName: isProgress
      ? `${textClass} opacity-60`
      : 'text-gray-600 dark:text-gray-400 opacity-60',
    detail: content.metadata?.detail,
    detailClassName: detailClass,
  };

  // Progress state without a file list → compact inline strip (no chevron).
  if (isProgress && !hasFiles) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${containerClass}`}>
        <WorkingCardHeader {...headerProps} isExpanded={false} hasExpandable={false} />
      </div>
    );
  }

  // downloaded asset → click opens file in editor (image preview already built-in)
  const isDownloadedAsset = variant === 'downloaded' && !!content.metadata?.imagePath;
  const openAssetPreview = () => {
    const path = content.metadata!.imagePath!;
    if (selectedFile === path) {
      selectFile(undefined);
    } else {
      setLastViewMode('preview');
      selectFile(path);
    }
  };
  const handleCardClick = () => {
    if (isDownloadedAsset) {
      openAssetPreview();
    } else if (hasExpandable) {
      setIsExpanded(!isExpanded);
    }
  };

  // Complete state — or aggregated progress state — expandable card.
  // The wrapper is intentionally a <div role="button"> rather than <button>:
  // it nests a TruncatableText chevron control, an image preview <button>,
  // and other interactive children. A real <button> here would produce
  // invalid HTML (button-in-button), which the browser silently rewrites
  // and which can throw off react-virtuoso's row-height measurement.
  const interactive = hasExpandable || isDownloadedAsset;
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };
  return (
    <div className="border border-gray-200/50 dark:border-gray-700/50 rounded-lg overflow-hidden bg-transparent">
      <div
        role="button"
        tabIndex={interactive ? 0 : -1}
        aria-disabled={!interactive}
        className={`w-full flex items-center gap-2 px-3 py-2 transition-colors 
                    ${containerClass}
                    ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={interactive ? handleCardClick : undefined}
        onKeyDown={handleCardKeyDown}
      >
        <WorkingCardHeader
          {...headerProps}
          isExpanded={isExpanded}
          hasExpandable={hasExpandable}
        />
      </div>

      {/* Image preview block — screenshot (figma_called) or asset thumbnail (downloaded) */}
      {previewUrl && (
        <div className={`border-t border-gray-200/50 dark:border-gray-700/50 bg-gray-50/30 dark:bg-gray-900/20 p-2
                         flex justify-center`}>
          <button
            type="button"
            onClick={isDownloadedAsset ? openAssetPreview : () => setLightboxOpen(true)}
            className={`rounded-md overflow-hidden border border-gray-200/60 dark:border-gray-600/60 hover:border-gray-400 dark:hover:border-gray-400 transition-colors
                        ${isDownloadedAsset ? 'cursor-pointer' : 'cursor-zoom-in'}`}
          >
            <img
              src={previewUrl}
              alt={content.metadata?.toolName || content.metadata?.filename || 'preview'}
              style={{ maxHeight: isDownloadedAsset ? PREVIEW_MAX_H_ASSET : PREVIEW_MAX_H_SCREENSHOT }}
              className="w-auto object-contain bg-white/50 dark:bg-gray-800/50"
            />
          </button>
        </div>
      )}
      
      {hasExpandable && isExpanded && (
        <div className="border-t border-gray-200/50 dark:border-gray-700/50 max-h-60 overflow-y-auto scrollbar-thin bg-gray-50/20 dark:bg-gray-900/10">
          {/* Stats Section */}
          {hasStats && (
            <div className="px-4 py-3 border-b border-gray-200/30 dark:border-gray-700/30">
              <div className="grid grid-cols-3 gap-3">
                {stats.map((stat, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <span className="text-gray-500 dark:text-gray-400">
                      {stat.icon}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {stat.label}:
                    </span>
                    <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Files List Section */}
          {hasFiles && (
            <div className="px-4 py-2 text-xs">
              <div className="space-y-1">
                {filesList.map((file: any, idx: number) => {
                  const filePath = typeof file === 'string' ? file : file.path;
                  return (
                    <div 
                      key={idx} 
                      className="flex items-start gap-2 py-1 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    >
                      <FileCode className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-gray-400 dark:text-gray-500" />
                      <span className="font-mono break-all">{filePath}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox modal (figma_called only) */}
      {lightboxOpen && previewUrl && variant === 'figma_called' && (
        <ImageLightbox
          src={previewUrl}
          alt={content.metadata?.toolName || content.metadata?.filePath || 'preview'}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
});

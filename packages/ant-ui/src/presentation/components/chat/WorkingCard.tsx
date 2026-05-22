
/**
 * WorkingCard - Unified status card for both progress and complete states.
 *
 * Aurora re-skin (T7): all surfaces / borders / text use var(--…) tokens
 * that auto-flip under [data-theme=dark]. Per-variant tinting is
 * expressed as an OKLCH hue (per a3-cards reference) and rendered via
 * `oklch(…)` color-space recipes off the bg-surface / bg-surface-2
 * tokens. No theme-prefix classes, no hex literals, no Tailwind palette
 * classes (bg-blue-*, text-amber-*, etc.).
 */

import { memo, useState } from 'react';
import {
  Eye, Search, FileSearch, Database, FileCode, Package,
  ChevronDown, ChevronRight, Download, Palette, Eraser,
} from 'lucide-react';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { useStore } from '@/domain/store';
import { TruncatableText } from '@/presentation/components/common/TruncatableText';
import { Spinner } from '@/presentation/components/common/async';
import { useImagePreview } from './useImagePreview';
import { ImageLightbox } from './ImageLightbox';
import { lineToContent } from './cards/lineToContent';
import { TurnCardShell } from './cards/TurnCardShell';

// Sentinel marker returned by variantIcon when the progress state should
// render a <Spinner> (instead of a specific lucide icon). Used to avoid
// importing the legacy spinner icon outside the primitives directory.
const SPINNER_MARKER = Symbol.for('working-card.spinner');
type IconKind = typeof SPINNER_MARKER | React.ComponentType<{ className?: string }>;

const PREVIEW_MAX_H_SCREENSHOT = 160; // figma_called: full screenshot (px)
const PREVIEW_MAX_H_ASSET = 40;       // downloaded: compact asset thumbnail (px)

interface WorkingCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  variant:
    | 'exploring' | 'explored' | 'retrieving' | 'retrieved'
    | 'grepping' | 'grepped'
    | 'listing_files' | 'listed_files'
    | 'searching_code' | 'searched_code'
    | 'reading' | 'read' | 'reading_source' | 'read_source'
    | 'indexing' | 'indexed'
    | 'analyzing' | 'analyzed'
    | 'loading' | 'loaded'
    | 'storing' | 'stored'
    | 'learning' | 'learned'
    | 'processing' | 'processed'
    | 'downloading' | 'downloaded'
    | 'figma_calling' | 'figma_called';
}

/** Progress state (~ing) vs complete state (~ed). */
function isProgressState(variant: string): boolean {
  return [
    'exploring', 'retrieving', 'grepping', 'listing_files', 'searching_code',
    'reading', 'reading_source', 'indexing', 'analyzing', 'loading', 'storing',
    'learning', 'processing', 'downloading', 'figma_calling',
  ].includes(variant);
}

/** Per-variant hue (OKLCH). Mirrors a3-cards.jsx VARIANT_CONFIG. */
function variantHue(variant: string): number {
  switch (variant) {
    case 'exploring': case 'explored': return 240;
    case 'retrieving': case 'retrieved':
    case 'reading': case 'read':
    case 'reading_source': case 'read_source': return 270;
    case 'grepping': case 'grepped':
    case 'indexing': case 'indexed': return 295;
    case 'listing_files': case 'listed_files': return 200;
    case 'searching_code': case 'searched_code': return 290;
    case 'analyzing': case 'analyzed': return 160;
    case 'loading': case 'loaded': return 180;
    case 'storing': case 'stored': return 75;
    case 'learning': case 'learned': return 320;
    case 'processing': case 'processed': return 10;
    case 'downloading': case 'downloaded': return 40;
    case 'figma_calling': case 'figma_called': return 340;
    default: return 270;
  }
}

/** Per-variant icon component (or SPINNER_MARKER for in-flight). */
function variantIcon(variant: string, isProgress: boolean): { Icon: IconKind; pulse: boolean } {
  switch (variant) {
    case 'exploring': case 'explored':   return { Icon: isProgress ? SPINNER_MARKER : FileSearch, pulse: false };
    case 'retrieving': case 'retrieved': return { Icon: isProgress ? SPINNER_MARKER : Database,   pulse: false };
    case 'grepping': case 'grepped':     return { Icon: Search, pulse: isProgress };
    case 'listing_files': case 'listed_files':   return { Icon: isProgress ? SPINNER_MARKER : FileSearch, pulse: false };
    case 'searching_code': case 'searched_code': return { Icon: isProgress ? SPINNER_MARKER : Search,     pulse: false };
    case 'reading': case 'read':
    case 'reading_source': case 'read_source':   return { Icon: Eye, pulse: isProgress };
    case 'indexing': case 'indexed':     return { Icon: isProgress ? SPINNER_MARKER : Database,   pulse: false };
    case 'analyzing': case 'analyzed':   return { Icon: isProgress ? SPINNER_MARKER : FileCode,   pulse: false };
    case 'loading': case 'loaded':       return { Icon: isProgress ? SPINNER_MARKER : FileSearch, pulse: false };
    case 'storing': case 'stored':       return { Icon: isProgress ? SPINNER_MARKER : Package,    pulse: false };
    case 'learning': case 'learned':     return { Icon: isProgress ? SPINNER_MARKER : Database,   pulse: false };
    case 'processing': case 'processed': return { Icon: isProgress ? SPINNER_MARKER : Eraser,     pulse: false };
    case 'downloading': case 'downloaded':       return { Icon: isProgress ? SPINNER_MARKER : Download,   pulse: false };
    case 'figma_calling': case 'figma_called':   return { Icon: isProgress ? SPINNER_MARKER : Palette,    pulse: false };
    default: return { Icon: isProgress ? SPINNER_MARKER : FileSearch, pulse: false };
  }
}

/** Tint recipes — composed from oklch() against bg-surface tokens
 *  so light/dark themes flow through the same hue while perceptual L/C
 *  remain balanced (see aurora-tokens.css). */
function tintBg(hue: number, intensity: 'soft' | 'firm'): string {
  return intensity === 'firm'
    ? `oklch(from var(--bg-surface-2) calc(l - 0.02) max(c, 0.06) ${hue})`
    : `oklch(from var(--bg-surface-2) calc(l - 0.01) max(c, 0.025) ${hue})`;
}
function tintFg(hue: number): string {
  return `oklch(56% 0.20 ${hue})`;
}
function tintBorder(hue: number): string {
  return `oklch(72% 0.18 ${hue} / 0.35)`;
}

/** Renders either the primitive <Spinner> or the custom lucide icon. */
function WorkingIcon({ icon, pulse, color }: { icon: IconKind; pulse: boolean; color: string }) {
  if (icon === SPINNER_MARKER) {
    return (
      <span className="flex-shrink-0 inline-flex" style={{ color }}>
        <Spinner size="md" tone="inherit" />
      </span>
    );
  }
  const IconComp = icon;
  return (
    <span className={`flex-shrink-0 inline-flex ${pulse ? 'animate-status-pulse' : ''}`} style={{ color }}>
      <IconComp className="w-3.5 h-3.5" />
    </span>
  );
}

interface WorkingCardHeaderProps {
  icon: IconKind;
  pulse: boolean;
  iconColor: string;
  title: string;
  titleColor: string;
  detail?: string | undefined;
  detailColor: string;
  isExpanded: boolean;
  hasExpandable: boolean;
}

function WorkingCardHeader({
  icon, pulse, iconColor,
  title, titleColor,
  detail, detailColor,
  isExpanded, hasExpandable,
}: WorkingCardHeaderProps) {
  return (
    <>
      <WorkingIcon icon={icon} pulse={pulse} color={iconColor} />
      <div className="flex-1 min-w-0" style={{ color: titleColor }}>
        <div className="flex items-center gap-1 min-w-0">
          <TruncatableText
            text={title}
            maxLength={60}
            className="text-[11px] font-medium"
            buttonClassName="opacity-60"
          />
        </div>
        {detail && (
          <div
            className="text-[11px] mt-0.5 break-all"
            style={{ color: detailColor }}
          >
            {detail}
          </div>
        )}
      </div>
      {hasExpandable && (
        <div className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>
          {isExpanded
            ? <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            : <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
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
  const hue = variantHue(variant);
  const { Icon, pulse } = variantIcon(variant, isProgress);

  const selectedFile = useStore(state => state.selectedFile);
  const selectFile = useStore(state => state.selectFile);
  const setFileViewMode = useStore(state => state.setFileViewMode);
  const hasImagePreview =
    !isProgress && (variant === 'figma_called' || variant === 'downloaded') && !!content.metadata?.imagePath;
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
      value: content.metadata.filesIndexed,
    });
  }
  if (content.metadata?.chunks) {
    stats.push({
      icon: <Database className="w-3 h-3" />,
      label: 'Chunks',
      value: content.metadata.chunks,
    });
  }
  if (content.metadata?.tokens) {
    const tokensK = Math.round(content.metadata.tokens / 1000);
    stats.push({
      icon: <Package className="w-3 h-3" />,
      label: 'Tokens',
      value: `~${tokensK}K`,
    });
  }

  const hasStats = stats.length > 0;
  const hasError = !!(content.metadata as { error?: unknown } | undefined)?.error;
  const hasExpandable = !hasError && (hasFiles || (!isProgress && hasStats));

  const tintedBg = tintBg(hue, isProgress ? 'firm' : 'soft');
  const tintedFg = tintFg(hue);
  const tintedBorder = tintBorder(hue);
  const titleColor = isProgress ? tintedFg : 'var(--text-1)';
  const detailColor = isProgress ? tintedFg : 'var(--text-3)';

  const headerProps: Omit<WorkingCardHeaderProps, 'isExpanded' | 'hasExpandable'> = {
    icon: Icon,
    pulse,
    iconColor: tintedFg,
    title: content.content || '',
    titleColor,
    detail: content.metadata?.detail,
    detailColor,
  };

  // Progress state without a file list → compact inline strip (no chevron, no shell).
  if (isProgress && !hasFiles) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5"
        style={{
          background: tintedBg,
          border: `1px solid ${tintedBorder}`,
          borderRadius: 'var(--r-md)',
        }}
      >
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
      setFileViewMode(path, 'preview');
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

  const interactive = hasExpandable || isDownloadedAsset;
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  return (
    <TurnCardShell hoverLift={interactive} accent={hasError ? 'error' : 'default'}>
      <div
        role="button"
        tabIndex={interactive ? 0 : -1}
        aria-disabled={!interactive}
        className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 transition-colors ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
        style={{ background: tintedBg }}
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
        <div
          className="p-2 flex justify-center"
          style={{
            borderTop: '1px solid var(--border-1)',
            background: 'var(--bg-surface-2)',
          }}
        >
          <button
            type="button"
            onClick={isDownloadedAsset ? openAssetPreview : () => setLightboxOpen(true)}
            className={`rounded-md overflow-hidden transition-colors ${isDownloadedAsset ? 'cursor-pointer' : 'cursor-zoom-in'}`}
            style={{ border: '1px solid var(--border-1)' }}
          >
            <img
              src={previewUrl}
              alt={content.metadata?.toolName || content.metadata?.filename || 'preview'}
              style={{
                maxHeight: isDownloadedAsset ? PREVIEW_MAX_H_ASSET : PREVIEW_MAX_H_SCREENSHOT,
                background: 'var(--bg-surface)',
              }}
              className="w-auto object-contain"
            />
          </button>
        </div>
      )}

      {hasExpandable && isExpanded && (
        <div
          className="max-h-60 overflow-y-auto scrollbar-thin"
          style={{
            borderTop: '1px solid var(--border-1)',
            background: 'var(--bg-surface-2)',
          }}
        >
          {/* Stats Section */}
          {hasStats && (
            <div
              className="px-4 py-3"
              style={{ borderBottom: '1px solid var(--border-1)' }}
            >
              <div className="grid grid-cols-3 gap-3">
                {stats.map((stat, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <span style={{ color: 'var(--text-3)' }}>
                      {stat.icon}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                      {stat.label}:
                    </span>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>
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
                  // Aggregated read / read_source slots carry a per-file
                  // line range so the drawer matches the single-card header
                  // format (`Read: src/foo.ts (L42-L50)`). Other
                  // families (list / grep / explore) send plain strings, so
                  // this branch falls through to no label.
                  const lineRange =
                    typeof file === 'object' && file?.startLine
                      ? ` (L${file.startLine}-L${file.endLine ?? '?'})`
                      : '';
                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-2 py-1 transition-colors"
                      style={{ color: 'var(--text-2)' }}
                    >
                      <span style={{ color: 'var(--text-3)' }} className="flex-shrink-0 mt-0.5 inline-flex">
                        <FileCode className="w-3.5 h-3.5" />
                      </span>
                      <span className="break-all" style={{ fontFamily: 'var(--font-mono)' }}>
                        {filePath}
                        {lineRange && (
                          <span style={{ color: 'var(--text-3)' }}>{lineRange}</span>
                        )}
                      </span>
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
    </TurnCardShell>
  );
});

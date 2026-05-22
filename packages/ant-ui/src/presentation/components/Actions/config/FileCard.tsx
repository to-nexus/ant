import {
  CheckCircle2,
  Circle,
  Lock,
  AlertTriangle,
  Eye,
  Unplug,
  Info,
} from 'lucide-react';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import type { SlotWarning } from './types';

export interface FileCardProps {
  name: string;
  path: string;
  warnings?: SlotWarning[];
  description?: { en: string; ko: string } | null;
  icon?: React.ReactNode;
  selected?: boolean;
  locked?: boolean;
  disabled?: boolean;
  empty?: boolean;
  emptyStyle?: 'amber' | 'gray';
  onToggle?: () => void;
  onViewFile?: () => void;
  spotlight?: { active: boolean; onClick: () => void; title: string };
  actions?: React.ReactNode;
  lang: 'en' | 'ko';
}

export function FileCard({ name, path, warnings, description, icon, selected, locked, disabled, empty, emptyStyle, onToggle, onViewFile, spotlight, actions, lang }: FileCardProps) {
  const hasWarnings = warnings && warnings.length > 0;
  const isDisabled = disabled || hasWarnings;
  const isEmpty = empty || false;
  const isAmber = emptyStyle === 'amber';

  // §R13: empty variants migrated from Tailwind amber/gray palette to
  // Aurora-token inline-style recipes (oklch alpha for the surface,
  // dashed border via inline shorthand). Non-empty branches stay on
  // existing token classNames (out of §R13 scope).
  const emptyAmberStyle: React.CSSProperties = {
    background: 'oklch(from var(--amber-50) l c h / 0.5)',
    border: '1px dashed var(--amber-300)',
  };
  const emptyGrayStyle: React.CSSProperties = {
    background: 'oklch(from var(--bg-surface-2) l c h / 0.5)',
    border: '1px dashed var(--border-2)',
    opacity: 0.5,
  };
  const wrapperStyle: React.CSSProperties | undefined = isEmpty
    ? isAmber
      ? emptyAmberStyle
      : emptyGrayStyle
    : undefined;

  const borderClass = isEmpty
    ? ''
    : hasWarnings || isDisabled
      ? 'bg-[color:var(--bg-canvas)]/50 border-[color:var(--border-1)] opacity-60'
      : locked
        ? 'bg-emerald-50 border-emerald-200'
        : selected
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-[color:var(--bg-canvas)]/50 border-[color:var(--border-1)] opacity-60';

  // For empty branches the wrapper applies its own border via inline-style
  // (dashed) — skip the Tailwind `border` utility so it doesn't paint a
  // solid 1px line under the dashed inline border.
  const borderUtil = isEmpty ? '' : 'border';

  const nameClass = isEmpty && isAmber
    ? 'text-sm truncate block font-medium'
    : `text-sm truncate block ${hasWarnings ? 'text-[color:var(--text-4)]' : 'text-[color:var(--text-1)]'}`;
  const nameStyle: React.CSSProperties | undefined =
    isEmpty && isAmber ? { color: 'var(--amber-700)' } : undefined;

  const canToggle = !isDisabled && !locked && !!onToggle;

  return (
    <div
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${borderUtil} ${borderClass}`}
      style={wrapperStyle}
    >
      <button
        type="button"
        onClick={() => canToggle && onToggle?.()}
        disabled={!canToggle}
        className={`flex items-center gap-2 min-w-0 ${canToggle ? 'cursor-pointer' : ''}`}
      >
        <span className="shrink-0">
          {icon ?? (
            isEmpty
              ? <Circle className={`w-4 h-4 ${isAmber ? 'text-amber-400' : 'text-gray-400'}`} />
              : hasWarnings
                ? <Circle className="w-4 h-4 text-gray-300" />
                : locked
                  ? <Lock className="w-4 h-4 text-emerald-500" />
                  : selected
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    : <Circle className="w-4 h-4 text-gray-400" />
          )}
        </span>
        <span className="min-w-0 text-left">
          <span className={nameClass} style={nameStyle}>{name}</span>
          <span className="text-xs text-[color:var(--text-4)] truncate block">{path}</span>
        </span>
      </button>
      <div className="flex items-center gap-1.5 shrink-0">
        {description && <InfoIcon description={description} lang={lang} />}
        {warnings?.filter(w => w.type === 'invalid-file').map((w, i) => (
          <WarningIcon key={`warn-file-${i}`} warning={w} onViewFile={onViewFile} lang={lang} />
        ))}
        {warnings?.filter(w => w.type === 'invalid-env').map((w, i) => (
          <WarningIcon key={`warn-env-${i}`} warning={w} lang={lang} />
        ))}
      </div>
      {(actions || spotlight) && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {actions}
          {spotlight && (
            <SpotlightToggle active={spotlight.active} onClick={spotlight.onClick} title={spotlight.title} />
          )}
        </div>
      )}
    </div>
  );
}

function WarningIcon({ warning, onViewFile, lang }: {
  warning: SlotWarning;
  onViewFile?: () => void;
  lang: 'en' | 'ko';
}) {
  const isFile = warning.type === 'invalid-file';
  const Icon = isFile ? AlertTriangle : Unplug;
  const iconColor = isFile ? 'text-amber-500' : 'text-red-400';
  const viewLabel = lang === 'ko' ? '보러가기' : 'View file';

  return (
    <Tooltip
      content={
        <div className="space-y-2 max-w-[220px]">
          <p className="text-xs">{warning.message[lang] || warning.message.en}</p>
          <div className="flex items-center gap-2">
            {isFile && onViewFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onViewFile(); }}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                {viewLabel}
              </button>
            )}
            {warning.onFix && warning.fixLabel && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); warning.onFix!(); }}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                {warning.fixLabel[lang] || warning.fixLabel.en}
              </button>
            )}
          </div>
        </div>
      }
      placement="top"
    >
      <span className={`inline-flex items-center justify-center shrink-0 p-1.5 rounded-lg ${iconColor} cursor-pointer hover:bg-[color:var(--bg-hover)] transition-colors`}>
        <Icon className="w-4.5 h-4.5" />
      </span>
    </Tooltip>
  );
}

function InfoIcon({ description, lang }: { description: { en: string; ko: string }; lang: 'en' | 'ko' }) {
  return (
    <Tooltip
      content={<p className="text-sm leading-relaxed">{description[lang] || description.en}</p>}
      className="max-w-sm !px-5 !py-4 !text-base !rounded-xl"
      placement="top"
    >
      <span className="inline-flex items-center justify-center shrink-0 p-1.5 rounded-lg text-[color:var(--text-4)] cursor-pointer hover:text-blue-500 hover:bg-[color:var(--bg-hover)] transition-colors">
        <Info className="w-4.5 h-4.5" />
      </span>
    </Tooltip>
  );
}

function SpotlightToggle({ active, onClick, title }: { active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 p-2 rounded-lg transition-colors ${
        active
          ? 'bg-amber-200 text-amber-700'
          : 'bg-[color:var(--bg-surface-2)]/50 text-[color:var(--text-3)] hover:bg-[color:var(--bg-active)]'
      }`}
      title={title}
    >
      <Eye className="w-4.5 h-4.5" />
    </button>
  );
}

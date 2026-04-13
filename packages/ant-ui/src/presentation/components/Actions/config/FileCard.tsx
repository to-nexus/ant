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

  const borderClass = isEmpty
    ? isAmber
      ? 'border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10'
      : 'border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20 opacity-50'
    : hasWarnings || isDisabled
      ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60'
      : locked
        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
        : selected
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
          : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60';

  const nameClass = isEmpty && isAmber
    ? 'text-sm truncate block text-amber-700 dark:text-amber-300 font-medium'
    : `text-sm truncate block ${hasWarnings ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`;

  const canToggle = !isDisabled && !locked && !!onToggle;

  return (
    <div className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all border ${borderClass}`}>
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
          <span className={nameClass}>{name}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate block">{path}</span>
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
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                {viewLabel}
              </button>
            )}
            {warning.onFix && warning.fixLabel && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); warning.onFix!(); }}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                {warning.fixLabel[lang] || warning.fixLabel.en}
              </button>
            )}
          </div>
        </div>
      }
      placement="top"
    >
      <span className={`inline-flex items-center justify-center shrink-0 p-1.5 rounded-lg ${iconColor} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`}>
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
      <span className="inline-flex items-center justify-center shrink-0 p-1.5 rounded-lg text-gray-400 dark:text-gray-500 cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
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
          ? 'bg-amber-200 dark:bg-amber-700/50 text-amber-700 dark:text-amber-300'
          : 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/50'
      }`}
      title={title}
    >
      <Eye className="w-4.5 h-4.5" />
    </button>
  );
}

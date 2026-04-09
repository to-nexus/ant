import { useTranslation } from 'react-i18next';
import { type ActionId, type ActionReadiness } from '@ant/shared';
import { RefreshCw } from 'lucide-react';

interface ActionModeIndicatorProps {
  actionId: ActionId;
  readiness: ActionReadiness;
  selectedSubModeId: string | null;
}

const MODE_BG: Record<string, string> = {
  'spec-based': 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
  'design-doc-based': 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  'directive-based': 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700',
  refactor: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  'refactor-capable': 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
};

const ACTIONS_WITH_MODE_BANNER: Set<ActionId> = new Set(['code', 'system-design']);

export function ActionModeIndicator({ actionId, readiness, selectedSubModeId }: ActionModeIndicatorProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'ko';

  const modeId = selectedSubModeId || readiness.detectedMode.id;
  const modeLabel = readiness.detectedMode.label[lang] || readiness.detectedMode.label.en;
  const bg = MODE_BG[modeId];
  const showBanner = ACTIONS_WITH_MODE_BANNER.has(actionId) && bg;

  const showRefactorHint = readiness.hasCodebase
    && actionId !== 'learn' && actionId !== 'plan' && actionId !== 'visual'
    && modeId !== 'refactor';

  if (!showBanner && !showRefactorHint) return null;

  return (
    <div className="space-y-2">
      {showBanner && (
        <div className={`border rounded-lg p-3 ${bg}`}>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {modeLabel}
          </div>
        </div>
      )}

      {showRefactorHint && (
        <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 ml-1">
          <RefreshCw className="w-3 h-3" />
          <span>
            {lang === 'ko'
              ? '기존 코드베이스에 대한 리팩토링도 가능합니다'
              : 'Refactoring of existing codebase is also possible'}
          </span>
        </div>
      )}
    </div>
  );
}

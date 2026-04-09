import { useTranslation } from 'react-i18next';
import { type ActionId, type ActionReadiness, ACTION_DEFINITIONS, UI_DESIGN_SUB_MODES } from '@ant/shared';
import { ACTION_VISUALS } from './ActionChip';
import { ChevronLeft, Figma, Image, MessageSquare } from 'lucide-react';

const MODE_ICONS: Record<string, any> = {
  figma: Figma,
  references: Image,
  description: MessageSquare,
};

const MODE_COLORS: Record<string, { bg: string; border: string }> = {
  figma: { bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800' },
  references: { bg: 'bg-pink-50 dark:bg-pink-900/20', border: 'border-pink-200 dark:border-pink-800' },
  description: { bg: 'bg-gray-50 dark:bg-gray-800/50', border: 'border-gray-200 dark:border-gray-700' },
};

interface ActionSubModeStepProps {
  actionId: ActionId;
  readiness: ActionReadiness;
  onSelect: (modeId: string) => void;
  onBack: () => void;
}

export function ActionSubModeStep({ actionId, readiness, onSelect, onBack }: ActionSubModeStepProps) {
  const { t, i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';

  if (actionId !== 'ui-design' || !readiness.subModes) return null;

  const def = ACTION_DEFINITIONS.find(d => d.id === actionId);
  const visual = ACTION_VISUALS[actionId];
  const Icon = visual.icon;

  return (
    <div className="flex flex-col h-full p-5">
      {/* Back + Title inline */}
      <div className="flex items-center gap-2 mb-6">
        <button
          type="button"
          onClick={onBack}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${visual.bg}`}>
          <Icon className={`w-3.5 h-3.5 ${visual.text}`} />
        </div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {def?.label[lang] || def?.label.en}
        </h2>
      </div>

      {/* Sub-mode question */}
      <div className="flex-1 flex flex-col items-center justify-center max-w-lg mx-auto w-full">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 text-center">
          {t('actions.ui-design.pickMode')}
        </p>

        <div className="space-y-3 w-full">
          {UI_DESIGN_SUB_MODES.map(mode => {
            const status = readiness.subModes?.find(s => s.id === mode.id);
            const isActive = status?.active ?? false;
            const ModeIcon = MODE_ICONS[mode.id] || MessageSquare;
            const colors = MODE_COLORS[mode.id] || MODE_COLORS.description;
            const blockReason = status?.blockReason;

            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => isActive ? onSelect(mode.id) : undefined}
                disabled={!isActive}
                className={`
                  w-full rounded-2xl border p-4 flex items-start gap-4 text-left
                  transition-all duration-200
                  ${isActive
                    ? `${colors.bg} ${colors.border} cursor-pointer hover:shadow-md hover:scale-[1.01] active:scale-[0.99]`
                    : 'bg-gray-50/50 dark:bg-gray-800/20 border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed'}
                `}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isActive ? colors.bg : 'bg-gray-100 dark:bg-gray-800'}`}>
                  <ModeIcon className={`w-5 h-5 ${isActive ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {mode.label[lang] || mode.label.en}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {mode.description[lang] || mode.description.en}
                  </p>
                  {!isActive && blockReason && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                      {blockReason[lang] || blockReason.en}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

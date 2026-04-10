import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ACTION_DEFINITIONS, getIntentsForAction, deriveFromIntent, type ActionId, type ActionReadiness } from '@ant/shared';
import { ActionChip } from './ActionChip';

const EMPTY_READINESS: ActionReadiness = {
  buildReady: false,
  hasOutput: false,
  hasCodebase: false,
  detectedMode: { id: 'unknown', label: { en: '', ko: '' } },
  outputDir: '',
  namingIssues: [],
};

interface ActionChipGridProps {
  readiness: Record<ActionId, ActionReadiness>;
  variant: 'compact' | 'large';
  onSelect: (actionId: ActionId) => void;
  agentFilter?: string;
  title?: string;
  subtitle?: string;
}

export function ActionChipGrid({ readiness, variant, onSelect, agentFilter, title, subtitle }: ActionChipGridProps) {
  const { i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';

  const defs = useMemo(() => {
    if (!agentFilter) return ACTION_DEFINITIONS;
    return ACTION_DEFINITIONS.filter(def => {
      const intents = getIntentsForAction(def.id);
      return intents.some(intent => deriveFromIntent(intent.id).agent === agentFilter);
    });
  }, [agentFilter]);
  const gap = variant === 'large' ? 'gap-4' : 'gap-3';
  const isSingle = defs.length === 1;

  return (
    <div className="@container flex flex-col items-center w-full">
      {title && (
        <h2 className={`font-semibold text-gray-800 dark:text-gray-200 mb-5 ${variant === 'large' ? 'text-xl' : 'text-lg'}`}>
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{subtitle}</p>
      )}

      <div className={`
        w-full
        flex flex-wrap justify-center ${gap}
        @xs:grid @xs:grid-cols-1 @xs:max-w-[15rem] @xs:mx-auto
        ${isSingle ? '' : '@sm:grid-cols-2 @sm:max-w-lg'}
      `}>
        {defs.map((def, idx) => (
          <div key={def.id} className="w-full">
            <ActionChip
              actionId={def.id}
              label={def.label[lang] || def.label.en}
              description={def.description[lang] || def.description.en}
              readiness={readiness[def.id] || EMPTY_READINESS}
              variant={variant}
              onClick={() => onSelect(def.id)}
              animationDelay={idx * 50}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Generic chip item for IntentChipGrid */
export interface ChipItem {
  id: string;
  label: string;
  description: string;
  icon?: any;
  bg?: string;
  text?: string;
  disabled?: boolean;
  blockReason?: string;
}

interface IntentChipGridProps {
  items: ChipItem[];
  onSelect: (id: string) => void;
  title?: string;
  subtitle?: string;
}

export function IntentChipGrid({ items, onSelect, title, subtitle }: IntentChipGridProps) {
  const isSingle = items.length === 1;

  return (
    <div className="@container flex flex-col items-center w-full">
      {title && (
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{subtitle}</p>
      )}

      <div className={`
        w-full
        grid grid-cols-1 gap-3
        max-w-[15rem] mx-auto
        ${isSingle ? '' : '@sm:grid-cols-2 @sm:max-w-lg'}
      `}>
        {items.map((item, idx) => (
          <div key={item.id} className="w-full">
            <button
              type="button"
              onClick={() => !item.disabled && onSelect(item.id)}
              disabled={item.disabled}
              className={`
                relative overflow-hidden w-full h-full
                rounded-2xl border border-gray-200 dark:border-[#30363d]
                bg-white dark:bg-gray-800/50
                transition-all duration-200 text-left group
                px-5 py-4
                ${item.disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-500 hover:scale-[1.02] active:scale-[0.98]'}
              `}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <div className="relative flex items-center gap-3">
                {item.icon && (
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${item.bg || 'bg-gray-100 dark:bg-gray-800'} group-hover:scale-105 transition-transform duration-200`}>
                    <item.icon className={`w-5 h-5 ${item.text || 'text-gray-600 dark:text-gray-400'}`} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {item.label}
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{item.description}</p>
                  {item.disabled && item.blockReason && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{item.blockReason}</p>
                  )}
                </div>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

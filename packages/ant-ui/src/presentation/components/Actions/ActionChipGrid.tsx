import { useTranslation } from 'react-i18next';
import { ACTION_DEFINITIONS, type ActionId, type ActionReadiness } from '@ant/shared';
import { ActionChip } from './ActionChip';

const EMPTY_READINESS: ActionReadiness = {
  buildReady: false,
  hasOutput: false,
  hasCodebase: false,
  detectedMode: { id: 'unknown', label: { en: '', ko: '' } },
  materials: [],
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

  const filtered = agentFilter
    ? ACTION_DEFINITIONS.filter(d => d.agent === agentFilter)
    : ACTION_DEFINITIONS;
  const defs = filtered.length > 0 ? filtered : ACTION_DEFINITIONS;

  const chipWidth = defs.length === 1
    ? 'w-full max-w-xs'
    : variant === 'large' ? 'w-[calc(50%-0.5rem)]' : 'w-[calc(50%-0.375rem)]';

  return (
    <div className="flex flex-col items-center">
      {title && (
        <h2 className={`font-semibold text-gray-800 dark:text-gray-200 mb-5 ${variant === 'large' ? 'text-xl' : 'text-lg'}`}>
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{subtitle}</p>
      )}

      <div className={`flex flex-wrap justify-center w-full ${variant === 'large' ? 'max-w-lg gap-4' : 'max-w-md gap-3'}`}>
        {defs.map((def, idx) => (
          <div key={def.id} className={chipWidth}>
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

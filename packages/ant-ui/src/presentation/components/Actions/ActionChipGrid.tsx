import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ACTION_DEFINITIONS, getIntentsForAction, deriveFromIntent, isActionSurfaced, getActionLabel, getActionDescription, type IntentGroup, type ActionReadiness } from '@ant/shared';
import { useStore } from '@/domain/store';
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
  readiness: Record<IntentGroup, ActionReadiness>;
  variant: 'compact' | 'large';
  onSelect: (actionId: IntentGroup) => void;
  agentFilter?: string;
  title?: string;
  subtitle?: string;
}

export function ActionChipGrid({ readiness, variant, onSelect, agentFilter, title, subtitle }: ActionChipGridProps) {
  const { i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';
  // Phase 2 (D22): the workspace-level project domain gates which Action
  // cards are visible (e.g. `design-game-art` is hidden when domain==='service',
  // `design-ui` is hidden when domain==='game' — D28).
  // Cards without a `domainGate` field stay visible on every domain.
  const currentDomain = useStore(s => s.actionMetadata.domain);

  const defs = useMemo(() => {
    const domainFiltered = ACTION_DEFINITIONS.filter(def => isActionSurfaced(def, currentDomain));
    if (!agentFilter) return domainFiltered;
    return domainFiltered.filter(def => {
      if (def.agentScoped === false) return false;
      const intents = getIntentsForAction(def.id);
      return intents.some(intent => deriveFromIntent(intent.id).agent === agentFilter);
    });
  }, [agentFilter, currentDomain]);
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
              label={getActionLabel(def, currentDomain, lang)}
              description={getActionDescription(def, currentDomain, lang)}
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
            <ActionChip
              label={item.label}
              description={item.description}
              variant="large"
              onClick={() => onSelect(item.id)}
              icon={item.icon}
              iconBg={item.bg}
              iconColor={item.text}
              disabled={item.disabled}
              blockReason={item.blockReason}
              animationDelay={idx * 50}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

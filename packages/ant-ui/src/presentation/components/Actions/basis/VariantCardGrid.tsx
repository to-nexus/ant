import type { BasisOption } from '@ant/shared';
import { VariantCard } from './VariantCard';
import { AUTO_DETECT_OPTION } from './constants';
import type { TierKey } from './types';

interface VariantCardGridProps {
  options: BasisOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  tierKey: TierKey;
  layerKey: string;
  lang: 'en' | 'ko';
}

export function VariantCardGrid({ options, selectedId, onSelect, tierKey, layerKey, lang }: VariantCardGridProps) {
  const allOptions = [AUTO_DETECT_OPTION, ...options];

  return (
    <div className="@container">
      <div className="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-3">
        {allOptions.map((option, idx) => (
          <VariantCard
            key={option.id}
            option={option}
            isSelected={selectedId === option.id}
            onClick={() => onSelect(option.id)}
            tierKey={tierKey}
            layerKey={layerKey}
            index={idx}
            lang={lang}
          />
        ))}
      </div>
    </div>
  );
}

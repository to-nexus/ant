import type { BasisOption } from '@ant/shared';
import { VariantCard } from './VariantCard';
import { AUTO_DETECT_OPTION } from './constants';

interface VariantCardGridProps {
  options: BasisOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  tierKey: 'techTier' | 'visualTier';
  layerKey: string;
  lang: 'en' | 'ko';
}

export function VariantCardGrid({ options, selectedId, onSelect, tierKey, layerKey, lang }: VariantCardGridProps) {
  const allOptions = [AUTO_DETECT_OPTION, ...options];
  const isVisualLanguage = tierKey === 'visualTier' && layerKey === 'visualLanguage';
  const gridCols = isVisualLanguage
    ? 'grid-cols-1 sm:grid-cols-2 gap-3'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';

  return (
    <div className={`grid ${gridCols}`}>
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
  );
}

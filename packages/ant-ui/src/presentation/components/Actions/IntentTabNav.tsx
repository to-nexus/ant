import { useMemo } from 'react';
import { ACTION_VISUALS, getIntentVisual } from './actionVisuals';
import { ScrollableTabNav, type TabItem } from './ScrollableTabNav';
import type { ActionId, IntentDefinition } from '@ant/shared';

interface IntentTabNavProps {
  actionId: ActionId;
  intents: readonly IntentDefinition[];
  selectedIntentId: string;
  onSelect: (intentId: string) => void;
  onBack: () => void;
  lang: 'en' | 'ko';
}

export function IntentTabNav({ actionId, intents, selectedIntentId, onSelect, onBack, lang }: IntentTabNavProps) {
  const visual = ACTION_VISUALS[actionId];

  const items: TabItem[] = useMemo(() =>
    intents.map(intent => {
      const v = getIntentVisual(intent.id, actionId);
      return {
        id: intent.id,
        label: intent.label[lang] || intent.label.en,
        description: intent.description[lang] || intent.description.en,
        icon: v.icon,
        iconBg: v.bg,
        iconColor: v.text,
      };
    }),
    [intents, lang, actionId],
  );

  if (!visual) return null;

  return (
    <ScrollableTabNav
      items={items}
      selectedId={selectedIntentId}
      onSelect={onSelect}
      onBack={onBack}
    />
  );
}

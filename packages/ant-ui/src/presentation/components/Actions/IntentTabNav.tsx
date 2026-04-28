import { useMemo } from 'react';
import { getIntentVisual } from './actionVisuals';
import { ScrollableTabNav, type TabItem } from './ScrollableTabNav';
import { getIntentLabel, getIntentDescriptionLocalized, type Domain, type IntentGroup, type IntentDefinition } from '@ant/shared';

interface IntentTabNavProps {
  actionId: IntentGroup;
  intents: readonly IntentDefinition[];
  selectedIntentId: string;
  onSelect: (intentId: string) => void;
  onBack: () => void;
  lang: 'en' | 'ko';
  domain: Domain | undefined;
}

export function IntentTabNav({ actionId, intents, selectedIntentId, onSelect, onBack, lang, domain }: IntentTabNavProps) {
  const items: TabItem[] = useMemo(() =>
    intents.map(intent => {
      const v = getIntentVisual(intent.id, actionId);
      return {
        id: intent.id,
        label: getIntentLabel(intent, domain, lang),
        description: getIntentDescriptionLocalized(intent, domain, lang),
        icon: v.icon,
        iconBg: v.bg,
        iconColor: v.text,
      };
    }),
    [intents, lang, actionId, domain],
  );

  return (
    <ScrollableTabNav
      items={items}
      selectedId={selectedIntentId}
      onSelect={onSelect}
      onBack={onBack}
    />
  );
}

import { useMemo } from 'react';
import {
  FilePlus2, FilePen,
  Monitor, Server, Layers, PenLine,
  Figma, Camera, MessageSquareText, Paintbrush,
  ClipboardList, ClipboardPenLine,
  Code2, Wrench,
  ImageIcon,
  BookOpen,
} from 'lucide-react';
import { ACTION_VISUALS } from './ActionChip';
import { ScrollableTabNav, type TabItem } from './ScrollableTabNav';
import type { ActionId, IntentDefinition } from '@ant/shared';

// ============================================
// Per-intent icon mapping
// ============================================

const INTENT_VISUALS: Record<string, { icon: React.ComponentType<{ className?: string }> }> = {
  'create-plan':      { icon: FilePlus2 },
  'revise-plan':      { icon: FilePen },

  'create-fe':        { icon: Monitor },
  'create-be':        { icon: Server },
  'create-fullstack': { icon: Layers },
  'revise-system':    { icon: PenLine },

  'create-figma':     { icon: Figma },
  'create-ref':       { icon: Camera },
  'create-desc':      { icon: MessageSquareText },
  'revise-ui':        { icon: Paintbrush },

  'create-spec':      { icon: ClipboardList },
  'revise-spec':      { icon: ClipboardPenLine },

  'create-code':      { icon: Code2 },
  'refactor-code':    { icon: Wrench },

  'create-visual':    { icon: ImageIcon },

  'create-learn':     { icon: BookOpen },
};

// ============================================
// Component
// ============================================

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
      const intentVisual = INTENT_VISUALS[intent.id];
      return {
        id: intent.id,
        label: intent.label[lang] || intent.label.en,
        description: intent.description[lang] || intent.description.en,
        icon: intentVisual?.icon,
        iconBg: visual?.bg,
        iconColor: visual?.text,
      };
    }),
    [intents, lang, visual],
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

import type { IntentGroup } from '@ant/shared';
import {
  FileText, Server, Palette, LayoutList, Code2, ImageIcon, BookOpen,
  FilePlus2, FilePen,
  Monitor, Layers, PenLine,
  Figma, MessageSquareText, Paintbrush,
  ClipboardList, ClipboardPenLine,
  Wrench,
  MessageCircleQuestion, ClipboardCheck, Bot, MessageCircle,
  BookOpenText,
  Gem, Shapes, PanelTop, PenTool,
  Brush,
} from 'lucide-react';

// ============================================
// Types
// ============================================

export interface VisualDef {
  icon: React.ComponentType<{ className?: string }>;
  bg: string;
  text: string;
}

// ============================================
// Action-level visuals (one per IntentGroup)
// ============================================

export const ACTION_VISUALS: Record<IntentGroup, VisualDef> = {
  plan:              { icon: FileText,  bg: 'bg-blue-100 dark:bg-blue-900/50',    text: 'text-blue-600 dark:text-blue-400' },
  'design-system':   { icon: Server,    bg: 'bg-purple-100 dark:bg-purple-900/50', text: 'text-purple-600 dark:text-purple-400' },
  'design-ui':       { icon: Palette,   bg: 'bg-pink-100 dark:bg-pink-900/50',    text: 'text-pink-600 dark:text-pink-400' },
  'design-game-art': { icon: Brush,     bg: 'bg-amber-100 dark:bg-amber-900/50',  text: 'text-amber-600 dark:text-amber-400' },
  'design-spec':     { icon: LayoutList, bg: 'bg-rose-100 dark:bg-rose-900/50',    text: 'text-rose-600 dark:text-rose-400' },
  code:              { icon: Code2,     bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-600 dark:text-emerald-400' },
  visual:            { icon: ImageIcon, bg: 'bg-violet-100 dark:bg-violet-900/50', text: 'text-violet-600 dark:text-violet-400' },
  'learn-codebase':  { icon: BookOpen,  bg: 'bg-amber-100 dark:bg-amber-900/50',  text: 'text-amber-600 dark:text-amber-400' },
  ask:               { icon: MessageCircleQuestion, bg: 'bg-cyan-100 dark:bg-cyan-900/50', text: 'text-cyan-600 dark:text-cyan-400' },
};

// ============================================
// Intent-level visuals (one per intent id)
// Icon is intent-specific; bg/text inherit from parent action via getIntentVisual()
// ============================================

const INTENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'gen-plan':           FilePlus2,
  'rev-plan':           FilePen,
  'explain-plan':       BookOpenText,

  'gen-sys-fe':         Monitor,
  'gen-sys-be':         Server,
  'gen-sys-full':       Layers,
  'rev-sys':            PenLine,
  'explain-sys':        BookOpenText,

  'gen-ui-figma':       Figma,
  'gen-ui-desc':        MessageSquareText,
  'rev-ui':             Paintbrush,
  'explain-ui':         BookOpenText,

  'gen-game-art-figma': Figma,
  'gen-game-art-desc':  MessageSquareText,
  'rev-game-art':       Brush,
  'explain-game-art':   BookOpenText,

  'gen-spec':           ClipboardList,
  'rev-spec':           ClipboardPenLine,
  'explain-spec':       BookOpenText,

  'gen-code-sys':       Server,
  'gen-code-spec':      ClipboardList,
  'gen-code-directive': MessageSquareText,
  'rev-code':           Wrench,
  'explain-code':       BookOpenText,

  'gen-visual-logo':          Gem,
  'gen-visual-icon':          Shapes,
  'gen-visual-hero':          PanelTop,
  'gen-visual-illustration':  PenTool,
  'explain-visual':           BookOpenText,

  'gen-learn':          BookOpen,

  'ask-evaluate':       ClipboardCheck,
  'ask-ant':            Bot,
  'ask-general':        MessageCircle,
};

/**
 * Resolve full visual for an intent: intent-specific icon + parent action colors.
 * Falls back to parent action icon if no intent-specific icon is defined.
 */
export function getIntentVisual(intentId: string, actionId: IntentGroup): VisualDef {
  const action = ACTION_VISUALS[actionId];
  const intentIcon = INTENT_ICONS[intentId];
  return {
    icon: intentIcon ?? action?.icon ?? FileText,
    bg: action?.bg ?? '',
    text: action?.text ?? '',
  };
}

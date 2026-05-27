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

// Aurora token-driven: each entry pulls hue-50 surface + hue-600 ink from
// the Aurora palette via var(--…) tokens. ACTION_VISUALS is consumed as
// fallback orb (ActionStepHeader) + watermark icon source (ActionChip).
// Hues without an exact Aurora token fall back to the nearest available
// hue consistent with ACTION_GRADIENTS (purple→violet, rose→pink, cyan/blue
// keep their names since the token palette exposes them).
export const ACTION_VISUALS: Record<IntentGroup, VisualDef> = {
  plan:              { icon: FileText,           bg: 'bg-[color:var(--intent-blue-bg)]',    text: 'text-[color:var(--intent-blue-fg)]' },
  'design-system':   { icon: Server,             bg: 'bg-[color:var(--intent-violet-bg)]',  text: 'text-[color:var(--intent-violet-fg)]' },
  'design-ui':       { icon: Palette,            bg: 'bg-[color:var(--intent-pink-bg)]',    text: 'text-[color:var(--intent-pink-fg)]' },
  'design-game-art': { icon: Brush,              bg: 'bg-[color:var(--intent-amber-bg)]',   text: 'text-[color:var(--intent-amber-fg)]' },
  'design-spec':     { icon: LayoutList,         bg: 'bg-[color:var(--intent-pink-bg)]',    text: 'text-[color:var(--intent-pink-fg)]' },
  code:              { icon: Code2,              bg: 'bg-[color:var(--intent-emerald-bg)]', text: 'text-[color:var(--intent-emerald-fg)]' },
  visual:            { icon: ImageIcon,          bg: 'bg-[color:var(--intent-violet-bg)]',  text: 'text-[color:var(--intent-violet-fg)]' },
  'learn-codebase':  { icon: BookOpen,           bg: 'bg-[color:var(--intent-amber-bg)]',   text: 'text-[color:var(--intent-amber-fg)]' },
  ask:               { icon: MessageCircleQuestion, bg: 'bg-[color:var(--intent-cyan-bg)]', text: 'text-[color:var(--intent-cyan-fg)]' },
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

/**
 * ChoiceCard — Unified choice card system.
 *
 * Architecture:
 *   shared.tsx              — useChoiceCardState, ChoiceCardShell, layouts, THEMES
 *   [Variant].tsx           — one file per card variant (thin wrappers)
 *   index.ts (this file)    — public entry point + variant switch
 *
 * Multi-pod safe: all actions persist to backend via dismiss-choice endpoint.
 */

import type { MessageContent } from '@/domain/models/chat';
import type { ChoiceVariant } from './shared';
import { TriageChoiceVariant } from './TriageChoiceVariant';
import { CancelledVariant } from './CancelledVariant';
import { EvalSaveVariant } from './EvalSaveVariant';
import { PrdApplyVariant } from './PrdApplyVariant';
import { SpecCompleteVariant } from './SpecCompleteVariant';
import { ClarifyingVariant } from './ClarifyingVariant';
import { DraftSelectionVariant } from './DraftSelectionVariant';

interface ChoiceCardProps {
  content: MessageContent;
  variant: ChoiceVariant;
  messageId: string;
}

export function ChoiceCard({ content, variant, messageId }: ChoiceCardProps) {
  switch (variant) {
    case 'triage_choice':
      return <TriageChoiceVariant content={content} messageId={messageId} />;
    case 'cancelled':
      return <CancelledVariant content={content} messageId={messageId} />;
    case 'eval_save':
      return <EvalSaveVariant content={content} messageId={messageId} />;
    case 'prd_apply':
      return <PrdApplyVariant content={content} messageId={messageId} />;
    case 'clarifying':
      return <ClarifyingVariant content={content} messageId={messageId} />;
    case 'spec_complete':
      return <SpecCompleteVariant content={content} messageId={messageId} />;
    case 'draft_selection':
      return <DraftSelectionVariant content={content} messageId={messageId} />;
    default:
      return null;
  }
}

export default ChoiceCard;

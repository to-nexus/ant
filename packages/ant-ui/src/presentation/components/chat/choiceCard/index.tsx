/**
 * ChoiceCard — Unified choice card system.
 *
 * Architecture:
 *   shared.tsx              — useChoiceCardState, ChoiceCardShell, layouts, THEMES
 *   [Variant].tsx           — one file per card variant (thin wrappers)
 *   index.ts (this file)    — public entry point + variant switch
 *
 * Phase 11 props: `(presented, resolved?)` from the chat-SSOT projector.
 * The variant is derived from `presented.cardType`. `cardType` discriminates
 * the choice family beyond the card-line-vs-status-line split.
 *
 * Multi-pod safe: every action persists via the unified
 * `/chat/choice-resolved` endpoint with the cardId from `presented`.
 */

import { memo } from 'react';
import type {
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
} from '@ant/shared';
import { TriageChoiceVariant } from './TriageChoiceVariant';
import { CancelledVariant } from './CancelledVariant';
import { EvalSaveVariant } from './EvalSaveVariant';
import { SpecCompleteVariant } from './SpecCompleteVariant';
import { ClarifyingVariant } from './ClarifyingVariant';

interface ChoiceCardProps {
  presented: ChatChoicePresentedLine;
  resolved?: ChatChoiceResolvedLine;
}

export const ChoiceCard = memo(function ChoiceCard({ presented, resolved }: ChoiceCardProps) {
  switch (presented.cardType) {
    case 'triage_choice':
      return <TriageChoiceVariant presented={presented} resolved={resolved} />;
    case 'cancelled':
      return <CancelledVariant presented={presented} resolved={resolved} />;
    case 'eval_save':
      return <EvalSaveVariant presented={presented} resolved={resolved} />;
    case 'clarifying':
      return <ClarifyingVariant presented={presented} resolved={resolved} />;
    case 'spec_complete':
      return <SpecCompleteVariant presented={presented} resolved={resolved} />;
    default:
      return null;
  }
});

export default ChoiceCard;

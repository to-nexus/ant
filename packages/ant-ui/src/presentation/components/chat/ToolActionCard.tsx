/**
 * ToolActionCard - Simple tool action display card
 * Used for: tool_action (mkdir, etc.)
 */

import { memo } from 'react';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { lineToContent } from './cards/lineToContent';
import { TurnCardShell } from './cards/TurnCardShell';

interface ToolActionCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
}

export const ToolActionCard = memo(function ToolActionCard({ line, pending }: ToolActionCardProps) {
  const content = lineToContent(line, pending);
  const icon = content.metadata?.actionIcon || '🔧';
  const toolContent = content.content;

  return (
    <TurnCardShell nested hoverLift={false}>
      <div
        className="flex items-center gap-2 px-2 py-1.5 text-xs"
        style={{ color: 'var(--text-2)' }}
      >
        <span>{icon}</span>
        <span className="font-medium">{toolContent}</span>
      </div>
    </TurnCardShell>
  );
});

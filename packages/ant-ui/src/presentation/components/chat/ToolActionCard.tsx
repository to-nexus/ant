/**
 * ToolActionCard - Simple tool action display card
 * Used for: tool_action (mkdir, etc.)
 *
 * When the line's metadata carries `agentId` + `definitionPath` (an
 * approval-blocked call surfaced by the tool gate), the card adds a deep
 * link into the agent-definition settings screen — the one place the
 * blocking `tools.approval` knob can be changed.
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { useStore } from '@/domain/store';
import { lineToContent } from './cards/lineToContent';
import { TurnCardShell } from './cards/TurnCardShell';

interface ToolActionCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
}

export const ToolActionCard = memo(function ToolActionCard({ line, pending }: ToolActionCardProps) {
  const { t } = useTranslation('chat');
  const openMainPanelTab = useStore((s) => s.openMainPanelTab);
  const requestAgentSettingsFile = useStore((s) => s.requestAgentSettingsFile);

  const content = lineToContent(line, pending);
  const icon = content.metadata?.actionIcon || '🔧';
  const toolContent = content.content;
  const agentId = typeof content.metadata?.agentId === 'string' ? content.metadata.agentId : undefined;
  const definitionPath =
    typeof content.metadata?.definitionPath === 'string' ? content.metadata.definitionPath : undefined;

  const openSettings =
    agentId && definitionPath
      ? () => {
          requestAgentSettingsFile(agentId, definitionPath);
          openMainPanelTab('agentSettings');
        }
      : undefined;

  return (
    <TurnCardShell nested hoverLift={false}>
      <div
        className="flex items-center gap-2 px-2 py-1.5 text-xs"
        style={{ color: 'var(--text-2)' }}
      >
        <span>{icon}</span>
        <span className="font-medium">{toolContent}</span>
        {openSettings && (
          <button
            type="button"
            onClick={openSettings}
            className="ml-auto shrink-0 underline underline-offset-2 hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            {t('toolAction.openAgentSettings')}
          </button>
        )}
      </div>
    </TurnCardShell>
  );
});

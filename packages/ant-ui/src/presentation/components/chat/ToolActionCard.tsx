/**
 * ToolActionCard - Simple tool action display card
 * Used for: tool_action (mkdir, etc.)
 */

import type { MessageContent } from '@/domain/models/chat';

interface ToolActionCardProps {
  content: MessageContent;
}

export function ToolActionCard({ content }: ToolActionCardProps) {
  const icon = content.metadata?.actionIcon || '🔧';
  const toolContent = content.content;
  
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-400 
                    bg-gray-50/30 dark:bg-gray-800/20 rounded border border-gray-200/50 dark:border-gray-700/50">
      <span>{icon}</span>
      <span className="font-medium">{toolContent}</span>
    </div>
  );
}

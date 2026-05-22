import { ChevronRight, WifiOff } from 'lucide-react';
import { Bar } from '../Bar';
import { ChatPanel } from '../chat/ChatPanel';
import { useTranslation } from 'react-i18next';

interface ChatSidebarWrapperProps {
  isCollapsed: boolean;
  width: number;
  isResizing: boolean;
  selectedAgent: string | null;
  selectedProject: string | null;
  selectedFeature: string | null;
  onExpand: () => void;
  onCollapse: () => void;
  onResizeStart: () => void;
}

export function ChatSidebarWrapper({
  isCollapsed,
  width,
  isResizing,
  selectedAgent,
  selectedProject,
  selectedFeature,
  onExpand,
  onCollapse,
  onResizeStart,
}: ChatSidebarWrapperProps) {
  const { t } = useTranslation('chat');

  // Collapsed state
  if (isCollapsed) {
    return (
      <div
        className="w-10 flex flex-col items-center shrink-0 transition-colors shadow-sm"
        style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-1)' }}
      >
        <button
          onClick={onExpand}
          className="h-10 w-10 flex items-center justify-center transition-colors hover:bg-[color:var(--bg-hover)]"
          style={{ background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-1)', color: 'var(--text-3)' }}
          title={t('sidebar.expand')}
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
      </div>
    );
  }

  // Expanded state — sweep/reset controls live in <ChatHeaderBar> (inside ChatPanel).
  return (
    <aside
      className="flex flex-col overflow-hidden transition-colors shrink-0 relative shadow-sm"
      style={{ width: `${width}px`, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-1)' }}
    >
      {/* Resize Handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize transition-colors z-10 hover:bg-[color:var(--violet-400)]"
        style={{
          backgroundColor: isResizing ? 'var(--violet-500)' : 'transparent',
        }}
        onMouseDown={onResizeStart}
      />

      {/* Chat Bar */}
      {Bar.render({
        left: (
          <>
            {!selectedAgent ? (
              <>
                <WifiOff className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                <span className="font-medium" style={{ color: 'var(--text-1)' }}>{t('sidebar.offline')}</span>
              </>
            ) : (
              <>
                <span className="text-2xl">💬</span>
                <span className="font-medium" style={{ color: 'var(--text-1)' }}>
                  {t('sidebar.chatWith', { agent: selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1) })}
                </span>
              </>
            )}
          </>
        ),
        right: (
          <button
            onClick={onCollapse}
            className="transition-colors flex items-center justify-center w-10 h-10 -mr-4 -my-4 hover:bg-[color:var(--bg-hover)]"
            style={{ color: 'var(--text-3)' }}
            title={t('sidebar.collapse')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )
      })}
      
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          projectId={selectedProject}
          featureName={selectedFeature}
          enabled={!isCollapsed}
          selectedAgent={selectedAgent}
        />
      </div>
    </aside>
  );
}

/**
 * TransferTab - Main Transfer tab component
 * 
 * Contains Send and Receive sub-tabs for managing artifact transfers.
 */

import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { SendSubTab } from './SendSubTab';
import { ReceiveSubTab } from './ReceiveSubTab';

export function TransferTab() {
  const activeSubTab = useStore((s) => s.transferActiveSubTab);
  const setSubTab = useStore((s) => s.setTransferSubTab);
  const receivedRequests = useStore((s) => s.receivedRequests);
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);

  const pendingCount = useMemo(() =>
    receivedRequests.filter(r =>
      r.status === 'pending' &&
      r.destination.projectId === selectedProject &&
      r.destination.featureId === selectedFeature
    ).length,
    [receivedRequests, selectedProject, selectedFeature],
  );

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--surface-1)' }}
    >
      {/* Sub-tab bar */}
      <div
        className="flex items-center gap-1 px-4 pt-3 pb-2"
        style={{ borderBottom: '1px solid var(--border-1)' }}
      >
        <div className="flex items-center gap-1 flex-1">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          style={
            activeSubTab === 'send'
              ? { background: 'var(--bg-hover)', color: 'var(--text-1)' }
              : { background: 'transparent', color: 'var(--text-3)' }
          }
          onClick={() => setSubTab('send')}
        >
          <ArrowUpRight className="w-4 h-4" />
          보내기
        </button>
        <button
          className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          style={
            activeSubTab === 'receive'
              ? { background: 'var(--bg-hover)', color: 'var(--text-1)' }
              : { background: 'transparent', color: 'var(--text-3)' }
          }
          onClick={() => setSubTab('receive')}
        >
          <ArrowDownLeft className="w-4 h-4" />
          받기
          {pendingCount > 0 && (
            <span
              aria-label="pending"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--red-500)',
                marginLeft: 4,
              }}
            />
          )}
        </button>
        </div>
        <span
          className="text-[11px] whitespace-nowrap"
          style={{ color: 'var(--text-3)' }}
        >
          Share artifacts across projects
        </span>
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeSubTab === 'send' ? <SendSubTab /> : <ReceiveSubTab />}
      </div>
    </div>
  );
}

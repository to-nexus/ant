/**
 * TransferTab - Main Transfer tab component
 * 
 * Contains Send and Receive sub-tabs for managing artifact transfers.
 */

import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';
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
    <div className="flex flex-col h-full bg-white dark:bg-[#161b22]">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1 flex-1">
        <button
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            activeSubTab === 'send'
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
          onClick={() => setSubTab('send')}
        >
          <ArrowUpRight className="w-4 h-4" />
          보내기
        </button>
        <button
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            activeSubTab === 'receive'
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
          onClick={() => setSubTab('receive')}
        >
          <ArrowDownLeft className="w-4 h-4" />
          받기
          {pendingCount > 0 && (
            <span className="ml-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          )}
        </button>
        </div>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
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

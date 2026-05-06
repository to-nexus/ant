import { Pencil, MessageSquare } from 'lucide-react';
import type { ServiceConnection } from '@/infrastructure/http/api';
import {
  STATUS_COLORS,
  RESOLUTION_COLORS,
  CATEGORY_BADGE,
} from '../../constants';
import { getResolutionLabel, generateFixMessage } from '../../utils';
import { VirtualizationToggle } from './VirtualizationToggle';

/**
 * Read-only display of a connection. The Virtualization toggle (if the
 * connection has one) sits in the badge row so the user can flip
 * Real/Virtualized without entering edit mode — toggle persistence
 * happens via `onToggleVirtualization` (writes `.env` on the BE).
 */
export function ConnectionRowView({
  conn,
  onEdit,
  onUpdate,
  onFix,
  onToggleVirtualization,
}: {
  conn: ServiceConnection;
  onEdit: () => void;
  onUpdate: (updates: Partial<ServiceConnection>) => void;
  onFix: (msg: string) => void;
  onToggleVirtualization?: (active: boolean) => void;
}) {
  const statusClass = STATUS_COLORS[conn.status || 'stopped'] || STATUS_COLORS['stopped'];
  const catBadge = CATEGORY_BADGE[conn.category] || CATEGORY_BADGE.business;
  const CatIcon = catBadge.icon;
  const resClass = RESOLUTION_COLORS[conn.resolution.type] || RESOLUTION_COLORS.url;

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-gray-800/50 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <CatIcon className={`w-3 h-3 ${catBadge.color} flex-shrink-0`} />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
            {conn.name}
          </span>
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${resClass}`}>
            {conn.resolution.type}
          </span>
          {conn.resolution.type !== 'url' && (
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${statusClass}`}>
              {conn.status || 'stopped'}
            </span>
          )}
          {(conn.missingAnnotation || conn.userModified) && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300"
              title={conn.userModified ? 'Changes not yet applied to project files' : 'Missing @connection annotation in .env.example'}
            >
              {conn.userModified ? 'modified' : '!annotation'}
            </span>
          )}
          {onToggleVirtualization && (
            <VirtualizationToggle conn={conn} onToggle={onToggleVirtualization} />
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
          <code className="text-[10px] text-gray-500 dark:text-gray-400">
            {conn.envVar}
          </code>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">&rarr;</span>
          <code
            className="text-[10px] text-gray-500 dark:text-gray-400 break-all"
            title={conn.resolution.type !== 'url' && conn.value ? conn.value : undefined}
          >
            {getResolutionLabel(conn)}
          </code>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={onEdit}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
        {(conn.missingAnnotation || conn.userModified) && (
          <button
            onClick={() => {
              onFix(generateFixMessage(conn));
              onUpdate({ userModified: false });
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                     bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300
                     hover:bg-yellow-200 dark:hover:bg-yellow-800/50 transition-colors"
            title="Apply changes to project files"
          >
            <MessageSquare className="w-3 h-3" />
            Fix
          </button>
        )}
      </div>
    </div>
  );
}

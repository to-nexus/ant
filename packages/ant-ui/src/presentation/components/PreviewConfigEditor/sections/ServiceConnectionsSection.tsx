import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Search,
  Save,
  Plus,
  Package,
} from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type { ServiceConnection } from '@/infrastructure/http/api';
import { ConnectionRow } from '../components/ConnectionRow';
import { AddConnectionForm } from '../components/AddConnectionForm';

export function ServiceConnectionsSection({
  localConns,
  packageGroups,
  isSinglePackage,
  connectionsExpanded,
  setConnectionsExpanded,
  hasUnsavedChanges,
  editingConnId,
  setEditingConnId,
  addingNew,
  setAddingNew,
  isDetecting,
  onAutoDetect,
  onSaveConnections,
  onUpdateConn,
  onDeleteConn,
  onAddConn,
  onApplyToChat,
}: {
  localConns: ServiceConnection[];
  packageGroups: Map<string, ServiceConnection[]>;
  isSinglePackage: boolean;
  connectionsExpanded: boolean;
  setConnectionsExpanded: (v: boolean) => void;
  hasUnsavedChanges: boolean;
  editingConnId: string | null;
  setEditingConnId: (id: string | null) => void;
  addingNew: boolean;
  setAddingNew: (v: boolean) => void;
  isDetecting: boolean;
  onAutoDetect: () => void;
  onSaveConnections: () => void;
  onUpdateConn: (id: string, updates: Partial<ServiceConnection>) => void;
  onDeleteConn: (id: string) => void;
  onAddConn: (conn: ServiceConnection) => void;
  onApplyToChat: (msg: string) => void;
}) {
  const { t } = useTranslation('explorer');

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => setConnectionsExpanded(!connectionsExpanded)}
          className="flex items-center gap-2 text-left"
        >
          {connectionsExpanded ? <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />}
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('preview.serviceConnections', 'Service Connections')}
          </h3>
          {localConns.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">({localConns.length})</span>
          )}
        </button>
        <div className="flex items-center gap-1.5">
          {hasUnsavedChanges && (
            <button
              onClick={onSaveConnections}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                       bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300
                       hover:bg-green-200 dark:hover:bg-green-800/50 transition-colors"
            >
              <Save className="w-3 h-3" />
              {t('preview.save', 'Save')}
            </button>
          )}
          <button
            onClick={onAutoDetect}
            disabled={isDetecting}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                     bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400
                     hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors
                     disabled:opacity-50"
            title={t('preview.autoDetectTitle', 'Re-scan project files for connections')}
          >
            {isDetecting ? <Spinner size="sm" tone="inherit" /> : <Search className="w-3 h-3" />}
            {t('preview.autoDetect', 'Auto Detect')}
          </button>
        </div>
      </div>

      {connectionsExpanded && (
        <div className="mt-3 space-y-4">
          {localConns.length === 0 && !addingNew ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('preview.noConnections', 'No connections detected. Click "Auto Detect" to scan .env.example files.')}
            </p>
          ) : (
            <>
              {Array.from(packageGroups.entries()).map(([source, conns]) => (
                <div key={source}>
                  {!isSinglePackage && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <Package className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        {source === '*' ? 'Root' : source}
                      </span>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {conns.map((conn) => (
                      <ConnectionRow
                        key={`${conn.source}:${conn.id}`}
                        conn={conn}
                        isEditing={editingConnId === conn.id}
                        onEdit={() => setEditingConnId(editingConnId === conn.id ? null : conn.id)}
                        onUpdate={(updates) => onUpdateConn(conn.id, updates)}
                        onDelete={() => onDeleteConn(conn.id)}
                        onFix={onApplyToChat}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {addingNew ? (
            <AddConnectionForm
              onAdd={onAddConn}
              onCancel={() => setAddingNew(false)}
            />
          ) : (
            <button
              onClick={() => setAddingNew(true)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                       text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('preview.addConnection', 'Add Connection')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

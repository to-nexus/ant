
import { useTranslation } from 'react-i18next';
import { Check, Package, Plus, Search, Sparkles } from 'lucide-react';
import type { ServiceConnection } from '@/infrastructure/http/api';
import {
  SectionCard,
  StatusPill,
} from '@/presentation/components/ConfigEditor/aurora';
import { ConnectionRow } from '../components/ConnectionRow';
import { AddConnectionForm } from '../components/AddConnectionForm';

export function ServiceConnectionsSection({
  localConns,
  packageGroups,
  isSinglePackage,
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
  onToggleVirtualization,
}: {
  localConns: ServiceConnection[];
  packageGroups: Map<string, ServiceConnection[]>;
  isSinglePackage: boolean;
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
  onToggleVirtualization: (id: string, active: boolean) => void;
}) {
  const { t } = useTranslation('explorer');

  const hasActive = localConns.some((c) => c.status === 'active');
  const hasDirty = localConns.some(
    (c) => c.missingAnnotation || c.userModified,
  );

  const statusPills = localConns.length > 0 ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <StatusPill
        state="info"
        label={t('preview.connectionCount', '{{count}}개', {
          count: localConns.length,
        })}
      />
      {hasActive && (
        <StatusPill
          state="connected"
          label={t('preview.connectionsActive', '활성')}
        />
      )}
      {hasDirty && (
        <StatusPill
          state="warning"
          label={t('preview.connectionsDirty', '변경됨')}
        />
      )}
    </span>
  ) : undefined;

  const ghostBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: '1px solid var(--border-2)',
    borderRadius: 'var(--r-sm)',
    color: 'var(--text-3)',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 9px',
    cursor: 'pointer',
  };

  const statusActions = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {hasUnsavedChanges && (
        <button
          type="button"
          onClick={onSaveConnections}
          style={ghostBtnStyle}
          title={t('preview.save', 'Save')}
        >
          <Check size={11} strokeWidth={2.2} />
          {t('preview.save', 'Save')}
        </button>
      )}
      <button
        type="button"
        onClick={onAutoDetect}
        disabled={isDetecting}
        style={{
          ...ghostBtnStyle,
          opacity: isDetecting ? 0.6 : 1,
          cursor: isDetecting ? 'wait' : 'pointer',
        }}
        title={t('preview.autoDetectTitle', 'Re-detect connections')}
      >
        {isDetecting ? (
          <Sparkles size={11} strokeWidth={2.2} />
        ) : (
          <Search size={11} strokeWidth={2.2} />
        )}
        {t('preview.autoDetect', 'Auto-Detect')}
      </button>
    </span>
  );

  return (
    <SectionCard
      icon="Package"
      title={t('preview.serviceConnections', '서비스 연결')}
      description={t(
        'preview.serviceConnectionsDesc',
        '앱이 의존하는 외부 서비스. 자동 감지 결과는 카테고리별로 색이 다릅니다.',
      )}
      accent="violet-pink"
      status={statusPills}
      statusAction={statusActions}
    >
      {localConns.length === 0 && !addingNew ? (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text-4)',
            fontStyle: 'italic',
            border: '1px dashed var(--border-2)',
            borderRadius: 'var(--r-md)',
          }}
        >
          {t(
            'preview.noConnections',
            '감지된 연결이 없습니다. 자동 감지를 실행하거나 직접 추가하세요.',
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Array.from(packageGroups.entries()).map(([source, conns]) => (
            <div
              key={source}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {!isSinglePackage && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text-3)',
                    textTransform: 'uppercase',
                    letterSpacing: 1.4,
                  }}
                >
                  <Package size={10} strokeWidth={2.2} />
                  <span>{source === '*' ? 'Root' : source}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 6px',
                      background: 'var(--bg-surface-2)',
                      color: 'var(--text-3)',
                      borderRadius: 'var(--r-pill)',
                      letterSpacing: 0,
                    }}
                  >
                    {conns.length}
                  </span>
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 10,
                }}
              >
                {conns.map((conn) => (
                  <ConnectionRow
                    key={`${conn.source}:${conn.id}`}
                    conn={conn}
                    isEditing={editingConnId === conn.id}
                    onEdit={() =>
                      setEditingConnId(
                        editingConnId === conn.id ? null : conn.id,
                      )
                    }
                    onUpdate={(updates) => onUpdateConn(conn.id, updates)}
                    onDelete={() => onDeleteConn(conn.id)}
                    onFix={onApplyToChat}
                    onToggleVirtualization={(active) =>
                      onToggleVirtualization(conn.id, active)
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {addingNew ? (
        <div style={{ marginTop: 12 }}>
          <AddConnectionForm
            onAdd={onAddConn}
            onCancel={() => setAddingNew(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          style={{
            marginTop: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            border: '1px dashed var(--border-2)',
            borderRadius: 'var(--r-md)',
            background: 'transparent',
            color: 'var(--text-3)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition:
              'border-color 0.15s ease, color 0.15s ease, background 0.15s ease',
          }}
        >
          <Plus size={11} strokeWidth={2.2} />
          {t('preview.addConnection', '연결 추가')}
        </button>
      )}
    </SectionCard>
  );
}

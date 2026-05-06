import type { ServiceConnection } from '@/infrastructure/http/api';
import { ConnectionRowView } from './ConnectionRowView';
import { ConnectionRowEdit } from './ConnectionRowEdit';

export { VirtualizationToggle } from './VirtualizationToggle';

/**
 * Single connection row in the Service Connections list. Switches between
 * read-only (view) and edit modes based on `isEditing`. The Real /
 * Virtualized toggle is delivered through `onToggleVirtualization` and
 * appears in both modes when the connection has a `virtualization` field
 * (every business connection by definition).
 */
export function ConnectionRow({
  conn,
  isEditing,
  onEdit,
  onUpdate,
  onDelete,
  onFix,
  onToggleVirtualization,
}: {
  conn: ServiceConnection;
  isEditing: boolean;
  onEdit: () => void;
  onUpdate: (updates: Partial<ServiceConnection>) => void;
  onDelete: () => void;
  onFix: (msg: string) => void;
  onToggleVirtualization?: (active: boolean) => void;
}) {
  if (isEditing) {
    return (
      <ConnectionRowEdit
        conn={conn}
        onCancel={onEdit}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onToggleVirtualization={onToggleVirtualization}
      />
    );
  }

  return (
    <ConnectionRowView
      conn={conn}
      onEdit={onEdit}
      onUpdate={onUpdate}
      onFix={onFix}
      onToggleVirtualization={onToggleVirtualization}
    />
  );
}

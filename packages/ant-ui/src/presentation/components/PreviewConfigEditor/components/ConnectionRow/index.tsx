import type { ServiceConnection } from '@/infrastructure/http/api';
import { ConnectionRowView } from './ConnectionRowView';
import { ConnectionRowEdit } from './ConnectionRowEdit';

export { VirtualizationToggle } from './VirtualizationToggle';

/**
 * Single connection row in the Service Connections list. Switches between
 * read-only (view) and edit modes based on `isEditing`. The Real / Virtualized
 * state shows as a static badge in view mode and is editable only inside edit
 * mode (drafted like every other field, committed via the row ✓ then persisted
 * by the section-level Save).
 */
export function ConnectionRow({
  conn,
  isEditing,
  onEdit,
  onUpdate,
  onDelete,
}: {
  conn: ServiceConnection;
  isEditing: boolean;
  onEdit: () => void;
  onUpdate: (updates: Partial<ServiceConnection>) => void;
  onDelete: () => void;
}) {
  if (isEditing) {
    return (
      <ConnectionRowEdit
        conn={conn}
        onCancel={onEdit}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    );
  }

  return <ConnectionRowView conn={conn} onEdit={onEdit} />;
}

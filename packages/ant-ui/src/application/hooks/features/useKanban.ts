/**
 * Application Layer: Kanban View Adapter Hook
 * 
 * Responsibility:
 * - Select Kanban data from Domain Store
 * - Provide derived stats for UI consumption
 * - No business logic, no Infrastructure access
 */

import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import type { KanbanData } from '@/domain/models/kanban';

interface UseKanbanReturn {
  kanbanData: KanbanData;
  stats: {
    todoCount: number;
    completedCount: number;
    hasActiveJob: boolean;
  };
}

export function useKanban(): UseKanbanReturn {
  // ✅ Select data from Domain Store
  const kanbanData = useStore((state) => state.kanban);

  // ✅ Derive UI-specific stats
  const stats = useMemo(
    () => ({
      todoCount: kanbanData.todo?.length ?? 0,
      completedCount: kanbanData.completed?.length ?? 0,
      hasActiveJob: kanbanData.inProgress !== null,
    }),
    [kanbanData]
  );

  return { kanbanData, stats };
}

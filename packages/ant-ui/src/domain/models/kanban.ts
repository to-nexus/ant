/**
 * Domain Model: Kanban
 * 
 * Re-exports KanbanData from infrastructure layer
 * This allows domain/application layers to reference the type without direct infrastructure dependencies
 */

export type { KanbanData, KanbanTask } from '@/infrastructure/http/api';



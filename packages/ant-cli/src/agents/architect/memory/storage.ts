import { MemoryPort } from "../../../core/ports";

/**
 * Store lessons from execution to vector memory
 * 
 * Lessons = extracted knowledge from task completion
 */
export async function storeLessons(
  lessons: string,
  project: string,
  feature: string,
  deps?: { memory: MemoryPort },
  metadata?: {
    relatedFiles?: string[];
    tags?: string[];
    directive?: string;
    taskType?: string;
    branch?: string;
  }
): Promise<void> {
  const memory = deps?.memory;
  if (!memory) return;
  
  await memory.store([
    { 
      content: lessons, 
      metadata: { 
        type: "lesson",  // ✅ Changed from 'learning'
        project, 
        feature, 
        timestamp: new Date().toISOString(),
        // ✅ Enhanced metadata
        relatedFiles: metadata?.relatedFiles || [],
        tags: metadata?.tags || [],
        directive: metadata?.directive,
        taskType: metadata?.taskType,
        branch: metadata?.branch
      } 
    }
  ], project);
}

// ✅ Legacy alias (for backward compatibility during transition)
export const storeLearnings = storeLessons;


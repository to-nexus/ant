import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState, Task, TaskQueue } from "../state";

/**
 * Decompose Node
 * 
 * Meta-level planning: Break the overall task into executable tasks
 * This runs ONCE at the beginning to create the initial task queue.
 * 
 * Responsibilities:
 * 1. Analyze spec (PRD, Design, Directive)
 * 2. Create feature tasks from requirements
 * 3. Initialize priority queue
 * 4. Store feature tasks for completion tracking
 */
export async function decompose(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  
  console.log('\n🎯 Decomposing task into executable queue...\n');
  
  // Prepare spec
  const specParts = [
    state.prd ? `PRD:\n${state.prd}` : null,
    state.design ? `DESIGN:\n${state.design}` : null,
    state.directive ? `DIRECTIVE:\n${state.directive}` : null
  ].filter(Boolean);
  
  if (specParts.length === 0) {
    console.log('⚠️  No specification provided, creating minimal task');
    
    // Create a single default task
    const taskQueue = new TaskQueue();
    const defaultTask: Task = {
      id: 'default',
      name: 'Implement Requirements',
      type: 'feature',
      priority: 250,
      description: 'Implement based on directive or design',
      completed: false
    };
    
    taskQueue.push(defaultTask);
    
    const featureTasks = new Map<string, Task>();
    featureTasks.set(defaultTask.id, defaultTask);
    
    return {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: []
    };
  }
  
  const spec = specParts.join('\n\n---\n\n');
  
  const prompt = `You are analyzing a software specification to break it into executable tasks.

SPECIFICATION:
${spec}

YOUR TASK:
Break this specification into a prioritized list of implementation tasks.

GUIDELINES:
1. **Feature Tasks** (priority 200-299):
   - Extract from the specification
   - Each task should be a meaningful, user-facing feature
   - Focus on WHAT to build, not HOW (that comes later)
   - Examples: "Implement User Authentication", "Build Todo CRUD API"
   
2. **Task Granularity**:
   - Not too large: Each task should be independently implementable
   - Not too small: Avoid micro-tasks like "Create one file"
   - Good size: A feature that delivers value (e.g., "Login system")
   
3. **Priority Guide**:
   - Critical features: 250-299
   - Important features: 220-249
   - Nice-to-have features: 200-219
   
4. **Dependencies**:
   - Order tasks by dependency (foundational features first)
   - But don't worry too much - errors will be handled dynamically

Return JSON ONLY (no explanation):
{
  "tasks": [
    {
      "id": "auth-impl",
      "name": "Implement User Authentication System",
      "type": "feature",
      "priority": 250,
      "description": "Create login, signup, JWT token handling, protected routes"
    },
    {
      "id": "todo-crud",
      "name": "Build Todo CRUD Operations",
      "type": "feature",
      "priority": 240,
      "description": "Implement create, read, update, delete operations for todo items"
    }
  ]
}

IMPORTANT:
- If the spec only mentions "build a React app" with no specific features → return empty array
- Focus on USER-FACING features, not infrastructure (build setup, etc.)
- Each task must have unique id (kebab-case)`;

  try {
    const response = await llm.invoke([{ role: 'user', content: prompt }]);
    
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('⚠️  LLM response had no JSON, creating default task');
      
      const taskQueue = new TaskQueue();
      const defaultTask: Task = {
        id: 'impl-default',
        name: 'Implement Requirements',
        type: 'feature',
        priority: 250,
        description: 'Implement based on specification',
        completed: false
      };
      
      taskQueue.push(defaultTask);
      
      const featureTasks = new Map<string, Task>();
      featureTasks.set(defaultTask.id, defaultTask);
      
      return {
        ...state,
        taskQueue,
        featureTasks,
        completedTasks: []
      };
    }
    
    const result = JSON.parse(jsonMatch[0]);
    const tasks: Task[] = result.tasks || [];
    
    if (tasks.length === 0) {
      console.log('⚠️  No tasks created from spec, creating default task');
      
      const taskQueue = new TaskQueue();
      const defaultTask: Task = {
        id: 'impl-spec',
        name: 'Implement Specification',
        type: 'feature',
        priority: 250,
        description: 'Implement requirements from specification',
        completed: false
      };
      
      taskQueue.push(defaultTask);
      
      const featureTasks = new Map<string, Task>();
      featureTasks.set(defaultTask.id, defaultTask);
      
      return {
        ...state,
        taskQueue,
        featureTasks,
        completedTasks: []
      };
    }
    
    // Create task queue
    const taskQueue = new TaskQueue();
    const featureTasks = new Map<string, Task>();
    
    tasks.forEach((task: Task) => {
      // Ensure task has all required fields
      const completeTask: Task = {
        ...task,
        completed: false
      };
      
      taskQueue.push(completeTask);
      
      if (completeTask.type === 'feature') {
        featureTasks.set(completeTask.id, completeTask);
      }
    });
    
    console.log(`📊 Created ${tasks.length} tasks:`);
    tasks.forEach((task, i) => {
      console.log(`   ${i + 1}. [P${task.priority}] ${task.name} (${task.type})`);
    });
    console.log('');
    
    return {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: []
    };
    
  } catch (error) {
    console.error('❌ Failed to decompose tasks:', error);
    
    // Fallback: create default task
    const taskQueue = new TaskQueue();
    const defaultTask: Task = {
      id: 'impl-fallback',
      name: 'Implement Requirements',
      type: 'feature',
      priority: 250,
      description: 'Implement based on specification',
      completed: false
    };
    
    taskQueue.push(defaultTask);
    
    const featureTasks = new Map<string, Task>();
    featureTasks.set(defaultTask.id, defaultTask);
    
    return {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: []
    };
  }
}


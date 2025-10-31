import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState, Task, TaskQueue } from "../state";

/**
 * Decompose Node
 * 
 * Meta-level planning: Break the overall task into executable tasks
 * This runs ONCE at the beginning to create the initial task queue.
 * 
 * ✅ RESUME SUPPORT: If previous state exists in session, restore it instead of decomposing
 * 
 * Responsibilities:
 * 1. Check for existing session state (for resuming after recursion limit)
 * 2. If state exists → restore task queue and continue
 * 3. If no state → analyze spec and create new task queue
 * 4. Store feature tasks for completion tracking
 */
export async function decompose(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  
  // ✅ RESUME: Check if we have previous state to restore
  if (state.deps?.session) {
    try {
      const session = await state.deps.session.load(
        state.context.project,
        state.context.featureFolder || 'default'
      );
      
      if (session.state && session.state.taskQueue && session.state.taskQueue.length > 0) {
        console.log('\n🔄 Resuming from previous session...\n');
        
        // Restore TaskQueue from saved state
        const taskQueue = new TaskQueue();
        session.state.taskQueue.forEach((task: Task) => {
          taskQueue.push(task);
        });
        
        // Restore featureTasks map
        const featureTasks = new Map<string, Task>();
        session.state.taskQueue.forEach((task: Task) => {
          if (task.type === 'feature') {
            featureTasks.set(task.id, task);
          }
        });
        
        console.log(`📊 Restored state:`);
        console.log(`   ✅ ${session.state.completedTasks?.length || 0} tasks completed`);
        console.log(`   ⏳ ${taskQueue.size()} tasks remaining`);
        console.log(`   🔁 Retry count: ${session.state.retries || 0}/${session.state.maxRetries || 3}`);
        console.log('');
        
        return {
          ...state,
          taskQueue,
          featureTasks,
          completedTasks: session.state.completedTasks || [],
          retries: session.state.retries || 0,
          maxRetries: session.state.maxRetries || 3,
          previousAttempts: session.state.previousAttempts || [],
          enforcementHistory: session.state.enforcementHistory || [],
          lastViolations: session.state.lastViolations || [],
          previousFileCount: session.state.previousFileCount,
          resolvedCategories: (session.state.resolvedCategories || []) as any,
        };
      }
    } catch (error) {
      console.log('⚠️  Could not load previous session state, starting fresh');
    }
  }
  
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
      priority: 220,
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
  
  // Check if this is a new project (no existing code)
  const isNewProject = !state.code || state.code.trim().length === 0;
  const hasExistingCode = Boolean(state.code && state.code.trim().length > 0);
  
  const prompt = `You are analyzing a software specification to break it into executable tasks.

SPECIFICATION:
${spec}

${hasExistingCode ? `
📂 EXISTING CODEBASE DETECTED

Current code structure:
${state.code ? state.code.split('\n').slice(0, 20).join('\n') + '\n...' : '(empty)'}
` : `
🆕 NEW PROJECT (no existing codebase)
`}

⚙️  SETUP TASK DECISION:

Analyze the specification and decide if a SETUP task is needed.

**When to create a SETUP task (priority 100):**

1. **New Project**: No existing code → ALWAYS need setup
   - Example: Generate package.json, tsconfig.json, vite.config.ts, etc.

2. **New Infrastructure**: Adding new tools/frameworks to existing project
   - Adding Docker: Dockerfile, docker-compose.yml
   - Adding Testing: jest.config.js, vitest.config.ts
   - Adding CI/CD: .github/workflows/, .gitlab-ci.yml
   - Adding Storybook: .storybook/ config
   - Changing build tools: webpack → vite (new configs)

3. **New Language/Runtime**: Adding different tech stack
   - Adding Rust to Node project: Cargo.toml
   - Adding Python service: requirements.txt, pyproject.toml
   - Adding Go service: go.mod

4. **Major Configuration Changes**:
   - Switching package managers: npm → pnpm (pnpm-workspace.yaml)
   - Adding monorepo structure: lerna.json, turbo.json
   - Major dependency upgrades requiring config changes

**When NOT to create a SETUP task:**
- Simple bug fixes
- Feature additions using existing infrastructure
- Code refactoring
- UI changes
- Business logic updates

**If SETUP is needed, return:**
{
  "tasks": [
      {
        "id": "setup-[descriptive-name]",
        "name": "Setup [What You're Setting Up]",
        "type": "setup",
        "priority": 100,
        "description": "Generate [specific config files]. Example: Dockerfile, docker-compose.yml, .dockerignore for Docker support"
      },
      ... then feature tasks (priority 200+) ...
  ]
}

YOUR TASK:
Break this specification into a prioritized list of implementation tasks.

GUIDELINES:
1. **Setup Task (priority 100)** - OPTIONAL, create only if needed:
   - Analyze spec: Does it require NEW configuration files?
   - If yes: Create setup task describing WHAT configs to generate
   - If no: Skip to feature tasks
   - Setup task should ONLY generate config files (NO application code)
   
2. **Feature Tasks** (priority 200-299):
   - Extract from the specification
   - Each task should be a meaningful, user-facing feature
   - Focus on WHAT to build, not HOW (that comes later)
   - Examples: "Implement User Authentication", "Build Todo CRUD API"
   
3. **Task Granularity**:
   - Not too large: Each task should be independently implementable
   - Not too small: Avoid micro-tasks like "Create one file"
   - Good size: A feature that delivers value (e.g., "Login system")
   
4. **Priority Guide** (LOWER NUMBER = HIGHER PRIORITY):
   - Setup: 100 (FIRST - if needed for config files)
   - Critical features: 200-219 (execute after setup if present)
   - Important features: 220-249
   - Nice-to-have features: 250-279 (execute last)
   
5. **Dependencies**:
   - Order tasks by dependency (foundational features first)
   - But don't worry too much - errors will be handled dynamically

Return JSON ONLY (no explanation):
{
  "tasks": [
      {
        "id": "setup-docker",
        "name": "Setup Docker Configuration",
        "type": "setup",
        "priority": 100,
        "description": "Generate Dockerfile, docker-compose.yml, .dockerignore"
      },
      {
        "id": "auth-impl",
        "name": "Implement User Authentication System",
        "type": "feature",
        "priority": 200,
        "description": "Create login, signup, JWT token handling, protected routes"
      }
  ]
}

⚠️  CRITICAL: FINAL VERIFICATION TASK

**ALWAYS add a final verification task at the end** (lowest priority):
- Type: "feature" (not a special type, just a regular feature task)
- Priority: 900+ (runs last)
- Purpose: Verify ALL requirements from the spec are met
- Check for missing components, incomplete features, gaps in implementation
- Ensure the ENTIRE goal of the specification is achieved

Example verification task:
{
  "id": "final-verification",
  "name": "Final Integration & Verification",
  "type": "feature",
  "priority": 999,
  "description": "Verify all features from specification are fully implemented: [list key features]. Check for missing components, incomplete functionality, or gaps. Ensure the complete application works as intended."
}

IMPORTANT:
- **Decide intelligently**: Create setup task ONLY if spec requires new configuration
- If NEW PROJECT: Setup task is typically needed (but analyze the spec!)
- If EXISTING PROJECT: Setup task only if adding new tools/infrastructure
- If the spec only mentions "build a React app" with no specific features → return setup task + empty array for features
- Focus on USER-FACING features, not infrastructure (infrastructure = setup task)
- Each task must have unique id (kebab-case)
- **ALWAYS include the final verification task as the last task**`;

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
        priority: 220,
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
        priority: 220,
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
      priority: 220,
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


/**
 * Command Execution Module
 * 
 * Handles execution of shell commands parsed from LLM responses
 */

import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";

export interface CommandExecutionResult {
  success: boolean;
  executedCount: number;
}

/**
 * Execute commands from LLM response with safety checks
 */
export async function executeCommands(
  state: ArchitectGraphState,
  commands: Array<{ command: string; description?: string }>
): Promise<CommandExecutionResult> {
  if (!commands || commands.length === 0 || !state.deps?.command || !state.context.config?.localPath) {
    return { success: true, executedCount: 0 };
  }
  
  const chatAPI = getChatAPIClient();
  
  console.log(`\n🔧 Found ${commands.length} command(s) in LLM response`);
  
  // ✅ Safety check: Execute in environment errors OR missing dependency scenarios
  const isEnvironmentError = state.enforcementReason?.toLowerCase().includes('environment') ||
                              state.enforcementReason?.toLowerCase().includes('corrupted');
  
  const isMissingDependency = state.violations?.some(v => 
    v.type === 'missing_dependency' || 
    v.message.toLowerCase().includes('npm install') ||
    v.message.toLowerCase().includes('@types/')
  ) || false;
  
  // ✅ Check task name/description for dependency keywords (when violations are cleared)
  const taskName = state.currentTask?.name?.toLowerCase() || '';
  const taskDesc = state.currentTask?.description?.toLowerCase() || '';
  const isErrorTaskForDependency = (
    taskName.includes('dependency') || 
    taskName.includes('missing') ||
    taskDesc.includes('npm install') ||
    taskDesc.includes('@types')
  );
  
  const shouldExecuteCommands = isEnvironmentError || isMissingDependency || isErrorTaskForDependency;
  
  // ✅ Debug logging
  console.log(`   🔍 Command execution check:`);
  console.log(`      isEnvironmentError: ${isEnvironmentError}`);
  console.log(`      isMissingDependency: ${isMissingDependency}`);
  console.log(`      isErrorTaskForDependency: ${isErrorTaskForDependency}`);
  console.log(`      violations count: ${state.violations?.length || 0}`);
  console.log(`      task name: ${state.currentTask?.name}`);
  console.log(`      shouldExecute: ${shouldExecuteCommands}`);
  
  if (!shouldExecuteCommands) {
    console.log('⚠️  Commands found but not in safe execution context - skipping');
    console.log('   (Commands are only auto-executed for environment fixes or missing dependencies)\n');
    return { success: true, executedCount: 0 };
  }
  
  if (isEnvironmentError) {
    console.log('⚡ Environment error detected - executing commands...\n');
  } else if (isMissingDependency) {
    console.log('📦 Missing dependency detected - executing installation commands...\n');
  }
  
  const actualProjectPath = state.context.config.localPath;
  let executedCount = 0;
  
  for (const cmd of commands) {
    // ✅ Replace any placeholder paths with actual project path
    let actualCommand = cmd.command;
    
    // Common placeholder patterns to replace
    const placeholders = [
      '/Users/probe/dev/test-app',
      '/Users/probe/dev/coin-watcher',
      '/path/to/project',
      '{{projectPath}}'
    ];
    
    for (const placeholder of placeholders) {
      if (actualCommand.includes(placeholder)) {
        actualCommand = actualCommand.replace(new RegExp(placeholder, 'g'), actualProjectPath);
        console.log(`   🔄 Replaced path: ${placeholder} → ${actualProjectPath}`);
      }
    }
    
    // ✅ Special handling for rm -rf commands (use Node.js fs instead)
    if (actualCommand.trim().match(/^rm\s+-rf\s+/)) {
      console.log(`💻 Executing (via fs): ${actualCommand}`);
      
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        // Extract target paths from command
        const targets = actualCommand.replace(/^rm\s+-rf\s+/, '').trim().split(/\s+/);
        
        for (const target of targets) {
          const targetPath = path.isAbsolute(target) 
            ? target 
            : path.join(actualProjectPath, target);
          
          try {
            await fs.rm(targetPath, { recursive: true, force: true });
            console.log(`   ✅ Removed: ${target}`);
          } catch (err) {
            console.log(`   ℹ️  ${target} not found or already removed`);
          }
        }
        console.log(`   ✅ Success`);
        
        // Add to chat
        await chatAPI.completeCommand(actualCommand, 'Success', 0);
        executedCount++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`   ❌ Error: ${errorMsg}`);
        await chatAPI.completeCommand(actualCommand, errorMsg, 1);
      }
      continue;
    }
    
    // Skip cd commands if they're just changing to project root (already there)
    if (actualCommand.trim().startsWith('cd ') && actualCommand.includes(actualProjectPath)) {
      console.log(`💻 Skipping redundant cd: ${actualCommand}`);
      continue;
    }
    
    console.log(`💻 Executing: ${actualCommand}`);
    if (cmd.description) {
      console.log(`   Purpose: ${cmd.description}`);
    }
    
    try {
      const result = await state.deps.command.execute(actualCommand, {
        cwd: actualProjectPath,  // Always use actual project path as cwd
        timeout: 5 * 60 * 1000,  // 5 minutes
      });
      
      if (result.success) {
        console.log(`   ✅ Success`);
        await chatAPI.completeCommand(actualCommand, result.stdout || 'Success', 0);
        executedCount++;
      } else {
        const errorOutput = result.stderr || result.stdout || 'Failed';
        console.error(`   ❌ Failed: ${errorOutput}`);
        await chatAPI.completeCommand(actualCommand, errorOutput, result.exitCode || 1);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error: ${errorMsg}`);
      await chatAPI.completeCommand(actualCommand, errorMsg, 1);
    }
  }
  
  console.log();
  
  return { success: true, executedCount };
}


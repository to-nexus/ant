import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { detectProject, resolveInputFile } from './resolver';
import { orchestrator } from '../composition/orchestrator';
import { TaskLogger } from './logger';
import { UnifiedWorkspaceResolver, WorkspacePathResolver } from '../core/config/WorkspacePathResolver';
import { getSessionDebugDir } from '../core/utils/sessionPaths';

/**
 * CLI Command Structure
 * 
 * aidev <agent> <task> [options] <input>
 * 
 * Examples:
 *   aidev architect design workspace/project/feature/directive.md
 *   aidev architect code workspace/project/feature/ --mode refactor
 *   aidev arch learn workspace/project/common/directive.md
 *   aidev reviewer --pr 123
 */

const program = new Command();

program
  .name('aidev')
  .description('AI-powered development framework for automated architecture design and code generation')
  .version('1.0.0');

// Architect agent commands
const architect = program
  .command('architect')
  .alias('arch')
  .description('Architecture design and code generation agent');

architect
  .command('design [input]')
  .description('Generate architecture design from PRD and requirements')
  .option('--project <name>', 'Override auto-detected project name')
  .action(async (input: string, options: any) => {
    await runArchitect('design', input, options);
  });

architect
  .command('code [input]')
  .description('Generate code from design document')
  .option('--mode <mode>', 'Code generation mode (generate|refactor|explain)', 'generate')
  .option('--project <name>', 'Override auto-detected project name')
  .option('--eval', 'Run evaluation after code generation')
  .action(async (input: string, options: any) => {
    await runArchitect('code', input, options);
  });

architect
  .command('learn [input]')
  .description('Learn from repository patterns and conventions')
  .option('--project <name>', 'Override auto-detected project name')
  .action(async (input: string, options: any) => {
    await runArchitect('learn', input, options);
  });

// Reviewer agent commands
program
  .command('review <input>')
  .alias('reviewer')
  .description('Review code changes or pull requests')
  .option('--pr <number>', 'Pull request number to review')
  .option('--project <name>', 'Override auto-detected project name')
  .action(async (input: string, options: any) => {
    await runReviewer(input, options);
  });

// Planner agent commands
program
  .command('plan <input>')
  .alias('planner')
  .description('Create project plan and sprint breakdown')
  .option('--project <name>', 'Override auto-detected project name')
  .action(async (input: string, options: any) => {
    await runPlanner(input, options);
  });

// Doc agent commands
program
  .command('doc <input>')
  .description('Generate or update documentation')
  .option('--project <name>', 'Override auto-detected project name')
  .action(async (input: string, options: any) => {
    await runDoc(input, options);
  });

// ✅ Index command (codebase indexing)
program
  .command('index <project>')
  .description('Index codebase into vector database for semantic search')
  .option('--incremental', 'Only index changed files (not yet implemented)')
  .action(async (project: string, options: any) => {
    await runIndex(project, options);
  });

// Evaluation is integrated into architect workflow via --eval flag
// No separate eval command needed

/**
 * Run architect agent
 */
async function runArchitect(jobType: 'design' | 'code' | 'learn', inputPath: string | undefined, options: any) {
  let logger: TaskLogger | null = null;
  
  try {
    // ✅ Check for override directive from environment (chat input)
    const overrideDirective = process.env.ANT_OVERRIDE_DIRECTIVE;
    
    // ✅ For chat-initiated jobs, inputPath might be undefined
    // In that case, we need a default project detection or it should be provided via options
    if (!inputPath && !overrideDirective) {
      throw new Error('Either input path or override directive (from chat) must be provided');
    }
    
    // Resolve project
    const project = options.project || (inputPath ? detectProject(inputPath) : 'unknown');
    
    let input: string;
    let resolvedFile: string;
    
    if (overrideDirective) {
      // ✅ Use override directive from chat (no file reading)
      console.log('📝 Using chat input as directive');
      input = overrideDirective;
      resolvedFile = ''; // No file path needed
    } else if (inputPath) {
      // ✅ Resolve input file (may return '' for resume scenarios)
      resolvedFile = resolveInputFile(inputPath, jobType);
      
      // ✅ If resolvedFile is empty, we're resuming (no file reading needed)
      if (resolvedFile === '') {
        console.log('🔄 Resume mode detected - skipping file reading');
        input = ''; // Empty input for resume
      } else {
        input = fs.readFileSync(resolvedFile, 'utf-8');
      }
    } else {
      throw new Error('No input source available');
    }
    
    // Determine output directory for logs
    // ✅ Use ANT_FEATURE_PATH if available (from HTTP server)
    // Otherwise calculate from resolved file or input path
    let featureDir: string;
    
    if (process.env.ANT_FEATURE_PATH) {
      // HTTP server mode: use provided feature path
      featureDir = process.env.ANT_FEATURE_PATH;
      console.log(`📂 [Command] Using ANT_FEATURE_PATH: ${featureDir}`);
    } else if (resolvedFile) {
      // CLI standalone mode: calculate from file path
      // resolvedFile is like: workspace/test-app/skeleton/inputs/directives/code/directive.md
      // We want: workspace/test-app/skeleton
      featureDir = path.dirname(path.dirname(path.dirname(path.dirname(resolvedFile))));
    } else {
      // Fallback: use inputPath or current directory
      featureDir = inputPath || process.cwd();
    }
    
    const outputDir = getSessionDebugDir(featureDir, 'architect', 'logs');
    console.log(`📂 [Command] Output directory: ${outputDir}`);
    
    // Start logging
    logger = new TaskLogger(outputDir, `architect-${jobType}`);
    logger.start();
    
    console.log(`🎯 Agent: Architect`);
    console.log(`📋 jobType: ${jobType}`);
    console.log(`🏗️  Project: ${project}`);
    console.log(`📂 Input: ${resolvedFile}`);
    if (options.mode) {
      console.log(`⚙️  Mode: ${options.mode}`);
    }
    console.log('');
    
    // Run orchestrator with new agent/task structure
    // Use unified workspace resolver (mode-agnostic)
    const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
    const workspaceResolver = new UnifiedWorkspaceResolver(workspacesPath);
    
    // ✅ Extract userContext from environment (set by server in Cloud mode)
    let userContext: import('../core/types/user').UserContext;
    if (process.env.ANT_USER_EMAIL) {
      // Cloud mode: Parse user email
      const [userId, organizationId] = process.env.ANT_USER_EMAIL.split('@');
      userContext = { userId, organizationId };
    } else {
      // Local mode: Use default
      userContext = { userId: 'local', organizationId: 'local' };
    }
    
    // ✅ Extract chat-related environment variables (already declared at line 100)
    const chatSource = process.env.ANT_CHAT_SOURCE === 'true';
    const feature = process.env.ANT_FEATURE_NAME;  // ✅ Feature name from server
    
    const result = await orchestrator({
      agent: 'architect',
      jobType,
      input,
      project,
      feature,  // ✅ Pass feature name (for chat jobs)
      inputFile: resolvedFile,
      mode: options.mode,
      enableEvaluation: jobType === 'code' && options.eval,  // Pass eval flag
      featurePath: featureDir,  // ✅ Pass full feature path
      projectPath: process.env.ANT_PROJECT_PATH,  // ✅ Pass full project path if available
      workspaceResolver,
      userContext,  // ✅ Pass user context
      overrideDirective,  // ✅ Pass chat directive
      chatSource  // ✅ Pass chat source flag
    });
    
    // ✅ Display result based on status (type guard for ArchitectResult)
    if (typeof result !== 'string' && 'success' in result) {
      if (result.status === 'paused' && result.interruption?.metadata?.tasksRemaining) {
        console.log('\n⏸️  Job paused due to recursion limit');
        console.log(`📊 Progress: ${result.interruption.metadata.tasksRemaining} tasks remaining`);
        console.log('💡 Run the same command again to resume\n');
      } else if (result.success) {
        console.log('\n✅ Job completed successfully!');
      } else {
        console.log('\n⚠️  Job completed with issues');
      }
    } else {
    console.log('\n✅ Job completed successfully!');
    }
    
    console.log('\n--- Result ---\n', JSON.stringify(result, null, 2));
    
    // Stop logging and wait for stream to finish
    if (logger) {
      await logger.stopAsync();
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    
    // Stop logging on error and wait for stream to finish
    if (logger) {
      await logger.stopAsync();
    }
    
    process.exit(1);
  }
}

/**
 * Run reviewer agent
 */
async function runReviewer(inputPath: string, options: any) {
  try {
    const project = options.project || detectProject(inputPath);
    
    console.log(`🎯 Agent: Reviewer`);
    console.log(`🏗️  Project: ${project}`);
    if (options.pr) {
      console.log(`🔍 PR: #${options.pr}`);
    }
    console.log('');
    
    const result = await orchestrator({
      agent: 'reviewer',
      input: inputPath,
      project,
      inputFile: inputPath
    });
    
    console.log('\n✅ Review completed!');
    console.log('\n--- Result ---\n', JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Run planner agent
 */
async function runPlanner(inputPath: string, options: any) {
  try {
    const project = options.project || detectProject(inputPath);
    const input = fs.readFileSync(inputPath, 'utf-8');
    
    console.log(`🎯 Agent: Planner`);
    console.log(`🏗️  Project: ${project}`);
    console.log('');
    
    const result = await orchestrator({
      agent: 'planner',
      input,
      project,
      inputFile: inputPath
    });
    
    console.log('\n✅ Plan created!');
    console.log('\n--- Result ---\n', JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Run doc agent
 */
async function runDoc(inputPath: string, options: any) {
  try {
    const project = options.project || detectProject(inputPath);
    const input = fs.readFileSync(inputPath, 'utf-8');
    
    console.log(`🎯 Agent: Doc`);
    console.log(`🏗️  Project: ${project}`);
    console.log('');
    
    const result = await orchestrator({
      agent: 'doc',
      input,
      project,
      inputFile: inputPath
    });
    
    console.log('\n✅ Documentation updated!');
    console.log('\n--- Result ---\n', JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Run index command
 */
async function runIndex(project: string, options: any) {
  try {
    const { indexCommand } = await import('../commands/index');
    await indexCommand(project, {
      incremental: options.incremental || false
    });
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Evaluation is now integrated into Architect workflow
// No separate evaluation command needed

export { program };


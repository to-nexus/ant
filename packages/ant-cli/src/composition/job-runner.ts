#!/usr/bin/env node
/**
 * Job Runner - Child Process Entry Point
 * 
 * This script is spawned by JobWorker to execute individual jobs.
 * It receives job parameters via environment variables and executes
 * the appropriate agent workflow via orchestrator.
 * 
 * Environment Variables:
 *   ANT_JOB_ID           - Job ID
 *   ANT_PROJECT_ID       - Project ID
 *   ANT_FEATURE          - Feature name
 *   ANT_JOB_TYPE         - Job type (code, design, learn)
 *   ANT_AGENT            - Agent type (architect, reviewer, planner, doc)
 *   ANT_MODE             - Execution mode (generate, refactor, explain)
 *   ANT_USER_ID          - User ID
 *   ANT_ORG_ID           - Organization ID
 *   ANT_OVERRIDE_DIRECTIVE - Override directive (optional)
 *   ANT_INPUT_FILE       - Input file path (optional)
 *   ANT_IS_RESUME        - Whether this is a resume (optional)
 *   ANT_ORIGINAL_JOB_ID  - Original job ID for resume (optional)
 *   ANT_REDIS_URL        - Redis URL for state updates
 *   ANT_CHAT_SOURCE      - Whether from chat (optional)
 * 
 * Output:
 *   - Progress updates via stdout: "PROGRESS:{json}"
 *   - Final result via stdout: "RESULT:{json}"
 *   - Logs via stdout/stderr
 * 
 * @see JobWorker.ts
 */

import 'dotenv/config';
import * as path from 'path';
import { orchestrator } from './orchestrator';
import { UnifiedWorkspaceResolver } from '../infrastructure/workspace/WorkspaceResolver';
import { initPartials } from '../periphery/adapters/prompt/FilePromptAdapter';
import { logger } from '../utils/logger';
import { handleGracefulShutdown } from './gracefulShutdown';

interface JobParams {
  jobId: string;
  projectId: string;
  feature: string;
  jobType: 'code' | 'design' | 'learn' | 'inline-ask' | 'visual';
  agent: 'architect' | 'reviewer' | 'planner' | 'doc' | 'creator';
  mode: 'generate' | 'refactor' | 'explain';
  userId: string;
  orgId: string;
  projectPath: string;    // Full project path (already resolved)
  featurePath: string;    // Full feature path (already resolved)
  overrideDirective?: string;
  inputFile?: string;
  isResume?: boolean;
  originalJobId?: string;
  skipTriage?: boolean;
  chatSource?: boolean;
}

function getJobParams(): JobParams {
  const required = ['ANT_JOB_ID', 'ANT_PROJECT_ID', 'ANT_FEATURE', 'ANT_JOB_TYPE', 'ANT_AGENT', 'ANT_USER_ID', 'ANT_ORG_ID', 'ANT_PROJECT_PATH', 'ANT_FEATURE_PATH'];
  
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  
  return {
    jobId: process.env.ANT_JOB_ID!,
    projectId: process.env.ANT_PROJECT_ID!,
    feature: process.env.ANT_FEATURE!,
    jobType: process.env.ANT_JOB_TYPE as 'code' | 'design' | 'learn' | 'visual',
    agent: process.env.ANT_AGENT as 'architect' | 'reviewer' | 'planner' | 'doc' | 'creator',
    mode: (process.env.ANT_MODE || 'generate') as 'generate' | 'refactor' | 'explain',
    userId: process.env.ANT_USER_ID!,
    orgId: process.env.ANT_ORG_ID!,
    projectPath: process.env.ANT_PROJECT_PATH!,
    featurePath: process.env.ANT_FEATURE_PATH!,
    overrideDirective: process.env.ANT_OVERRIDE_DIRECTIVE,
    inputFile: process.env.ANT_INPUT_FILE,
    isResume: process.env.ANT_IS_RESUME === 'true',
    originalJobId: process.env.ANT_ORIGINAL_JOB_ID,
    chatSource: process.env.ANT_CHAT_SOURCE === 'true',
    skipTriage: process.env.ANT_SKIP_TRIAGE === 'true'
  };
}

function reportProgress(phase: string, message: string, percentage?: number): void {
  const progress = { phase, message, percentage, timestamp: new Date().toISOString() };
  console.log(`PROGRESS:${JSON.stringify(progress)}`);
}

function reportResult(success: boolean, output?: any, error?: string): void {
  const result = { success, output, error, timestamp: new Date().toISOString() };
  console.log(`RESULT:${JSON.stringify(result)}`);
}

async function runJob(params: JobParams): Promise<void> {
  logger.info(`Job runner started: ${params.jobId} (type: ${params.jobType}, agent: ${params.agent})`, { 
    component: 'JobRunner',
    jobId: params.jobId
  });
  
  reportProgress('starting', `Starting ${params.jobType} job with ${params.agent} agent`);
  
  const userContext = {
    userId: params.userId,
    organizationId: params.orgId,
  };
  
  try {
    // Create workspace resolver for cloud mode
    const workspaceResolver = new UnifiedWorkspaceResolver(process.env.ANT_WORKSPACE_BASE_PATH || process.cwd());
    
    // Use pre-resolved paths from environment variables
    const { projectPath, featurePath } = params;
    
    // Read directive from input file if provided
    let input = params.overrideDirective || '';
    if (params.inputFile) {
      try {
        const fs = await import('fs/promises');
        input = await fs.readFile(params.inputFile, 'utf-8');
      } catch (e) {
        logger.warn(`Could not read input file: ${params.inputFile}`, { component: 'JobRunner' });
      }
    }
    
    reportProgress('executing', `Running ${params.agent} ${params.jobType}...`);
    
    // Call orchestrator
    const result = await orchestrator({
      agent: params.agent,
      jobType: params.jobType,
      input,
      project: params.projectId,
      feature: params.feature,
      inputFile: params.inputFile,
      mode: params.mode,
      jobId: params.isResume ? params.originalJobId : params.jobId,
      featurePath,
      projectPath,
      workspaceResolver,
      userContext,
      overrideDirective: params.overrideDirective,
      chatSource: params.chatSource,
      skipTriage: params.skipTriage
    });
    
    reportProgress('completed', 'Job completed successfully', 100);
    reportResult(true, result);
    
  } catch (error: any) {
    logger.error(`Job runner failed: ${params.jobId}`, { 
      component: 'JobRunner',
      jobId: params.jobId 
    }, error);
    
    reportProgress('failed', error.message);
    reportResult(false, {
      success: false,
      job: params.jobType,
      interruption: {
        reason: 'process_crash',
        message: error.message || 'Unexpected error occurred.',
        timestamp: new Date().toISOString(),
        canResume: true,
      },
    }, error.message);
    
    throw error;
  }
}

async function main(): Promise<void> {
  const params = getJobParams();
  
  const partialResult = await initPartials();
  if (partialResult.failed.length > 0) {
    console.error(`⛔ ${partialResult.failed.length} partial(s) failed to register`);
  }
  
  try {
    await runJob(params);
    
    // Ensure stdout is fully flushed before exiting.
    // process.exit() terminates immediately, dropping any data still queued
    // in libuv's write buffer. For large RESULT JSON (e.g. 28k+ chars of
    // generatedDocument), the pipe buffer can overflow and libuv queues the
    // remainder — which is then lost if we exit too soon.
    await new Promise<void>((resolve) => {
      process.stdout.write('', () => resolve());
    });
    process.exit(0);
    
  } catch (error: any) {
    console.error(`Job runner error: ${error.message}`);
    await new Promise<void>((resolve) => {
      process.stdout.write('', () => resolve());
    });
    process.exit(1);
  }
}

// ============================================
// SIGTERM Handler — Graceful Shutdown
// ============================================
// When JobWorker sends SIGTERM (user clicked Stop), we attempt to:
// 1. Interrupt the active orchestrator (push running tasks back to queue)
// 2. Save a final checkpoint to the session file
// 3. Exit cleanly with code 143 (128 + SIGTERM signal 15)
//
// The orchestrator has 2.5s to complete before we force-exit.
// JobWorker waits 3s before sending SIGKILL, giving us a safety margin.
process.on('SIGTERM', async () => {
  console.log(`\n🛑 [JobRunner] SIGTERM received — starting graceful shutdown...`);
  try {
    await handleGracefulShutdown('user_stopped');
  } catch (error: any) {
    console.error(`[JobRunner] Graceful shutdown error:`, error?.message);
  }
  console.log(`[JobRunner] Exiting with code 143 (SIGTERM)`);
  process.exit(143);
});

// Run
main();

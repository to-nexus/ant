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
 *   ANT_WORKSPACE_PATH   - Workspace path
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
import { logger } from '../utils/logger';

interface JobParams {
  jobId: string;
  projectId: string;
  feature: string;
  jobType: 'code' | 'design' | 'learn';
  agent: 'architect' | 'reviewer' | 'planner' | 'doc';
  mode: 'generate' | 'refactor' | 'explain';
  userId: string;
  orgId: string;
  workspacePath: string;
  projectPath: string;    // Full project path (already resolved)
  featurePath: string;    // Full feature path (already resolved)
  overrideDirective?: string;
  inputFile?: string;
  isResume?: boolean;
  originalJobId?: string;
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
    jobType: process.env.ANT_JOB_TYPE as 'code' | 'design' | 'learn',
    agent: process.env.ANT_AGENT as 'architect' | 'reviewer' | 'planner' | 'doc',
    mode: (process.env.ANT_MODE || 'generate') as 'generate' | 'refactor' | 'explain',
    userId: process.env.ANT_USER_ID!,
    orgId: process.env.ANT_ORG_ID!,
    workspacePath: process.env.ANT_WORKSPACE_PATH || process.cwd(),
    projectPath: process.env.ANT_PROJECT_PATH!,
    featurePath: process.env.ANT_FEATURE_PATH!,
    overrideDirective: process.env.ANT_OVERRIDE_DIRECTIVE,
    inputFile: process.env.ANT_INPUT_FILE,
    isResume: process.env.ANT_IS_RESUME === 'true',
    originalJobId: process.env.ANT_ORIGINAL_JOB_ID,
    chatSource: process.env.ANT_CHAT_SOURCE === 'true'
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
    workspacePath: params.workspacePath
  };
  
  try {
    // Create workspace resolver for cloud mode
    const workspaceResolver = new UnifiedWorkspaceResolver(params.workspacePath);
    
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
      chatSource: params.chatSource
    });
    
    reportProgress('completed', 'Job completed successfully', 100);
    reportResult(true, result);
    
  } catch (error: any) {
    logger.error(`Job runner failed: ${params.jobId}`, { 
      component: 'JobRunner',
      jobId: params.jobId 
    }, error);
    
    reportProgress('failed', error.message);
    reportResult(false, undefined, error.message);
    
    throw error;
  }
}

async function main(): Promise<void> {
  const params = getJobParams();
  
  try {
    await runJob(params);
    
    // Clean exit
    process.exit(0);
    
  } catch (error: any) {
    console.error(`Job runner error: ${error.message}`);
    process.exit(1);
  }
}

// Run
main();

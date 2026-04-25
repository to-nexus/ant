import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../../../../utils/logger';
import { JobStateTracker } from '../managers/JobStateTracker';
import { ServerDependencies } from '../types';
import { pauseJob } from './pauseJob';

/**
 * ServerLifecycleManager
 * 
 * Manages server lifecycle: startup, graceful shutdown, and cleanup.
 * Handles job state preservation during shutdown.
 */
export class ServerLifecycleManager {
  private readonly SHUTDOWN_TIMEOUT = 5000;  // 5 seconds

  constructor(
    private readonly stateTracker: JobStateTracker,
    private readonly deps: ServerDependencies,
    private readonly cleanupJobState: (
      jobId: string,
      projectId?: string,
      featureName?: string,
      interruptionReason?: any,
      explicitJobType?: 'design' | 'code' | 'learn' | 'plan' | 'visual',
      userContext?: any
    ) => Promise<void>
  ) {}

  /**
   * Graceful shutdown with job state preservation
   */
  async shutdown(): Promise<void> {
    logger.info('Graceful shutdown initiated', { component: 'ServerLifecycle' });
    
    return new Promise((resolve) => {
      // Timeout timer - force shutdown if taking too long
      const timeoutId = setTimeout(() => {
        logger.warn('Shutdown timeout (5s) - forcing exit', { component: 'ServerLifecycle' });
        this.forceShutdown();
        resolve();
      }, this.SHUTDOWN_TIMEOUT);
      
      // Actual shutdown logic
      this.performGracefulShutdown()
        .then(() => {
          clearTimeout(timeoutId);
          logger.info('Graceful shutdown complete', { component: 'ServerLifecycle' });
          resolve();
        })
        .catch((error) => {
          logger.error('Shutdown error', { component: 'ServerLifecycle' }, error);
          clearTimeout(timeoutId);
          this.forceShutdown();
          resolve();
        });
    });
  }

  /**
   * Perform graceful shutdown in steps
   */
  private async performGracefulShutdown(): Promise<void> {
    // Step 1: Save all running jobs
    await this.saveAllRunningJobs();
    
    // Step 2: Terminate all child processes
    await this.terminateAllChildProcesses();
    
    // Step 3: Cleanup services
    await this.cleanupServices();
  }

  /**
   * Save all running jobs to session files before shutdown
   */
  private async saveAllRunningJobs(): Promise<void> {
    const state = this.stateTracker.getState();
    const jobCount = state.childProcesses.size;
    
    if (jobCount === 0) {
      logger.debug('No running jobs to save', { component: 'ServerLifecycle' });
      return;
    }
    
    logger.info(`Saving ${jobCount} running job(s)...`, { component: 'ServerLifecycle' });
    
    const savePromises: Promise<void>[] = [];
    
    for (const [jobId, childProcess] of state.childProcesses.entries()) {
      const mapping = this.stateTracker.getJobMapping(jobId);
      
      if (!mapping) {
        logger.warn(`No mapping found for job ${jobId}, skipping save`, { 
          component: 'ServerLifecycle', 
          jobId 
        });
        continue;
      }
      
      logger.debug(`Saving job`, { 
        component: 'ServerLifecycle', 
        jobId, 
        projectId: mapping.projectId, 
        featureName: mapping.featureName 
      });
      
      // Pause (resumable) — graceful shutdown keeps Redis state intact so
      // the job can be resumed on next startup. Use the SSOT pauseJob helper
      // instead of calling cleanupJobState directly; pauseJob additionally
      // sets status='paused' in Redis which is what StaleJobRecovery Phase 1
      // will match on next boot.
      const savePromise = pauseJob(
        { cleanupJobState: this.cleanupJobState },
        {
          jobId,
          projectId: mapping.projectId,
          featureName: mapping.featureName,
          jobType: mapping.jobType as 'code' | 'design' | 'learn' | 'plan' | 'visual',
          userContext: mapping.userContext as { userId: string; organizationId: string } | undefined,
          interruption: {
            reason: 'server_shutdown',
            message: 'Server is shutting down',
            canResume: true,
            timestamp: new Date().toISOString(),
          },
        },
      ).catch((error) => {
        logger.warn(`Failed to save job: ${error.message}`, {
          component: 'ServerLifecycle',
          jobId,
        }, error);
      });

      savePromises.push(savePromise);
    }
    
    await Promise.all(savePromises);
    logger.info(`All jobs saved (${jobCount} total)`, { component: 'ServerLifecycle' });
  }

  /**
   * Terminate all child processes gracefully
   */
  private async terminateAllChildProcesses(): Promise<void> {
    const state = this.stateTracker.getState();
    const processCount = state.childProcesses.size;
    
    if (processCount === 0) {
      logger.debug('No child processes to terminate', { component: 'ServerLifecycle' });
      return;
    }
    
    logger.info(`Terminating ${processCount} child process(es)...`, { component: 'ServerLifecycle' });
    
    const killPromises: Promise<void>[] = [];
    
    for (const [jobId, childProcess] of state.childProcesses.entries()) {
      const killPromise = this.terminateChildProcess(jobId, childProcess);
      killPromises.push(killPromise);
    }
    
    await Promise.all(killPromises);
    state.childProcesses.clear();
    logger.info(`All child processes terminated (${processCount} total)`, { component: 'ServerLifecycle' });
  }

  /**
   * Terminate a single child process gracefully
   */
  private async terminateChildProcess(jobId: string, proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (!proc.pid) {
        logger.debug(`Job ${jobId}: No PID, skipping...`, { component: 'ServerLifecycle', jobId });
        resolve();
        return;
      }
      
      const pid = proc.pid;
      logger.debug(`Terminating job (PID: ${pid})...`, { component: 'ServerLifecycle', jobId });
      
      // Send SIGTERM for graceful termination
      proc.kill('SIGTERM');
      
      // Wait 2 seconds for graceful exit
      const forceKillTimer = setTimeout(() => {
        try {
          // Check if process is still alive
          process.kill(pid, 0);
          logger.warn(`Job didn't exit gracefully, sending SIGKILL...`, { 
            component: 'ServerLifecycle', 
            jobId 
          });
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already dead
        }
        resolve();
      }, 2000);
      
      // Listen for exit event
      proc.once('exit', (code) => {
        clearTimeout(forceKillTimer);
        logger.debug(`Job terminated (exit code: ${code})`, { component: 'ServerLifecycle', jobId });
        resolve();
      });
    });
  }

  /**
   * Cleanup all services and in-memory state
   */
  private async cleanupServices(): Promise<void> {
    logger.info('Cleaning up services...', { component: 'ServerLifecycle' });
    
    // Cleanup SessionService
    try {
      this.deps.sessionService?.cleanup();
      logger.debug('SessionService cleaned', { component: 'ServerLifecycle' });
    } catch (error) {
      logger.warn('SessionService cleanup error', { component: 'ServerLifecycle' }, error);
    }
    
    // Note: PreviewService cleanup moved to ant-preview (see 10-cloud-architecture.md)
    
    // Cleanup IDEService
    try {
      if (this.deps.ideService && typeof (this.deps.ideService as any).cleanup === 'function') {
        await (this.deps.ideService as any).cleanup();
        logger.debug('IDEService cleaned', { component: 'ServerLifecycle' });
      }
    } catch (error) {
      logger.warn('IDEService cleanup error', { component: 'ServerLifecycle' }, error);
    }
    
    // Clear in-memory state
    this.stateTracker.clearAll();
    logger.debug('In-memory state cleared', { component: 'ServerLifecycle' });
  }

  /**
   * Force shutdown (emergency fallback)
   */
  private forceShutdown(): void {
    logger.warn('Force shutdown initiated...', { component: 'ServerLifecycle' });
    
    const state = this.stateTracker.getState();
    
    // Kill all processes immediately with SIGKILL
    state.childProcesses.forEach((proc) => {
      if (proc.pid) {
        try {
          process.kill(proc.pid, 'SIGKILL');
          logger.warn(`Force killed PID ${proc.pid}`, { component: 'ServerLifecycle' });
        } catch {
          // Ignore errors
        }
      }
    });
    state.childProcesses.clear();
    
    logger.warn('Force shutdown complete', { component: 'ServerLifecycle' });
  }
}

/**
 * JobTimingManager
 * 
 * Centralized manager for job timing logic across all job types (code, design, learn).
 * Eliminates code duplication and ensures consistent timing behavior.
 */

export interface JobTiming {
  startedAt: string;              // Job 최초 시작 시간 (Resume 후에도 유지)
  lastResumedAt?: string;         // 마지막 Resume 시간
  pausedAt?: string;              // 중단 시간 (Stop 또는 recursion limit)
  completedAt?: string;           // 완료 시간
  totalPausedDuration: number;    // 총 일시정지 시간 (ms)
  estimatingDuration?: number;    // Estimating 단계 소요 시간 (ms, decompose 완료까지)
  totalElapsedTime?: number;      // 총 실 소요 시간 (ms, 일시정지 제외)
}

export class JobTimingManager {
  /**
   * Initialize timing for a new job
   * 
   * @param jobId - The job ID
   * @returns New jobId and jobTiming objects
   */
  static initializeNewJob(jobId: string): { jobId: string; jobTiming: JobTiming; estimatingStartTime: string } {
    const estimatingStartTime = new Date().toISOString();
    
    const jobTiming: JobTiming = {
      startedAt: estimatingStartTime,
      totalPausedDuration: 0
    };
    
    console.log(`⏰ [New Job] Initialized jobTiming:`);
    console.log(`   Job ID: ${jobId}`);
    console.log(`   Started at: ${estimatingStartTime}`);
    
    return {
      jobId,
      jobTiming,
      estimatingStartTime
    };
  }
  
  /**
   * Resume timing from a paused job
   * 
   * @param existingJobId - Job ID from session
   * @param sessionJobTiming - Job timing from session
   * @returns Updated jobId and jobTiming
   */
  static resumeJob(existingJobId: string, sessionJobTiming?: JobTiming): { jobId: string; jobTiming?: JobTiming } {
    if (!sessionJobTiming) {
      console.log(`⚠️  [Resume] No jobTiming in session, will initialize new timing`);
      return { jobId: existingJobId };
    }
    
    let resumedJobTiming = sessionJobTiming;
    
    // If job was paused, calculate accumulated pause duration
    if (resumedJobTiming.pausedAt) {
      const pausedTime = new Date(resumedJobTiming.pausedAt).getTime();
      const resumeTime = Date.now();
      const pauseDuration = resumeTime - pausedTime;
      
      resumedJobTiming = {
        ...resumedJobTiming,
        lastResumedAt: new Date().toISOString(),
        totalPausedDuration: (resumedJobTiming.totalPausedDuration || 0) + pauseDuration,
        pausedAt: undefined  // Clear pausedAt on resume
      };
      
      console.log(`⏰ [Resume] Updated jobTiming:`);
      console.log(`   Pause duration: ${Math.round(pauseDuration / 1000)}s`);
      console.log(`   Total paused: ${Math.round(resumedJobTiming.totalPausedDuration / 1000)}s`);
    } else {
      console.log(`⏰ [Resume] Job was not paused, using existing timing`);
    }
    
    return {
      jobId: existingJobId,
      jobTiming: resumedJobTiming
    };
  }
  
  /**
   * Finalize estimating phase and calculate duration
   * 
   * @param jobTiming - Current job timing
   * @param estimatingStartTime - When estimating started (ISO string)
   * @returns Updated jobTiming with estimatingDuration
   */
  static finalizeEstimatingPhase(
    jobTiming: JobTiming,
    estimatingStartTime: string,
    phaseBreakdown?: Record<string, number>
  ): JobTiming {
    const estimatingEndTime = Date.now();
    const estimatingDuration = estimatingEndTime - new Date(estimatingStartTime).getTime();
    
    const finalJobTiming: JobTiming = {
      ...jobTiming,
      estimatingDuration,
      ...(phaseBreakdown && { phaseBreakdown }),
    };
    
    console.log(`⏰ [Decompose Complete] Estimating took ${Math.round(estimatingDuration / 1000)}s`);
    if (phaseBreakdown) {
      const breakdown = Object.entries(phaseBreakdown).map(([k, v]) => `${k}: ${Math.round(v / 1000)}s`).join(', ');
      console.log(`   Phase breakdown: ${breakdown}`);
    }
    
    return finalJobTiming;
  }
  
  /**
   * Mark job as completed
   * 
   * @param jobTiming - Current job timing
   * @returns Updated jobTiming with completedAt
   */
  static completeJob(jobTiming?: JobTiming): JobTiming | undefined {
    if (!jobTiming) return undefined;
    
    const completedJobTiming: JobTiming = {
      ...jobTiming,
      completedAt: new Date().toISOString()
    };
    
    console.log(`⏰ [Job Complete] Marked as completed at ${completedJobTiming.completedAt}`);
    
    return completedJobTiming;
  }
  
  /**
   * Mark job as paused
   * 
   * @param jobTiming - Current job timing
   * @returns Updated jobTiming with pausedAt
   */
  static pauseJob(jobTiming?: JobTiming): JobTiming | undefined {
    if (!jobTiming) return undefined;
    
    const pausedJobTiming: JobTiming = {
      ...jobTiming,
      pausedAt: new Date().toISOString()
    };
    
    console.log(`⏰ [Job Paused] Marked as paused at ${pausedJobTiming.pausedAt}`);
    
    return pausedJobTiming;
  }
}

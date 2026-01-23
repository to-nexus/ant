/**
 * Memory Job Queue
 * 
 * 메모리 기반 Job Queue 구현 (개발/테스트용)
 * 
 * 프로덕션에서는 BullJobQueue (Redis 기반) 사용 권장
 */

import * as crypto from 'crypto';
import { LegacyJobQueuePort, JobRequest, JobQueueStatus } from '../../core/ports/queue';

/**
 * @deprecated Use LocalJobQueue instead. This class implements the legacy interface.
 */
export class MemoryJobQueue implements LegacyJobQueuePort {
  private queue: JobRequest[] = [];
  private jobs: Map<string, { request: JobRequest; status: JobQueueStatus }> = new Map();
  private processing: boolean = false;
  
  /**
   * Job을 queue에 추가
   */
  async enqueue(job: JobRequest): Promise<string> {
    const jobId = job.id || crypto.randomUUID();
    const jobRequest: JobRequest = {
      ...job,
      id: jobId
    };
    
    // Queue에 추가
    this.queue.push(jobRequest);
    
    // Status 초기화
    const status: JobQueueStatus = {
      id: jobId,
      status: 'pending',
      createdAt: new Date()
    };
    
    this.jobs.set(jobId, { request: jobRequest, status });
    
    console.log(`[MemoryJobQueue] Enqueued job ${jobId} for user ${job.userId}`);
    
    // 자동으로 처리 시작 (개발 편의성)
    this.processNext();
    
    return jobId;
  }
  
  /**
   * Queue에서 다음 job 가져오기
   */
  async dequeue(): Promise<JobRequest | null> {
    if (this.queue.length === 0) {
      return null;
    }
    
    // 우선순위 정렬 (높은 우선순위가 먼저)
    this.queue.sort((a, b) => b.priority - a.priority);
    
    const job = this.queue.shift();
    
    if (job) {
      // Status를 'running'으로 업데이트
      const jobData = this.jobs.get(job.id);
      if (jobData) {
        jobData.status.status = 'running';
        jobData.status.startedAt = new Date();
      }
      
      console.log(`[MemoryJobQueue] Dequeued job ${job.id}`);
    }
    
    return job || null;
  }
  
  /**
   * Job 상태 조회
   */
  async getJobStatus(jobId: string): Promise<JobQueueStatus> {
    const jobData = this.jobs.get(jobId);
    
    if (!jobData) {
      throw new Error(`Job not found: ${jobId}`);
    }
    
    return jobData.status;
  }
  
  /**
   * 사용자의 모든 job 조회
   */
  async getUserJobs(userId: string): Promise<JobQueueStatus[]> {
    const userJobs: JobQueueStatus[] = [];
    
    for (const [jobId, jobData] of this.jobs.entries()) {
      if (jobData.request.userId === userId) {
        userJobs.push(jobData.status);
      }
    }
    
    // 최신순 정렬
    userJobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return userJobs;
  }
  
  /**
   * Job 취소
   */
  async cancelJob(jobId: string): Promise<void> {
    // Queue에서 제거
    const index = this.queue.findIndex(j => j.id === jobId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      console.log(`[MemoryJobQueue] Removed job ${jobId} from queue`);
    }
    
    // Status 업데이트
    const jobData = this.jobs.get(jobId);
    if (jobData) {
      jobData.status.status = 'cancelled';
      jobData.status.completedAt = new Date();
      console.log(`[MemoryJobQueue] Cancelled job ${jobId}`);
    }
  }
  
  /**
   * Job 완료 처리
   */
  async completeJob(jobId: string, result?: any, error?: string): Promise<void> {
    const jobData = this.jobs.get(jobId);
    
    if (!jobData) {
      console.warn(`[MemoryJobQueue] Cannot complete unknown job: ${jobId}`);
      return;
    }
    
    jobData.status.status = error ? 'failed' : 'completed';
    jobData.status.result = result;
    jobData.status.error = error;
    jobData.status.completedAt = new Date();
    
    console.log(`[MemoryJobQueue] Job ${jobId} ${jobData.status.status}`);
  }
  
  /**
   * Job 진행률 업데이트
   */
  async updateProgress(jobId: string, progress: number): Promise<void> {
    const jobData = this.jobs.get(jobId);
    
    if (jobData) {
      jobData.status.progress = progress;
    }
  }
  
  // ========================================
  // Private Methods
  // ========================================
  
  /**
   * 다음 job 자동 처리 (개발용)
   * 
   * 실제 프로덕션에서는 별도 Worker 프로세스가 처리
   */
  private async processNext(): Promise<void> {
    if (this.processing) {
      return; // 이미 처리 중
    }
    
    this.processing = true;
    
    try {
      const job = await this.dequeue();
      
      if (job) {
        // 🚨 실제 job 실행은 BaseServerAdapter에서 처리
        // 여기서는 status만 관리
        console.log(`[MemoryJobQueue] Processing job ${job.id} (실제 실행은 adapter에서)`);
      }
    } catch (error) {
      console.error('[MemoryJobQueue] Error processing job:', error);
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Queue 상태 확인 (디버깅용)
   */
  getQueueStatus(): { pending: number; running: number; completed: number } {
    let pending = 0;
    let running = 0;
    let completed = 0;
    
    for (const [_, jobData] of this.jobs.entries()) {
      switch (jobData.status.status) {
        case 'pending':
          pending++;
          break;
        case 'running':
          running++;
          break;
        case 'completed':
        case 'failed':
        case 'cancelled':
          completed++;
          break;
      }
    }
    
    return { pending, running, completed };
  }
}


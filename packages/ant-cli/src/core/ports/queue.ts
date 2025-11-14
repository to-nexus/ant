/**
 * Job Queue Port
 * 
 * 비동기 Job 처리를 위한 Queue 인터페이스
 */

import { ExecuteJobParams } from './http';

export interface JobQueuePort {
  /**
   * Job을 queue에 추가
   * @returns jobId
   */
  enqueue(job: JobRequest): Promise<string>;
  
  /**
   * Queue에서 다음 job 가져오기
   */
  dequeue(): Promise<JobRequest | null>;
  
  /**
   * Job 상태 조회
   */
  getJobStatus(jobId: string): Promise<JobQueueStatus>;
  
  /**
   * 사용자의 모든 job 조회
   */
  getUserJobs(userId: string): Promise<JobQueueStatus[]>;
  
  /**
   * Job 취소
   */
  cancelJob(jobId: string): Promise<void>;
}

// ========================================
// Types
// ========================================

export interface JobRequest {
  id: string;
  userId: string;
  organizationId: string;
  params: ExecuteJobParams;
  priority: number;
  createdAt: Date;
}

/**
 * Job Queue Status (별도 타입 - http.JobStatus와 다름)
 */
export interface JobQueueStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  result?: any;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}


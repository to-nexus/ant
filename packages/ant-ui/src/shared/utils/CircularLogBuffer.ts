/**
 * Circular Buffer for efficient FIFO log storage
 * 
 * 장점:
 * - O(1) 추가 (배열 복사 없음)
 * - O(1) 제거 (자동 덮어쓰기)
 * - 고정 메모리 사용
 */

import { LogEntry } from '@/domain/models/log';

export class CircularLogBuffer {
  private buffer: (LogEntry | null)[];
  private head: number = 0;  // 읽기 시작 위치
  private tail: number = 0;  // 쓰기 위치
  private size: number = 0;  // 현재 로그 개수
  private readonly capacity: number;

  constructor(capacity: number = 2000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
  }

  /**
   * 로그 추가 (FIFO: 가득 차면 가장 오래된 것 제거)
   */
  add(log: LogEntry): void {
    this.buffer[this.tail] = log;
    this.tail = (this.tail + 1) % this.capacity;
    
    if (this.size < this.capacity) {
      this.size++;
    } else {
      // 버퍼 가득 참: head 이동 (가장 오래된 로그 제거)
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * 모든 로그 반환 (순서대로)
   */
  getAll(): LogEntry[] {
    if (this.size === 0) return [];
    
    const result: LogEntry[] = [];
    for (let i = 0; i < this.size; i++) {
      const index = (this.head + i) % this.capacity;
      const log = this.buffer[index];
      if (log !== null) {
        result.push(log);
      }
    }
    return result;
  }

  /**
   * 최근 N개 로그만 반환
   */
  getRecent(count: number): LogEntry[] {
    const actualCount = Math.min(count, this.size);
    const result: LogEntry[] = [];
    
    for (let i = this.size - actualCount; i < this.size; i++) {
      const index = (this.head + i) % this.capacity;
      const log = this.buffer[index];
      if (log !== null) {
        result.push(log);
      }
    }
    return result;
  }

  /**
   * 로그 개수
   */
  getSize(): number {
    return this.size;
  }

  /**
   * 버퍼 용량
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * 모든 로그 삭제
   */
  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  /**
   * 버퍼 가득 찼는지 확인
   */
  isFull(): boolean {
    return this.size === this.capacity;
  }
}



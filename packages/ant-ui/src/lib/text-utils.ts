/**
 * Text utility functions
 * 
 * 공통 텍스트 변환 정책
 */

/**
 * 첫 글자를 대문자로 변환
 * @param text - 변환할 텍스트
 * @returns 첫 글자가 대문자인 텍스트
 * 
 * @example
 * capitalize('architect') // 'Architect'
 * capitalize('code') // 'Code'
 */
export function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Job ID를 짧은 형식으로 표시
 * @param jobId - 전체 Job ID
 * @param length - 표시할 문자 수 (기본: 8)
 * @returns 짧게 잘린 Job ID
 * 
 * @example
 * formatJobId('job-1234567890-abcdef') // 'job-1234...'
 */
export function formatJobId(jobId: string, length: number = 8): string {
  if (!jobId) return '';
  return jobId.length > length ? `${jobId.slice(0, length)}...` : jobId;
}


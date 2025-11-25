/**
 * Tool Result Manager
 * 
 * 책임:
 * - Tool 결과의 크기 제한 및 요약
 * - 대용량 결과 (search_code 등)의 intelligent truncation
 * - 토큰 예산 초과 방지
 * 
 * 전략:
 * - read_file: 파일 크기에 따라 truncate (헤더/푸터 보존)
 * - search_code: 상위 N개 결과만 포함
 * - list_files: 파일 수 제한
 * - 기타: JSON 포맷팅 간소화
 */

import { TokenBudgetManager } from './tokenBudget';

export interface TruncationConfig {
  maxTokensPerResult: number;     // Tool 결과당 최대 토큰 (기본: 5000)
  maxSearchResults: number;        // search_code 최대 결과 수 (기본: 20)
  maxListFiles: number;            // list_files 최대 파일 수 (기본: 50)
  maxReadFileTokens: number;       // read_file 최대 토큰 (기본: 3000)
  preserveErrors: boolean;         // 에러는 truncate 안함 (기본: true)
}

export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  originalTokens: number;
  truncatedTokens: number;
  reason?: string;
}

export class ToolResultManager {
  private tokenManager: TokenBudgetManager;
  private config: TruncationConfig;
  
  constructor(
    tokenManager: TokenBudgetManager,
    config?: Partial<TruncationConfig>
  ) {
    this.tokenManager = tokenManager;
    this.config = {
      maxTokensPerResult: config?.maxTokensPerResult || 5000,
      maxSearchResults: config?.maxSearchResults || 20,
      maxListFiles: config?.maxListFiles || 50,
      maxReadFileTokens: config?.maxReadFileTokens || 3000,
      preserveErrors: config?.preserveErrors !== false,
    };
  }
  
  /**
   * Tool 결과를 토큰 예산 내로 truncate
   */
  truncateResult(
    toolName: string,
    result: any,
    error?: string
  ): TruncationResult {
    // 에러는 truncate하지 않음
    if (error && this.config.preserveErrors) {
      return {
        content: `Error: ${error}`,
        wasTruncated: false,
        originalTokens: this.tokenManager.estimateTokens(error),
        truncatedTokens: this.tokenManager.estimateTokens(error),
      };
    }
    
    // Tool별 전용 truncation 로직
    switch (toolName) {
      case 'search_code':
        return this.truncateSearchCode(result);
      case 'read_file':
        return this.truncateReadFile(result);
      case 'list_files':
        return this.truncateListFiles(result);
      default:
        return this.truncateGeneric(result);
    }
  }
  
  /**
   * search_code 결과 truncation
   * 전략: 상위 N개 결과만 포함, 각 결과는 요약
   */
  private truncateSearchCode(result: any): TruncationResult {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const originalTokens = this.tokenManager.estimateTokens(resultStr);
    
    // 이미 작으면 그대로 반환
    if (originalTokens <= this.config.maxTokensPerResult) {
      return {
        content: resultStr,
        wasTruncated: false,
        originalTokens,
        truncatedTokens: originalTokens,
      };
    }
    
    // 검색 결과 파싱 시도
    const lines = resultStr.split('\n');
    const maxResults = this.config.maxSearchResults;
    
    // 각 파일의 첫 N개 매치만 포함
    const truncatedLines: string[] = [];
    let fileCount = 0;
    let matchCount = 0;
    
    for (const line of lines) {
      // 파일명 라인 (보통 콜론 앞에 경로)
      if (line.includes(':') && !line.startsWith('  ')) {
        if (fileCount >= maxResults) {
          truncatedLines.push(`\n... (truncated: ${lines.length - truncatedLines.length} more lines)`);
          break;
        }
        fileCount++;
        truncatedLines.push(line);
      } else {
        // 매치 내용
        if (matchCount < maxResults * 2) {  // 파일당 최대 2개 매치
          truncatedLines.push(line);
          matchCount++;
        }
      }
    }
    
    const truncatedStr = truncatedLines.join('\n');
    const truncatedTokens = this.tokenManager.estimateTokens(truncatedStr);
    
    console.log(`\n✂️  [ToolResult] Truncated search_code:`);
    console.log(`   Original: ${originalTokens.toLocaleString()} tokens (${lines.length} lines)`);
    console.log(`   Truncated: ${truncatedTokens.toLocaleString()} tokens (${truncatedLines.length} lines)`);
    console.log(`   Kept: Top ${fileCount} files, ${matchCount} matches`);
    
    return {
      content: truncatedStr,
      wasTruncated: true,
      originalTokens,
      truncatedTokens,
      reason: `Kept top ${fileCount} files out of many matches`,
    };
  }
  
  /**
   * read_file 결과 truncation
   * 전략: 파일의 시작과 끝 보존, 중간 생략
   */
  private truncateReadFile(result: any): TruncationResult {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const originalTokens = this.tokenManager.estimateTokens(resultStr);
    
    if (originalTokens <= this.config.maxReadFileTokens) {
      return {
        content: resultStr,
        wasTruncated: false,
        originalTokens,
        truncatedTokens: originalTokens,
      };
    }
    
    // 시작 40%, 끝 40% 보존 (중간 20% 생략)
    const lines = resultStr.split('\n');
    const keepStart = Math.floor(lines.length * 0.4);
    const keepEnd = Math.floor(lines.length * 0.4);
    
    const truncated = [
      ...lines.slice(0, keepStart),
      `\n... (${lines.length - keepStart - keepEnd} lines omitted) ...\n`,
      ...lines.slice(-keepEnd),
    ].join('\n');
    
    const truncatedTokens = this.tokenManager.estimateTokens(truncated);
    
    console.log(`\n✂️  [ToolResult] Truncated read_file:`);
    console.log(`   Original: ${originalTokens.toLocaleString()} tokens (${lines.length} lines)`);
    console.log(`   Truncated: ${truncatedTokens.toLocaleString()} tokens`);
    console.log(`   Kept: First ${keepStart} + Last ${keepEnd} lines`);
    
    return {
      content: truncated,
      wasTruncated: true,
      originalTokens,
      truncatedTokens,
      reason: `File too large, kept header and footer`,
    };
  }
  
  /**
   * list_files 결과 truncation
   * 전략: 상위 N개 파일만 포함
   */
  private truncateListFiles(result: any): TruncationResult {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const originalTokens = this.tokenManager.estimateTokens(resultStr);
    
    if (originalTokens <= this.config.maxTokensPerResult) {
      return {
        content: resultStr,
        wasTruncated: false,
        originalTokens,
        truncatedTokens: originalTokens,
      };
    }
    
    const lines = resultStr.split('\n');
    const maxLines = this.config.maxListFiles;
    
    if (lines.length <= maxLines) {
      return {
        content: resultStr,
        wasTruncated: false,
        originalTokens,
        truncatedTokens: originalTokens,
      };
    }
    
    const truncated = [
      ...lines.slice(0, maxLines),
      `\n... (${lines.length - maxLines} more files)`,
    ].join('\n');
    
    const truncatedTokens = this.tokenManager.estimateTokens(truncated);
    
    console.log(`\n✂️  [ToolResult] Truncated list_files:`);
    console.log(`   Original: ${lines.length} files`);
    console.log(`   Truncated: ${maxLines} files`);
    
    return {
      content: truncated,
      wasTruncated: true,
      originalTokens,
      truncatedTokens,
      reason: `Too many files, kept first ${maxLines}`,
    };
  }
  
  /**
   * 일반 tool 결과 truncation
   * 전략: JSON을 compact하게 포맷, 토큰 초과시 간단히 잘라냄
   */
  private truncateGeneric(result: any): TruncationResult {
    let resultStr: string;
    
    // JSON이면 compact 포맷
    if (typeof result === 'object') {
      resultStr = JSON.stringify(result);  // No pretty print
    } else {
      resultStr = String(result);
    }
    
    const originalTokens = this.tokenManager.estimateTokens(resultStr);
    
    if (originalTokens <= this.config.maxTokensPerResult) {
      return {
        content: resultStr,
        wasTruncated: false,
        originalTokens,
        truncatedTokens: originalTokens,
      };
    }
    
    // 간단히 문자열 길이 제한
    const maxChars = this.config.maxTokensPerResult * 3.5;  // ~3.5 chars per token
    const truncated = resultStr.substring(0, maxChars) + '\n... (truncated)';
    const truncatedTokens = this.tokenManager.estimateTokens(truncated);
    
    console.log(`\n✂️  [ToolResult] Truncated generic result:`);
    console.log(`   Original: ${originalTokens.toLocaleString()} tokens`);
    console.log(`   Truncated: ${truncatedTokens.toLocaleString()} tokens`);
    
    return {
      content: truncated,
      wasTruncated: true,
      originalTokens,
      truncatedTokens,
      reason: `Result too large`,
    };
  }
}


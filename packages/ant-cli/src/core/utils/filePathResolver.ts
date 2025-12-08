/**
 * File Path Resolver
 * 
 * Stack trace에서 추출한 파일명을 실제 코드베이스 경로로 변환
 * 
 * Problem:
 * - Stack trace: "RoomPage.tsx"
 * - Actual path: "codebase/src/pages/RoomPage.tsx" or "src/pages/RoomPage.tsx"
 * 
 * Solution:
 * 1. Git ls-files로 전체 파일 목록 검색
 * 2. 파일명 매칭 (정확 매칭 또는 fuzzy)
 * 3. 여러 매칭 시 가장 짧은 경로 우선 (src/X보다 X 선호)
 */

import * as path from 'path';
import { GitPort } from '../ports';

export interface FilePathMatch {
  originalPath: string;    // Stack trace 원본 경로
  resolvedPath: string;    // 실제 Git 경로
  confidence: 'exact' | 'fuzzy' | 'not_found';
  candidates?: string[];   // 여러 매칭 시 후보들
}

/**
 * Stack trace 파일 경로를 실제 Git 경로로 변환
 */
export async function resolveStackTraceFile(
  stackTraceFile: string,
  workingDir: string,
  git: GitPort
): Promise<FilePathMatch> {
  // 1. 이미 전체 경로인 경우 (절대 경로 또는 상대 경로)
  if (await git.fileExists(path.join(workingDir, stackTraceFile))) {
    return {
      originalPath: stackTraceFile,
      resolvedPath: stackTraceFile,
      confidence: 'exact'
    };
  }

  // 2. Git ls-files로 전체 파일 목록 가져오기
  const allFiles = await listGitFiles(git, workingDir);
  
  // 3. 파일명 추출
  const targetFileName = path.basename(stackTraceFile);
  
  // 4. 정확한 파일명 매칭
  const exactMatches = allFiles.filter(f => path.basename(f) === targetFileName);
  
  if (exactMatches.length === 0) {
    // 매칭 실패
    return {
      originalPath: stackTraceFile,
      resolvedPath: stackTraceFile,
      confidence: 'not_found'
    };
  }
  
  if (exactMatches.length === 1) {
    // 단일 매칭 - 정확!
    return {
      originalPath: stackTraceFile,
      resolvedPath: exactMatches[0],
      confidence: 'exact'
    };
  }
  
  // 5. 여러 매칭 - 우선순위 적용
  const bestMatch = selectBestMatch(stackTraceFile, exactMatches);
  
  return {
    originalPath: stackTraceFile,
    resolvedPath: bestMatch,
    confidence: 'fuzzy',
    candidates: exactMatches
  };
}

/**
 * 여러 매칭 중 가장 적합한 경로 선택
 * 
 * 우선순위:
 * 1. 스택 트레이스의 일부 경로 정보 매칭 (src/pages/X.tsx vs src/X.tsx)
 * 2. 짧은 경로 선호 (src/X.tsx > codebase/src/X.tsx)
 * 3. src/ 또는 app/ 디렉토리 우선
 */
function selectBestMatch(stackTraceFile: string, candidates: string[]): string {
  // Stack trace에 경로 정보가 있는 경우 (src/pages/RoomPage.tsx)
  const stackParts = stackTraceFile.split(path.sep);
  
  if (stackParts.length > 1) {
    // 경로 정보 포함 - 부분 매칭 시도
    for (const candidate of candidates) {
      if (candidate.endsWith(stackTraceFile)) {
        return candidate;
      }
    }
  }
  
  // 우선순위 점수 계산
  const scored = candidates.map(c => ({
    path: c,
    score: calculatePathScore(c)
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored[0].path;
}

/**
 * 경로 점수 계산 (높을수록 우선순위 높음)
 */
function calculatePathScore(filePath: string): number {
  let score = 0;
  
  // 짧은 경로 선호
  score -= filePath.split(path.sep).length;
  
  // src/ 또는 app/ 포함 시 가산점
  if (filePath.includes('src/')) score += 10;
  if (filePath.includes('app/')) score += 10;
  
  // pages/, components/, contexts/ 등 표준 디렉토리 가산점
  const standardDirs = ['pages', 'components', 'contexts', 'hooks', 'utils', 'services'];
  for (const dir of standardDirs) {
    if (filePath.includes(`/${dir}/`)) {
      score += 5;
      break;
    }
  }
  
  // codebase/ 접두사는 감점 (일반적으로 내부 구조)
  if (filePath.startsWith('codebase/')) score -= 5;
  
  // test, spec, __tests__ 등 테스트 파일은 감점
  if (filePath.includes('test') || filePath.includes('spec') || filePath.includes('__tests__')) {
    score -= 10;
  }
  
  return score;
}

/**
 * Git ls-files 실행 - 전체 파일 목록
 */
async function listGitFiles(git: GitPort, workingDir: string): Promise<string[]> {
  try {
    // GitPort가 ls-files 메서드를 제공하지 않으므로 직접 구현
    const { execSync } = require('child_process');
    const output = execSync('git ls-files', { 
      cwd: workingDir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024  // 10MB buffer
    });
    
    return output
      .split('\n')
      .map((f: string) => f.trim())
      .filter((f: string) => f.length > 0);
  } catch (error: any) {
    console.warn(`⚠️  Failed to list git files: ${error.message}`);
    return [];
  }
}

/**
 * 배치 처리: 여러 stack trace 파일을 한 번에 변환
 */
export async function resolveStackTraceFiles(
  stackTraceFiles: string[],
  workingDir: string,
  git: GitPort
): Promise<Map<string, FilePathMatch>> {
  const results = new Map<string, FilePathMatch>();
  
  for (const file of stackTraceFiles) {
    const match = await resolveStackTraceFile(file, workingDir, git);
    results.set(file, match);
  }
  
  return results;
}


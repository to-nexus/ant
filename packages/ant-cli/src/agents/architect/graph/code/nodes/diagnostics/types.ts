/**
 * Error Diagnostics - 언어별 에러 진단 시스템
 * 
 * 구조:
 * - 언어별 기본 패턴 (TypeScript, Python, Java, etc)
 * - 빌드 도구별 추가 패턴 (Vite, Webpack, Maven, etc)
 */

/**
 * 지원 언어
 */
export enum Language {
  TYPESCRIPT = 'typescript',
  JAVASCRIPT = 'javascript',
  PYTHON = 'python',
  JAVA = 'java',
  GO = 'go',
  RUST = 'rust',
  UNKNOWN = 'unknown'
}

/**
 * 빌드 도구
 */
export enum BuildTool {
  VITE = 'vite',
  WEBPACK = 'webpack',
  ROLLUP = 'rollup',
  MAVEN = 'maven',
  GRADLE = 'gradle',
  CARGO = 'cargo',
  NONE = 'none'
}

/**
 * 프레임워크 (플랫폼/언어 중립적)
 */
export enum Framework {
  NEXTJS = 'nextjs',
  NUXT = 'nuxt',
  ANGULAR = 'angular',
  SVELTE = 'svelte',
  DJANGO = 'django',
  FLASK = 'flask',
  FASTAPI = 'fastapi',
  SPRING = 'spring',
  EXPRESS = 'express',
  NESTJS = 'nestjs',
  NONE = 'none'
}

/**
 * 패키지 매니저
 */
export enum PackageManager {
  NPM = 'npm',
  PNPM = 'pnpm',
  YARN = 'yarn',
  PIP = 'pip',
  MAVEN = 'maven',
  CARGO = 'cargo',
  UNKNOWN = 'unknown'
}

/**
 * 에러 레이어 - 해결 책임 주체
 */
export enum ErrorLayer {
  ENVIRONMENT = 'environment',    // 사용자만 해결 가능 (NODE_ENV, PATH, JAVA_HOME)
  TOOLCHAIN = 'toolchain',       // 도구 재설치 필요 (tsc, python, javac)
  DEPENDENCY = 'dependency',      // 패키지 설치 (npm, pip, maven)
  CONFIGURATION = 'configuration', // 설정 파일 수정 (tsconfig.json, pyproject.toml)
  CODE = 'code',                 // 소스 코드 수정
  BUILD = 'build'                // 빌드 프로세스/도구 문제
}

/**
 * 진단 결과
 */
export interface DiagnosisResult {
  type: string;                   // ViolationType (import 순환 방지용 string)
  layer: ErrorLayer;
  message: string;
  rootCause: string;
  suggestedActions: string[];
  isRetryable: boolean;
  canLLMFix: boolean;
  severity: 'critical' | 'major' | 'minor';
}

/**
 * 에러 컨텍스트
 */
export interface ErrorContext {
  command?: string;          // 실행된 명령어 (e.g. "npm install", "tsc")
  workDir?: string;          // 작업 디렉토리
  output?: string;           // 전체 에러 출력 (추가 컨텍스트용)
  language?: Language;       // 감지된 프로젝트 언어 (deprecated - use projectDetection)
  buildTool?: BuildTool;     // 감지된 빌드 도구 (deprecated - use projectDetection)
  projectDetection?: ProjectDetection; // ✅ 프로젝트 감지 정보
}

/**
 * 에러 패턴 정의
 */
export interface ErrorPattern {
  layer: ErrorLayer;
  patterns: RegExp[];
  severity: 'critical' | 'major' | 'minor';
  canLLMFix: boolean;
  diagnosis: (match: RegExpMatchArray, context?: ErrorContext) => DiagnosisResult;
}

/**
 * 프로젝트 감지 결과
 */
export interface ProjectDetection {
  language: Language;
  buildTool: BuildTool;
  packageManager: PackageManager;
  framework: Framework;
  hasTypeScript: boolean;
  hasReact: boolean;
}

/**
 * 호환성 체크 결과 (사전 검증용)
 */
export interface CompatibilityIssue {
  framework: Framework;
  severity: 'critical' | 'major' | 'minor';
  issue: string;
  configFile: string;
  conflictingSettings: string[];
  fix: string;
  documentation?: string;
}

/**
 * 호환성 규칙 정의 (프레임워크별)
 */
export interface CompatibilityRule {
  framework: Framework;
  name: string;
  description: string;
  check: (config: any, configFile: string) => CompatibilityIssue | null;
}


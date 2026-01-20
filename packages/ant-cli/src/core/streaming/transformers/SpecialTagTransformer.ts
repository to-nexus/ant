/**
 * SpecialTagTransformer
 * 
 * LLM 응답의 특수 XML 태그를 사용자 친화적인 메시지로 변환
 * 
 * 지원 태그:
 * - <done>: 완료 메시지
 * - <learn_command>: 학습 명령 요약
 * - (향후 확장 가능)
 */

import { UserLanguage, getCompletionMessage } from '../../utils/languageDetector';

export interface TransformResult {
  /** 변환된 텍스트 (없으면 undefined) */
  text?: string;
  
  /** 태그가 완전히 처리되어 추가 렌더링이 필요 없는지 여부 */
  consumed: boolean;
}

/**
 * 개별 태그 변환기 인터페이스
 */
interface TagTransformer {
  /** 태그 패턴 (정규식) */
  pattern: RegExp;
  
  /** 변환 함수 */
  transform: (match: RegExpMatchArray, language: UserLanguage) => TransformResult;
}

/**
 * 특수 태그 변환 클래스
 */
export class SpecialTagTransformer {
  private transformers: TagTransformer[] = [];
  private language: UserLanguage;
  private _explicitDone: boolean = false;  // ✅ Track if <done>true</done> was detected
  
  constructor(language: UserLanguage = 'en') {
    this.language = language;
    this.initializeTransformers();
  }
  
  /**
   * Check if LLM explicitly output <done>true</done>
   */
  get explicitDone(): boolean {
    return this._explicitDone;
  }
  
  /**
   * 변환기 초기화 (빌트인 태그들)
   */
  private initializeTransformers(): void {
    // 1. <done> 태그 변환기
    this.register({
      pattern: /<done>(true|false)<\/done>/i,
      transform: (match, language) => this.transformDone(match, language)
    });
    
    // 2. <learn_command> 태그 변환기
    this.register({
      pattern: /<learn_command>\s*([\s\S]*?)\s*<\/learn_command>/,
      transform: (match, language) => this.transformLearnCommand(match, language)
    });
    
    // 3. <tasks> 태그 변환기
    this.register({
      pattern: /<tasks>\s*([\s\S]*?)\s*<\/tasks>/,
      transform: (match, language) => this.transformTasks(match, language)
    });
    
    // 4. <references> 태그 변환기
    this.register({
      pattern: /<references>\s*([\s\S]*?)\s*<\/references>/,
      transform: (match, language) => this.transformReferences(match, language)
    });
    
    // 5. <detect> 태그 변환기 (detectEnvironment 노드의 JSON 응답)
    this.register({
      pattern: /<detect>\s*([\s\S]*?)\s*<\/detect>/,
      transform: (match, language) => this.transformDetect(match, language)
    });
  }
  
  /**
   * 새로운 변환기 등록 (확장 포인트)
   */
  register(transformer: TagTransformer): void {
    this.transformers.push(transformer);
  }
  
  /**
   * 컨텐츠에서 특수 태그 감지 및 변환
   */
  transform(content: string): TransformResult {
    // 등록된 모든 변환기를 순회하며 매칭 시도
    for (const transformer of this.transformers) {
      const match = content.match(transformer.pattern);
      if (match) {
        return transformer.transform(match, this.language);
      }
    }
    
    // 변환할 태그 없음
    return { text: content, consumed: false };
  }
  
  /**
   * <done> 태그 변환
   */
  private transformDone(match: RegExpMatchArray, language: UserLanguage): TransformResult {
    const isDone = match[1].toLowerCase() === 'true';
    
    if (isDone) {
      this._explicitDone = true;  // ✅ Track explicit done tag
      // ✅ 기존 languageDetector 유틸리티 사용
      const completionMessage = getCompletionMessage(language);
      return { text: completionMessage, consumed: true };
    }
    
    // <done>false</done> → 아무것도 렌더링하지 않음 (LLM이 계속 작업 중)
    return { consumed: true };
  }
  
  /**
   * <learn_command> 태그 변환
   */
  private transformLearnCommand(match: RegExpMatchArray, language: UserLanguage): TransformResult {
    try {
      const commandData = JSON.parse(match[1]);
      const formatted = this.formatLearnCommand(commandData, language);
      
      return { text: formatted, consumed: true };
    } catch (error) {
      console.warn('[SpecialTagTransformer] Failed to parse learn_command:', error);
      
      // Fallback: JSON 형태로 표시
      const isKorean = language === 'ko';
      return {
        text: isKorean
          ? `**학습 명령 분석 완료**\n\`\`\`json\n${match[1]}\n\`\`\``
          : `**Learning Command Analyzed**\n\`\`\`json\n${match[1]}\n\`\`\``,
        consumed: true
      };
    }
  }
  
  /**
   * learn_command JSON을 사용자 친화적인 텍스트로 포맷팅
   */
  private formatLearnCommand(command: any, language: UserLanguage): string {
    const { action, branch, mode, files, text } = command;
    const isKorean = language === 'ko';
    
    let formatted = isKorean 
      ? '**📚 학습 명령 분석 완료**\n\n'
      : '**📚 Learning Command Analyzed**\n\n';
    
    switch (action) {
      case 'index_branch':
        formatted += isKorean
          ? `• **작업**: 브랜치 인덱싱\n\n• **브랜치**: \`${branch || 'current'}\`\n\n• **모드**: ${mode === 'full' ? '전체' : '스마트'}\n\n`
          : `• **Action**: Index Branch\n\n• **Branch**: \`${branch || 'current'}\`\n\n• **Mode**: ${mode === 'full' ? 'Full' : 'Smart'}\n\n`;
        break;
        
      case 'index_codebase':
        formatted += isKorean
          ? `• **작업**: 코드베이스 인덱싱\n\n• **모드**: ${mode === 'full' ? '전체' : '스마트'}\n\n`
          : `• **Action**: Index Codebase\n\n• **Mode**: ${mode === 'full' ? 'Full' : 'Smart'}\n\n`;
        break;
        
      case 'learn_files':
        const fileCount = files ? files.length : 0;
        formatted += isKorean
          ? `• **작업**: 파일 학습\n\n• **파일 수**: ${fileCount}개\n\n`
          : `• **Action**: Learn Files\n\n• **File Count**: ${fileCount}\n\n`;
        
        if (files && files.length > 0) {
          formatted += isKorean ? '• **파일 목록**:\n\n' : '• **Files**:\n\n';
          files.slice(0, 5).forEach((file: string) => {
            formatted += `  - \`${file}\`\n`;
          });
          if (files.length > 5) {
            formatted += isKorean
              ? `  - ... 외 ${files.length - 5}개\n`
              : `  - ... and ${files.length - 5} more\n`;
          }
          formatted += '\n';  // 파일 목록 끝에 추가 개행
        }
        break;
        
      case 'learn_text':
        const preview = text ? (text.length > 100 ? text.substring(0, 100) + '...' : text) : '';
        formatted += isKorean
          ? `• **작업**: 텍스트 학습\n\n• **내용**: ${preview || '(제공됨)'}\n\n`
          : `• **Action**: Learn Text\n\n• **Content**: ${preview || '(provided)'}\n\n`;
        break;
        
      default:
        formatted += isKorean
          ? `• **작업**: ${action}\n\n• **세부사항**:\n\n\`\`\`json\n${JSON.stringify(command, null, 2)}\n\`\`\`\n\n`
          : `• **Action**: ${action}\n\n• **Details**:\n\n\`\`\`json\n${JSON.stringify(command, null, 2)}\n\`\`\`\n\n`;
    }
    
    return formatted;
  }
  
  /**
   * <tasks> 태그 변환
   * 
   * ✅ CRITICAL: Tasks는 채팅에 렌더링하지 않음!
   * - Kanban 보드에 자동으로 표시됨
   * - decompose 노드에서 이미 파싱하여 사용함
   * - 채팅에서는 완전히 숨김 (raw text도 안 보여줌)
   */
  private transformTasks(match: RegExpMatchArray, language: UserLanguage): TransformResult {
    // ✅ consumed: true → 채팅에 아무것도 출력하지 않음
    // ✅ text: undefined → 변환된 텍스트도 없음
    return { consumed: true };
  }
  
  /**
   * <references> 태그 변환
   * 
   * References JSON을 사용자 친화적인 메시지로 포맷팅
   */
  private transformReferences(match: RegExpMatchArray, language: UserLanguage): TransformResult {
    try {
      const referencesText = match[1].trim();
      
      console.log(`🐛 [SpecialTagTransformer] transformReferences called`);
      console.log(`🐛 [SpecialTagTransformer] referencesText: ${referencesText}`);
      
      // Empty array check
      if (referencesText === '[]') {
        // Empty references - no output needed
        console.log(`🐛 [SpecialTagTransformer] Empty array, consuming without output`);
        return { consumed: true };
      }
      
      const references = JSON.parse(referencesText);
      
      if (!Array.isArray(references) || references.length === 0) {
        console.log(`🐛 [SpecialTagTransformer] Not an array or empty, consuming`);
        return { consumed: true };
      }
      
      const formatted = this.formatReferences(references, language);
      console.log(`🐛 [SpecialTagTransformer] Formatted output: ${formatted.substring(0, 200)}`);
      
      return { text: formatted, consumed: true };
    } catch (error) {
      console.warn('[SpecialTagTransformer] Failed to parse references:', error);
      
      // Fallback: just hide it (backend already logged it)
      return { consumed: true };
    }
  }
  
  /**
   * References 배열을 사용자 친화적인 메시지로 포맷팅
   */
  private formatReferences(references: any[], language: UserLanguage): string {
    const isKorean = language === 'ko';
    
    let formatted = isKorean 
      ? `**📚 참고 레포지토리 등록**\n\n`
      : `**📚 Reference Repositories Registered**\n\n`;
    
    formatted += isKorean
      ? `다음 레포지토리의 코드를 참고하여 작업합니다:\n\n`
      : `Will reference code from the following repositories:\n\n`;
    
    references.forEach((ref) => {
      const project = ref.project || '(unknown)';
      const branch = ref.branch;
      
      if (branch) {
        formatted += `• **${project}** → \`${branch}\` 브랜치\n`;
      } else {
        formatted += `• **${project}** → 기본 브랜치\n`;
      }
    });
    
    formatted += '\n';
    formatted += isKorean
      ? `💡 필요시 \`search_reference_code\` 도구로 해당 레포의 코드를 검색합니다.`
      : `💡 Will use \`search_reference_code\` tool to search code from these repositories.`;
    
    return formatted;
  }
  
  /**
   * <detect> 태그 변환 (detectEnvironment 노드)
   * 
   * 환경 감지 결과를 사용자 친화적인 메시지로 변환
   * ✅ Uses unified DetectionReport + formatDetectionReportForChat
   */
  private transformDetect(match: RegExpMatchArray, language: UserLanguage): TransformResult {
    try {
      const detectJson = match[1].trim();
      const parsed = JSON.parse(detectJson);
      
      // Import formatDetectionReportForChat from detection module
      const { parseDetectionReportFromLLM, formatDetectionReportForChat } = require('../../types/detection');
      
      // Determine source job from JSON structure
      // - Code job: has 'jobMode' or 'mode' WITHOUT 'workType'
      // - Design job: has 'workType'
      const isDesignJob = 'workType' in parsed;
      const sourceJob = isDesignJob ? 'design' : 'code';
      
      // Build DetectionReport from parsed JSON (inline conversion)
      const report: any = {
        sourceJob,
        // Support both old (mode/modeReasoning) and new (jobMode/jobModeReasoning) field names
        jobMode: parsed.jobMode || parsed.mode || parsed.designMode || 'generate',
        jobModeReasoning: parsed.jobModeReasoning || parsed.modeReasoning || parsed.designModeReasoning || '',
        detectedAt: new Date().toISOString(),
      };
      
      // Environment (common)
      if (parsed.environment) {
        report.environment = parsed.environment;
        report.environmentReasoning = parsed.environmentReasoning;
      }
      
      // Design-specific fields
      if (sourceJob === 'design') {
        if (parsed.workType && parsed.workType !== 'error') {
          report.workType = parsed.workType;
          report.workTypeReasoning = parsed.workTypeReasoning;
        }
        if (parsed.domain) {
          report.domain = parsed.domain;
          report.domainReasoning = parsed.domainReasoning;
        }
      }
      
      // Code-specific fields
      if (sourceJob === 'code') {
        if (parsed.profile) {
          report.profile = {
            language: parsed.profile.language || 'typescript',
            framework: parsed.profile.framework,
          };
        }
        if (parsed.requireRag !== undefined || parsed.requireRagForDecompose !== undefined) {
          report.requireRag = parsed.requireRag ?? parsed.requireRagForDecompose;
        }
      }
      
      // Use unified formatter
      const formatted = formatDetectionReportForChat(report, language);
      
      return { text: formatted, consumed: true };
      
    } catch (error) {
      console.warn('[SpecialTagTransformer] Failed to parse detect tag:', error);
      const isKorean = language === 'ko';
      return { 
        text: isKorean ? '⚠️ 환경 분석 결과 파싱 실패' : '⚠️ Failed to parse environment analysis',
        consumed: true 
      };
    }
  }
}


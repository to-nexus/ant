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
  
  constructor(language: UserLanguage = 'en') {
    this.language = language;
    this.initializeTransformers();
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
   * Tasks JSON을 보기 좋은 목록으로 포맷팅
   */
  private transformTasks(match: RegExpMatchArray, language: UserLanguage): TransformResult {
    try {
      // JSON 파싱
      const tasksData = JSON.parse(match[1]);
      const tasks = tasksData.tasks || tasksData;  // Support both { tasks: [...] } and [...]
      
      if (!Array.isArray(tasks)) {
        throw new Error('Tasks must be an array');
      }
      
      const formatted = this.formatTasks(tasks, language);
      return { text: formatted, consumed: true };
    } catch (error) {
      console.warn('[SpecialTagTransformer] Failed to parse tasks:', error);
      
      // Fallback: JSON 형태로 표시
      const isKorean = language === 'ko';
      return {
        text: isKorean
          ? `**태스크 목록**\n\`\`\`json\n${match[1]}\n\`\`\``
          : `**Task List**\n\`\`\`json\n${match[1]}\n\`\`\``,
        consumed: true
      };
    }
  }
  
  /**
   * Tasks 배열을 사용자 친화적인 목록으로 포맷팅
   */
  private formatTasks(tasks: any[], language: UserLanguage): string {
    const isKorean = language === 'ko';
    
    let formatted = isKorean 
      ? `**📋 태스크 분석 완료** (${tasks.length}개)\n\n`
      : `**📋 Task Breakdown Complete** (${tasks.length} tasks)\n\n`;
    
    // 우선순위별로 정렬
    const sortedTasks = [...tasks].sort((a, b) => {
      const priorityA = a.priority ?? 999;
      const priorityB = b.priority ?? 999;
      return priorityA - priorityB;
    });
    
    sortedTasks.forEach((task, index) => {
      const priority = task.priority !== undefined ? `P${task.priority}` : '';
      const type = task.type ? `[${task.type.toUpperCase()}]` : '';
      const name = task.name || task.title || `Task ${index + 1}`;
      const description = task.description || '';
      
      // Task 헤더
      formatted += `${index + 1}. **${name}**`;
      
      // 뱃지 추가 (priority, type)
      const badges = [priority, type].filter(Boolean);
      if (badges.length > 0) {
        formatted += ` ${badges.map(b => `\`${b}\``).join(' ')}`;
      }
      
      formatted += '\n';
      
      // Description (있으면)
      if (description) {
        // 짧으면 한 줄, 길면 줄바꿈
        if (description.length > 80) {
          formatted += `   ${description.substring(0, 100)}...\n`;
        } else {
          formatted += `   ${description}\n`;
        }
      }
      
      formatted += '\n';
    });
    
    return formatted.trim();
  }
}


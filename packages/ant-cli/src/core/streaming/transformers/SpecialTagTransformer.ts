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
   */
  private transformDetect(match: RegExpMatchArray, language: UserLanguage): TransformResult {
    try {
      const detectJson = match[1].trim();
      const parsed = JSON.parse(detectJson);
      
      const isKorean = language === 'ko';
      
      let formatted = isKorean
        ? `\n🔍 **환경 분석 완료**\n\n`
        : `\n🔍 **Environment Analysis Complete**\n\n`;
      
      // ✅ Detect job type: 
      // - Code job: has 'mode'
      // - Design job (UI Design): has 'workType' === 'ui-design'
      // - Design job (System Design): has 'domain'
      const isCodeJob = 'mode' in parsed;
      const isUiDesignJob = parsed.workType === 'ui-design';
      const isSystemDesignJob = 'domain' in parsed || parsed.workType === 'system-design';
      
      if (isCodeJob) {
        // CODE JOB: mode, environment, profile
        const modeEmoji = parsed.mode === 'generate' ? '✨' : parsed.mode === 'refactor' ? '🔧' : '📖';
        formatted += isKorean
          ? `${modeEmoji} **모드**: ${parsed.mode}\n`
          : `${modeEmoji} **Mode**: ${parsed.mode}\n`;
        
        if (parsed.modeReasoning) {
          formatted += `   └ ${parsed.modeReasoning}\n\n`;
        }
        
        const envEmoji = parsed.environment === 'frontend' ? '🎨' : 
                         parsed.environment === 'backend' ? '⚙️' : 
                         parsed.environment === 'fullstack' ? '🌐' : '❓';
        formatted += isKorean
          ? `${envEmoji} **환경**: ${parsed.environment}\n`
          : `${envEmoji} **Environment**: ${parsed.environment}\n`;
        
        if (parsed.environmentReasoning) {
          formatted += `   └ ${parsed.environmentReasoning}\n\n`;
        }
        
        // Profile (Code job only)
        if (parsed.profile?.language) {
          formatted += isKorean
            ? `📊 **프로파일**: ${parsed.profile.language}`
            : `📊 **Profile**: ${parsed.profile.language}`;
          
          if (parsed.profile.framework) {
            formatted += ` + ${parsed.profile.framework}`;
          }
          formatted += '\n\n';
        }
      } else if (isUiDesignJob) {
        // ✅ UI DESIGN JOB: workType === 'ui-design'
        formatted += isKorean
          ? `🎨 **작업 유형**: UI 디자인 문서화\n`
          : `🎨 **Work Type**: UI Design Documentation\n`;
        
        if (parsed.workTypeReasoning) {
          formatted += `   └ ${parsed.workTypeReasoning}\n\n`;
        }
        
        // Show what will be generated
        formatted += isKorean
          ? `📄 **생성 문서**:\n`
          : `📄 **Output Documents**:\n`;
        formatted += `   • \`inputs/sources/ui-tokens.md\` - Design tokens (colors, typography, spacing)\n`;
        formatted += `   • \`inputs/sources/ui-assets.md\` - Asset mapping\n`;
        formatted += `   • \`inputs/sources/ui-spec.md\` - UI specification\n\n`;
        
        // Show tool-based workflow hint
        formatted += isKorean
          ? `🔧 **작업 방식**: 도구 기반 멀티모달 분석\n`
          : `🔧 **Workflow**: Tool-based multimodal analysis\n`;
        formatted += isKorean
          ? `   └ 레퍼런스 이미지를 선택적으로 로드하여 분석\n\n`
          : `   └ Selectively load and analyze reference images\n\n`;
        
      } else if (isSystemDesignJob) {
        // SYSTEM DESIGN JOB: domain, environment
        const domainEmoji = parsed.domain === 'game' ? '🎮' : '🔧';
        formatted += isKorean
          ? `${domainEmoji} **도메인**: ${parsed.domain}\n`
          : `${domainEmoji} **Domain**: ${parsed.domain}\n`;
        
        if (parsed.domainReasoning) {
          formatted += `   └ ${parsed.domainReasoning}\n\n`;
        }
        
        const env = parsed.environment || parsed.designEnvironment || 'fullstack';
        const envEmoji = env === 'frontend' ? '🎨' : 
                         env === 'backend' ? '⚙️' : 
                         env === 'fullstack' ? '🌐' : '❓';
        formatted += isKorean
          ? `${envEmoji} **환경**: ${env}\n`
          : `${envEmoji} **Environment**: ${env}\n`;
        
        const envReasoning = parsed.environmentReasoning || parsed.designEnvironmentReasoning;
        if (envReasoning) {
          formatted += `   └ ${envReasoning}\n\n`;
        }
        
        // Design-specific: Show which guide will be applied
        if (parsed.domain === 'game') {
          formatted += isKorean
            ? '   → 🎮 Game Domain Design Guide 적용\n'
            : '   → 🎮 Game Domain Design Guide applied\n';
        } else {
          formatted += isKorean
            ? '   → 🔧 Service Domain Design Guide 적용\n'
            : '   → 🔧 Service Domain Design Guide applied\n';
        }
        
        // Show output file (Naming policy)
        // - single-tier (frontend-only / backend-only) → system-design.md
        // - fullstack → split docs (api-contract, fe, be)
        if (env === 'fullstack') {
          formatted += isKorean
            ? '   → 🔄 `api-contract.md`, `fe-system-design.md`, `be-system-design.md` 생성\n'
            : '   → 🔄 Generate `api-contract.md`, `fe-system-design.md`, `be-system-design.md`\n';
        } else {
          formatted += isKorean
            ? '   → 🧾 `system-design.md` 생성\n'
            : '   → 🧾 Generate `system-design.md`\n';
        }
        formatted += '\n';
      }
      
      // Keywords (if RAG required)
      if (parsed.requireRagForDecompose && parsed.decomposeKeywords?.codebase?.length > 0) {
        const keywords = parsed.decomposeKeywords.codebase;
        const displayKeywords = keywords.slice(0, 8); // Show first 8
        const remaining = keywords.length - displayKeywords.length;
        
        formatted += isKorean
          ? `🔑 **검색 키워드**: `
          : `🔑 **Search Keywords**: `;
        
        formatted += displayKeywords.join(', ');
        if (remaining > 0) {
          formatted += isKorean ? ` 외 ${remaining}개` : ` +${remaining} more`;
        }
        formatted += '\n\n';
      }
      
      // ✅ consumed: true → Replace original tag with formatted text
      return { text: formatted, consumed: true };
      
    } catch (error) {
      console.warn('[SpecialTagTransformer] Failed to parse detect tag:', error);
      // Show formatted message on error
      const isKorean = language === 'ko';
      return { 
        text: isKorean ? '⚠️ 환경 분석 결과 파싱 실패' : '⚠️ Failed to parse environment analysis',
        consumed: true 
      };
    }
  }
}


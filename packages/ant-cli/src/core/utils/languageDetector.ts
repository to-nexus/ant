/**
 * Language Detection Utility
 * 
 * Detects user's preferred language from input text (directive, PRD, etc.)
 * Used for providing localized LLM responses while keeping code in English.
 */

export type UserLanguage = 'en' | 'ko' | 'ja' | 'zh';

/**
 * Detect user's preferred language from input text
 * 
 * @param text - Input text to analyze (directive, PRD, design doc, etc.)
 * @returns Detected language code
 */
export function detectUserLanguage(text: string): UserLanguage {
  if (!text || text.length < 3) {
    return 'en';  // Default to English
  }

  // Count character types
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  const japaneseChars = (text.match(/[ぁ-んァ-ヶー一-龠]/g) || []).length;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalNonAscii = koreanChars + japaneseChars + chineseChars;

  // If non-ASCII characters are more than 10% of text, detect specific language
  if (totalNonAscii > text.length * 0.1) {
    if (koreanChars > japaneseChars && koreanChars > chineseChars) {
      return 'ko';
    }
    if (japaneseChars > koreanChars && japaneseChars > chineseChars) {
      return 'ja';
    }
    if (chineseChars > koreanChars && chineseChars > japaneseChars) {
      return 'zh';
    }
  }

  return 'en';
}

/**
 * Get language instruction for system prompt
 * 
 * Instructs LLM to respond in user's language while keeping code in English.
 * 
 * @param lang - Target language
 * @returns Language instruction to inject into system prompt
 */
export function getLanguageInstruction(lang: UserLanguage): string {
  const instructions: Record<UserLanguage, string> = {
    en: '',  // No instruction needed for English (default)
    
    ko: `
<response_language>
**CRITICAL: 응답 언어 규칙**

사용자가 한국어로 입력했으므로, 다음 규칙을 따라 응답하세요:

✅ **한국어로 작성**:
- 설명, 추론, 분석
- 태스크 분석 및 진행 상황
- 에러 설명 및 제안
- 일반 대화 및 피드백

❌ **영어 유지**:
- 코드 (변수명, 함수명, 클래스명, 주석)
- 파일 경로 및 파일명
- 기술 용어 (identifier, import, export 등)
- 커맨드 출력

**예시**:
❌ 나쁨: "변수 userName을 생성했습니다"
✅ 좋음: "userName 변수를 생성했습니다"

❌ 나쁨: "Button component를 만들었어요"
✅ 좋음: "Button 컴포넌트를 생성했습니다"
</response_language>`,
    
    ja: `
<response_language>
**重要: 応答言語ルール**

ユーザーが日本語で入力したため、以下のルールに従って応答してください:

✅ **日本語で記述**:
- 説明、推論、分析
- タスク分析と進捗状況
- エラーの説明と提案
- 一般的な会話とフィードバック

❌ **英語を維持**:
- コード（変数名、関数名、クラス名、コメント）
- ファイルパスとファイル名
- 技術用語（identifier、import、exportなど）
- コマンド出力

**例**:
❌ 悪い例: "変数 userName を作成しました"
✅ 良い例: "userName 変数を作成しました"
</response_language>`,
    
    zh: `
<response_language>
**重要: 响应语言规则**

用户使用中文输入，请遵循以下规则进行响应:

✅ **使用中文**:
- 解释、推理、分析
- 任务分析和进度
- 错误说明和建议
- 一般对话和反馈

❌ **保持英文**:
- 代码（变量名、函数名、类名、注释）
- 文件路径和文件名
- 技术术语（identifier、import、export等）
- 命令输出

**示例**:
❌ 错误: "变量 userName 已创建"
✅ 正确: "userName 变量已创建"
</response_language>`
  };

  return instructions[lang];
}

/**
 * Get localized completion message
 * 
 * Returns a natural completion message in user's language.
 * 
 * @param lang - Target language
 * @returns Random completion message
 */
export function getCompletionMessage(lang: UserLanguage): string {
  const messages: Record<UserLanguage, string[]> = {
    en: [
      'All set. Moving to the next task.',
      'Done. Proceeding with the next step.',
      'Finished. Ready for the next one.',
      'Complete. On to the next task.',
      'That\'s done. Continuing now.'
    ],
    ko: [
      '완료했습니다. 다음 태스크로 진행합니다.',
      '작업 완료. 다음 단계로 넘어갑니다.',
      '끝났습니다. 다음 작업 시작합니다.',
      '완료. 이제 다음 태스크입니다.',
      '작업이 끝났습니다. 계속 진행합니다.'
    ],
    ja: [
      '完了しました。次のタスクに進みます。',
      '終わりました。次のステップに移ります。',
      '完了です。次の作業を開始します。',
      '完了。次のタスクです。',
      '作業が終わりました。続けます。'
    ],
    zh: [
      '完成。继续下一个任务。',
      '完成了。进入下一步。',
      '结束。准备下一个。',
      '完成。开始下一个任务。',
      '做完了。继续进行。'
    ]
  };

  const languageMessages = messages[lang];
  return languageMessages[Math.floor(Math.random() * languageMessages.length)];
}


/**
 * Authoring-turn context (plan-job-valiant-pebble).
 *
 * When a `generate`-mode ReAct research loop concludes without a `<file>` tag
 * (a weak model spilling the PRD as prose after a long codebase-inspection
 * loop — the arctic-edging-grass failure), the node re-enters for ONE dedicated
 * authoring turn. That turn runs with NO tools over a CLEAN context built here:
 * the model's own draft (the prose document it already synthesized) plus an
 * unambiguous instruction to re-emit it through the `<file>` channel — NOT the
 * raw multi-round tool transcript that habituated free-text output.
 *
 * The write channel stays `<file>` (no new tool / channel); this only
 * reconstructs the *input context* to reproduce the confirmed-working
 * greenfield condition (short, clean context → `<file>` emitted cleanly).
 */

import type { ConversationMessage } from '../../../../../common/graph/conversations';

/** Extract the most recent assistant text (the model's draft) from history. */
function lastAssistantText(history: ConversationMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'assistant') continue;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) return text;
    }
  }
  return '';
}

/**
 * Build the single user message for the tool-free authoring turn. The draft is
 * the model's own synthesized document; the instruction forces the `<file>`
 * channel. The full authoring rules + Target Path already live in the system
 * prompt (rebuilt every turn), so this message stays short and channel-focused.
 */
export function buildAuthoringUserMessage(
  nodeGenerate: ConversationMessage[],
  targetPath: string,
  isKorean: boolean,
): string {
  const draft = lastAssistantText(nodeGenerate);

  const draftBlock = draft
    ? (isKorean
        ? `아래는 워크스페이스 조사를 마치고 당신이 작성한 기획 문서 초안입니다.\n\n<draft>\n${draft}\n</draft>\n\n`
        : `Below is the planning document you drafted after finishing your workspace inspection.\n\n<draft>\n${draft}\n</draft>\n\n`)
    : (isKorean
        ? `워크스페이스 조사를 마쳤습니다. 추가 조사는 하지 말고 지금 문서를 작성하세요.\n\n`
        : `You have finished inspecting the workspace. Do NOT inspect further — author the document now.\n\n`);

  const instruction = isKorean
    ? `이제 완성된 기획 문서를 단일 \`<file path="${targetPath}">...</file>\` 태그로 출력하세요. 태그 안의 내용이 파일 본문 그대로입니다(코드펜스 금지). 태그 밖의 텍스트는 폐기되므로 문서를 산문으로 출력하지 마세요. 태그 뒤에 한 줄짜리 \`<reply>\`를 선택적으로 붙일 수 있습니다.`
    : `Now output the complete planning document as a single \`<file path="${targetPath}">...</file>\` tag. The content inside the tag is the file body verbatim (no code fences). Text outside a registered tag is discarded, so do NOT emit the document as prose. An optional one-line \`<reply>\` may follow the tag.`;

  return draftBlock + instruction;
}

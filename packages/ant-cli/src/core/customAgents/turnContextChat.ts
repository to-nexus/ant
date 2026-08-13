/**
 * Turn-context chat card — the universal runtime's announcement of what a
 * turn resolved to.
 *
 * Universal resolves its turn context deterministically (`explicit → catalog
 * default → general`), so unlike canonical's detect card this is a statement
 * of a CONSTANT, never of an inference. It exists because the fallback was
 * otherwise silent: a turn that fell through to `general` — no declared
 * intent active, mapped injections left on the TOC, the per-intent clarify
 * knob unreachable — looked exactly like one running under the intent the
 * author meant.
 *
 * Plain markdown, not a canonical `<tag>`: no tag is emitted, so the
 * OutputTagRegistry contract (which scopes tags the LLM may emit) does not
 * apply. Same path the respond node's artifact manifest already uses.
 *
 * Pure — the caller owns the chat send. Sibling of `promptBlock.ts` so both
 * render paths neutralize author text with the same `sanitizeCell`.
 */

import type { CustomIntentDef } from '@ant/shared';
import { sanitizeCell } from './promptBlock.js';

export type TurnContextSource = 'pinned' | 'default' | 'unpinned';

export interface TurnContextChatInput {
  agentName: string;
  jobName: string;
  /** Active intent ids — `['general']` on the unpinned fallback. */
  intents: readonly string[];
  source: TurnContextSource;
  /** The job's full intent catalog — rendered as the choice set on `unpinned`. */
  catalog: readonly CustomIntentDef[];
  /** Injection files the active intents inline this turn. */
  activeInjections: readonly string[];
  /** `@ctx:` paths attached to this turn. */
  context: readonly string[];
  /** `@plan` — writes confined to `plan/`. */
  planTurn: boolean;
}

interface Labels {
  header: string;
  intent: string;
  sourcePinned: string;
  sourceDefault: string;
  sourceUnpinned: string;
  choices: string;
  injections: string;
  context: string;
  planTurn: string;
  planOn: string;
}

const KO: Labels = {
  header: '턴 컨텍스트 확정',
  intent: '인텐트',
  sourcePinned: '지정됨',
  sourceDefault: '카탈로그 기본값',
  sourceUnpinned: '미지정 — 기본 인텐트 없음',
  choices: '선택 가능',
  injections: '활성 지침',
  context: '첨부 컨텍스트',
  planTurn: '플랜 턴',
  planOn: '활성',
};

const EN: Labels = {
  header: 'Turn Context Resolved',
  intent: 'Intent',
  sourcePinned: 'pinned',
  sourceDefault: 'catalog default',
  sourceUnpinned: 'unpinned — no default intent',
  choices: 'Selectable',
  injections: 'Active instructions',
  context: 'Attached context',
  planTurn: 'Plan turn',
  planOn: 'on',
};

function sourceLabel(source: TurnContextSource, l: Labels): string {
  switch (source) {
    case 'pinned': return l.sourcePinned;
    case 'default': return l.sourceDefault;
    case 'unpinned': return l.sourceUnpinned;
  }
}

/**
 * Render the card. `unpinned` additionally lists the catalog — the authored
 * criteria the agent self-selects against — so the reader sees the choice set
 * the model was given instead of a bare `general`.
 */
export function formatTurnContextForChat(
  input: TurnContextChatInput,
  language: 'ko' | 'en' = 'ko',
): string {
  const l = language === 'ko' ? KO : EN;
  const title = [input.agentName, input.jobName].map(sanitizeCell).filter(Boolean).join(' / ');

  const lines: string[] = [
    `\n🧭 **${l.header}**${title ? ` — ${title}` : ''}\n`,
    `🪪 **${l.intent}**: ${input.intents.map((i) => `\`${sanitizeCell(i)}\``).join(', ')} (${sourceLabel(input.source, l)})`,
  ];

  if (input.source === 'unpinned' && input.catalog.length > 0) {
    lines.push(`   └ ${l.choices}:`);
    for (const intent of input.catalog) {
      lines.push(`      - \`${sanitizeCell(intent.id)}\` — ${sanitizeCell(intent.description)}`);
    }
  }

  if (input.activeInjections.length > 0) {
    lines.push(`📎 **${l.injections}**: ${input.activeInjections.map((f) => `\`${sanitizeCell(f)}\``).join(', ')}`);
  }
  if (input.context.length > 0) {
    lines.push(`📚 **${l.context}**: ${input.context.map((p) => `\`${sanitizeCell(p)}\``).join(', ')}`);
  }
  if (input.planTurn) {
    lines.push(`📋 **${l.planTurn}**: ${l.planOn}`);
  }

  return lines.join('\n') + '\n';
}

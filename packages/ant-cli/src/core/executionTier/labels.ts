/**
 * Execution Tier Labels — SSOT for user-facing tier names.
 *
 * The technical label (Reflex/OneShot/Exploratory/Task/RefsGrounded) is
 * defined by {@link ExecutionTier} in types.ts. This module adds
 * localized display labels + short descriptions used by chat UI
 * transformers. Keeping the labels in one place prevents drift across
 * SpecialTagTransformer, Kanban badges, and future operator tooling.
 */

import { ExecutionTierId } from '@ant/shared';
import type { UserLanguage } from '../utils/languageDetector';

export interface ExecutionTierLabel {
  /** Stable technical name, matches ExecutionTier.label. */
  name: 'Reflex' | 'OneShot' | 'Exploratory' | 'Task' | 'RefsGrounded';
  /** Short display label per locale. */
  short: Record<UserLanguage, string>;
  /** One-line description per locale. */
  description: Record<UserLanguage, string>;
}

export const EXECUTION_TIER_LABELS: Record<ExecutionTierId, ExecutionTierLabel> = {
  [ExecutionTierId.Reflex]: {
    name: 'Reflex',
    short: {
      ko: '즉답',
      en: 'Reflex',
      ja: '即答',
      zh: '直答',
    },
    description: {
      ko: '읽기 전용 반사 응답 (코드 변경 없음)',
      en: 'Read-only reflex response (no code change)',
      ja: '読み取り専用の即時応答(変更なし)',
      zh: '只读即时响应(无变更)',
    },
  },
  [ExecutionTierId.OneShot]: {
    name: 'OneShot',
    short: {
      ko: '단일 실행',
      en: 'OneShot',
      ja: 'ワンショット',
      zh: '单次执行',
    },
    description: {
      ko: '단일 편집으로 완결되는 작업',
      en: 'Completes in a single directed edit',
      ja: '単一の編集で完了',
      zh: '通过单次编辑完成',
    },
  },
  [ExecutionTierId.Exploratory]: {
    name: 'Exploratory',
    short: {
      ko: '탐색 실행',
      en: 'Exploratory',
      ja: '探索実行',
      zh: '探索执行',
    },
    description: {
      ko: '코드베이스를 가볍게 탐색하며 직접 수행',
      en: 'Light codebase exploration, direct execution',
      ja: 'コードベースを軽く探索して直接実行',
      zh: '轻量探索代码库后直接执行',
    },
  },
  [ExecutionTierId.Task]: {
    name: 'Task',
    short: {
      ko: '태스크 분해',
      en: 'Task',
      ja: 'タスク分解',
      zh: '任务分解',
    },
    description: {
      ko: '태스크 큐로 분해 후 병렬/순차 실행',
      en: 'Decomposed into queued tasks (parallel/serial)',
      ja: 'タスクキューに分解して並列/順次実行',
      zh: '分解为任务队列后并行/顺序执行',
    },
  },
  [ExecutionTierId.RefsGrounded]: {
    name: 'RefsGrounded',
    short: {
      ko: '레퍼런스 기반',
      en: 'RefsGrounded',
      ja: 'リファレンス基盤',
      zh: '参考资料驱动',
    },
    description: {
      ko: '레퍼런스 문서 근거로 계획 수립',
      en: 'Plan grounded on reference documents',
      ja: 'リファレンス文書に基づく計画',
      zh: '基于参考文档的规划',
    },
  },
};

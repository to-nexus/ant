import type { IntentId, JobType } from '@ant/shared';
import type { HeaviestNodeId, HeaviestNodeReason } from '@ant/shared';

interface HeaviestNodeMapping {
  job: JobType;
  node: HeaviestNodeId;
  reason: HeaviestNodeReason;
}

export const HEAVIEST_NODE_BY_INTENT: Record<IntentId, HeaviestNodeMapping> = {
  // Code (5) — decompose dominates (full RAC pool + role-scoped 8K/2K compaction).
  'gen-code-sys':             { job: 'code',   node: 'decompose', reason: 'static-max' },
  'gen-code-spec':            { job: 'code',   node: 'decompose', reason: 'static-max' },
  'gen-code-directive':       { job: 'code',   node: 'decompose', reason: 'static-max' },
  'rev-code':                 { job: 'code',   node: 'decompose', reason: 'static-max' },
  'explain-code':             { job: 'code',   node: 'detect',    reason: 'no-decompose' },

  // Design UI (4)
  'gen-ui-figma':             { job: 'design', node: 'docGen',    reason: 'static-max' },
  'gen-ui-desc':              { job: 'design', node: 'docGen',    reason: 'static-max' },
  'rev-ui':                   { job: 'design', node: 'docGen',    reason: 'static-max' },
  'explain-ui':               { job: 'design', node: 'detect',    reason: 'no-decompose' },

  // Design Game Art (4)
  'gen-game-art-figma':       { job: 'design', node: 'docGen',    reason: 'static-max' },
  'gen-game-art-desc':        { job: 'design', node: 'docGen',    reason: 'static-max' },
  'rev-game-art':             { job: 'design', node: 'docGen',    reason: 'static-max' },
  'explain-game-art':         { job: 'design', node: 'detect',    reason: 'no-decompose' },

  // Design System (5)
  'gen-sys-fe':               { job: 'design', node: 'docGen',    reason: 'static-max' },
  'gen-sys-be':               { job: 'design', node: 'docGen',    reason: 'static-max' },
  'gen-sys-full':             { job: 'design', node: 'docGen',    reason: 'static-max' },
  'rev-sys':                  { job: 'design', node: 'docGen',    reason: 'static-max' },
  'explain-sys':              { job: 'design', node: 'detect',    reason: 'no-decompose' },

  // Design Spec (3)
  'gen-spec':                 { job: 'design', node: 'docGen',    reason: 'static-max' },
  'rev-spec':                 { job: 'design', node: 'docGen',    reason: 'static-max' },
  'explain-spec':             { job: 'design', node: 'detect',    reason: 'no-decompose' },

  // Plan (3)
  'gen-plan':                 { job: 'plan',   node: 'generate',  reason: 'static-max' },
  'rev-plan':                 { job: 'plan',   node: 'generate',  reason: 'static-max' },
  'explain-plan':             { job: 'plan',   node: 'detect',    reason: 'no-decompose' },

  // Visual (5)
  'gen-visual-logo':          { job: 'visual', node: 'sketch',    reason: 'static-max' },
  'gen-visual-icon':          { job: 'visual', node: 'sketch',    reason: 'static-max' },
  'gen-visual-hero':          { job: 'visual', node: 'sketch',    reason: 'static-max' },
  'gen-visual-illustration':  { job: 'visual', node: 'sketch',    reason: 'static-max' },
  'explain-visual':           { job: 'visual', node: 'explain',   reason: 'no-decompose' },

  // Learn (1) — uses code job's decompose.
  'gen-learn':                { job: 'code',   node: 'decompose', reason: 'static-max' },

  // Ask (3)
  'ask-evaluate':             { job: 'ask',    node: 'agent',     reason: 'no-decompose' },
  'ask-ant':                  { job: 'ask',    node: 'agent',     reason: 'no-decompose' },
  'ask-general':              { job: 'ask',    node: 'agent',     reason: 'no-decompose' },
};

export function heaviestNodeFor(intent: IntentId): HeaviestNodeMapping {
  const hit = HEAVIEST_NODE_BY_INTENT[intent];
  if (!hit) {
    throw new Error(
      `[heaviestNodeFor] No mapping for intent "${intent}". ` +
      `Add to HEAVIEST_NODE_BY_INTENT in core/baselineEstimate/heaviestNode.ts.`,
    );
  }
  return hit;
}
